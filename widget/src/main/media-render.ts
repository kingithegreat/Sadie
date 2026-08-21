/**
 * media-render.ts — turning the ingredients into an actual video.
 *
 * The pipeline produced a script, narration audio and timed captions, and then
 * stopped: `renderPath` and the `render_qa` state existed with nothing to fill
 * them. A Media Studio that cannot make a video is a script writer.
 *
 * Two decisions shape this file.
 *
 * ffmpeg is DETECTED, not bundled. Bundling adds ~80MB to the installer and
 * commits the product to an ffmpeg licensing position; that is a business call,
 * not one to make silently in a build config. So rendering works today for
 * anyone who has ffmpeg, and says plainly what to install if they do not.
 *
 * The visual track is a TIMELINE, not an image. A still frame held for a
 * minute is the weakest thing this could produce; the reason to ship it first
 * is that it closes the loop from idea to uploadable file. Making the input a
 * list of timed segments means the upgrade — one visual per caption cue, or
 * stock b-roll — swaps the segment producer and leaves the renderer alone.
 * `staticTimeline` is the degenerate case: one segment, whole duration.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** One visual, held for a span of the video. */
export interface Segment {
  startMs: number;
  endMs: number;
  /** Image on disk, or null for the generated backdrop. */
  imagePath?: string | null;
}

export type VideoShape = 'short' | 'long';

/** Portrait for shorts, landscape for long-form — what each platform expects. */
export function dimensionsFor(shape: VideoShape): { w: number; h: number } {
  return shape === 'long' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
}

/** The whole duration as one visual: the simplest timeline that is still a timeline. */
export function staticTimeline(durationMs: number, imagePath?: string | null): Segment[] {
  return [{ startMs: 0, endMs: Math.max(1, Math.round(durationMs)), imagePath: imagePath ?? null }];
}

/** One visual per caption cue, for when a source of images exists. */
export function timelineFromCues(
  cues: Array<{ startMs: number; endMs: number }>,
  imageFor: (index: number) => string | null,
): Segment[] {
  return cues.map((c, i) => ({ startMs: c.startMs, endMs: c.endMs, imagePath: imageFor(i) }));
}

/**
 * Merge adjacent cues into scenes of roughly `targetSeconds`.
 *
 * Captions land every 2-3 seconds. Cutting the picture that often is frantic
 * to watch and generates three times the images for no gain — grouping into
 * ~5s scenes is closer to how a short is actually edited, and cuts generation
 * cost proportionally. The last group absorbs any remainder rather than
 * leaving a sliver on screen for half a second.
 */
export function groupCues(
  cues: Array<{ startMs: number; endMs: number; text?: string }>,
  targetSeconds = 5,
): Array<{ startMs: number; endMs: number; text: string; cueIndexes: number[] }> {
  if (!cues.length) return [];
  const targetMs = Math.max(1000, targetSeconds * 1000);
  const out: Array<{ startMs: number; endMs: number; text: string; cueIndexes: number[] }> = [];

  let current = { startMs: cues[0].startMs, endMs: cues[0].endMs, text: cues[0].text ?? '', cueIndexes: [0] };
  for (let i = 1; i < cues.length; i++) {
    const c = cues[i];
    if (c.endMs - current.startMs <= targetMs) {
      current.endMs = c.endMs;
      current.text = `${current.text} ${c.text ?? ''}`.trim();
      current.cueIndexes.push(i);
    } else {
      out.push(current);
      current = { startMs: c.startMs, endMs: c.endMs, text: c.text ?? '', cueIndexes: [i] };
    }
  }
  out.push(current);

  // A trailing scene shorter than a second reads as a glitch; fold it back.
  if (out.length > 1 && out[out.length - 1].endMs - out[out.length - 1].startMs < 1000) {
    const last = out.pop()!;
    const prev = out[out.length - 1];
    prev.endMs = last.endMs;
    prev.text = `${prev.text} ${last.text}`.trim();
    prev.cueIndexes.push(...last.cueIndexes);
  }
  return out;
}

/**
 * A concat-demuxer script for a sequence of stills.
 *
 * The demuxer is used rather than a filter_complex chain because the number of
 * segments is data, not a constant — 21 cues means 21 inputs, and a filter
 * graph built by string concatenation at that size is where this would start
 * failing in ways nobody can read.
 *
 * Two quirks it has to respect: paths are single-quoted with forward slashes
 * (with `'` escaped), and the FINAL entry must be repeated without a duration
 * or ffmpeg drops the last segment's screen time entirely.
 */
export function buildConcatFileContent(segments: Segment[]): string {
  const usable = segments.filter(s => s.imagePath);
  if (!usable.length) return '';
  const line = (p: string) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
  const rows: string[] = ['ffconcat version 1.0'];
  for (const s of usable) {
    rows.push(line(s.imagePath!));
    rows.push(`duration ${((s.endMs - s.startMs) / 1000).toFixed(3)}`);
  }
  // Repeated deliberately — see above.
  rows.push(line(usable[usable.length - 1].imagePath!));
  return rows.join('\n') + '\n';
}

/**
 * ffmpeg's filter syntax treats `:` as an argument separator and `\` as an
 * escape, so a Windows path like C:\Users\... inside a filter value has to be
 * written C\:/Users/... — backslashes flipped, the drive colon escaped.
 *
 * Only filter VALUES need this. Paths passed as plain -i arguments must be left
 * exactly as they are, which is why this is not applied everywhere.
 */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

/**
 * Caption styling, in libass terms.
 *
 * MarginV is the distance from the bottom edge. On a 1920-tall short, the
 * platform's own chrome — title, handle, description, buttons — occupies
 * roughly the lower 15%, so captions have to clear ~280px or they are simply
 * not visible where it matters. Landscape has no such overlay and needs far
 * less.
 *
 * Alignment=2 is bottom-centre. Outline over Shadow because an outline stays
 * legible against a busy photograph; a drop shadow does not.
 */
/**
 * The coordinate space force_style values live in.
 *
 * NOT pixels. ffmpeg converts SRT to ASS with a fixed script resolution —
 * verified by running the conversion and reading the header:
 *
 *   PlayResX: 384
 *   PlayResY: 288
 *   Style: Default,Arial,16,...,Outline 1,Alignment 2,MarginV 10
 *
 * libass then scales that to the frame, so on a 1920-tall short every value is
 * multiplied by 6.67. Setting FontSize=56 and MarginV=280 as if they were
 * pixels produced letters tall enough to push the text off the top of the
 * video — confirmed by extracting a frame.
 */
const ASS_PLAY_RES_Y = 288;

/** Convert a wanted pixel size into the ASS units force_style expects. */
export function toAssUnits(px: number, frameHeight: number): number {
  return Math.max(1, Math.round((px * ASS_PLAY_RES_Y) / frameHeight));
}

export function defaultSubtitleStyle(shape: VideoShape): string {
  const { h } = dimensionsFor(shape);
  // Wanted, in real pixels on the finished frame.
  const marginPx = shape === 'long' ? 70 : 280;
  const fontPx = shape === 'long' ? 56 : 110;
  const outlinePx = shape === 'long' ? 5 : 8;
  return [
    'FontName=Arial',
    `FontSize=${toAssUnits(fontPx, h)}`,
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H00000000',
    'BorderStyle=1',
    `Outline=${toAssUnits(outlinePx, h)}`,
    'Shadow=0',
    'Alignment=2',
    `MarginV=${toAssUnits(marginPx, h)}`,
    'Bold=1',
  ].join(',');
}

/**
 * Arguments for a single-visual render. Pure, so the command can be asserted
 * without invoking ffmpeg — the parts that break are the filter string and the
 * path escaping, and both are visible here.
 */
export function buildRenderArgs(opts: {
  audioPath: string;
  outputPath: string;
  shape: VideoShape;
  imagePath?: string | null;
  captionsPath?: string | null;
  /** Slow Ken Burns drift. A frozen frame reads as broken; a drift reads as chosen. */
  zoom?: boolean;
  durationSeconds: number;
  fps?: number;
  /** libass force_style string; defaults to defaultSubtitleStyle(shape). */
  subtitleStyle?: string;
  /** Absolute path to a background music track. Omit for narration only. */
  musicPath?: string | null;
  /** Music level before ducking; defaults to MUSIC_VOLUME_DEFAULT. */
  musicVolume?: number;
}): string[] {
  const { w, h } = dimensionsFor(opts.shape);
  const fps = opts.fps ?? 30;
  const args: string[] = ['-y'];

  if (opts.imagePath) {
    args.push('-loop', '1', '-framerate', String(fps), '-i', opts.imagePath);
  } else {
    // No image supplied: generate a backdrop rather than refusing. Dark slate,
    // matching the app's own surface.
    args.push('-f', 'lavfi', '-i', `color=c=0x0F1319:s=${w}x${h}:r=${fps}`);
  }
  args.push('-i', opts.audioPath);
  if (opts.musicPath) args.push('-i', opts.musicPath);

  const filters: string[] = [];
  if (opts.imagePath) {
    // Cover the frame without distortion: scale to fill, crop the overflow.
    filters.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`);
    filters.push(`crop=${w}:${h}`);
    if (opts.zoom !== false) {
      // zoompan runs per input frame, so the frame count is duration x fps.
      const frames = Math.max(1, Math.round(opts.durationSeconds * fps));
      filters.push(
        `zoompan=z='min(zoom+0.0004,1.12)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=${fps}`,
      );
    }
  }
  if (opts.captionsPath) {
    // Styled, not default. libass drops SRT text at the very bottom of the
    // frame, which on Shorts is exactly where the title, channel handle and
    // controls sit — the captions would be covered on the one platform this
    // format exists for. MarginV lifts them clear of that band. The outline
    // keeps them readable once a real image is behind them instead of a flat
    // backdrop.
    const style = opts.subtitleStyle ?? defaultSubtitleStyle(opts.shape);
    filters.push(`subtitles='${escapeFilterPath(opts.captionsPath)}':force_style='${style}'`);
  }
  // yuv420p or the file will not play in most browsers or on phones.
  filters.push('format=yuv420p');

  // With music, the video and audio graphs move into one -filter_complex:
  // ffmpeg will not accept -vf alongside -filter_complex for the same output.
  // Without music the original -vf form is used unchanged, so switching music
  // off cannot alter a render that already worked.
  if (opts.musicPath) {
    const music = buildMusicAudioGraph({ narrationInput: 1, musicInput: 2, volume: opts.musicVolume });
    args.push('-filter_complex', `[0:v]${filters.join(',')}[v];${music.graph}`);
    args.push('-map', '[v]', '-map', music.outLabel);
  } else {
    args.push('-vf', filters.join(','));
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23');
  // Forced at the encoder, not just in the filter chain. A JPEG input is
  // full-range, so the encoder picked yuvj420p — the deprecated variant that
  // renders washed out on some players — even with format=yuv420p filtered.
  args.push('-pix_fmt', 'yuv420p');
  args.push('-c:a', 'aac', '-b:a', '128k');
  // The image input loops forever; the audio decides when the video ends.
  args.push('-shortest', '-movflags', '+faststart');
  args.push(opts.outputPath);
  return args;
}

/**
 * Arguments for a multi-scene render, driven by a concat script.
 *
 * No zoompan here: with a cut every few seconds the motion comes from the
 * edit, and zoompan applied across a concatenated stream restarts its ramp on
 * the whole timeline rather than per image, which looks like a drift that
 * never arrives.
 */
export function buildTimelineRenderArgs(opts: {
  concatPath: string;
  audioPath: string;
  outputPath: string;
  shape: VideoShape;
  captionsPath?: string | null;
  fps?: number;
  subtitleStyle?: string;
  /** Absolute path to a background music track. Omit for narration only. */
  musicPath?: string | null;
  /** Music level before ducking; defaults to MUSIC_VOLUME_DEFAULT. */
  musicVolume?: number;
}): string[] {
  const { w, h } = dimensionsFor(opts.shape);
  const fps = opts.fps ?? 30;
  const args: string[] = ['-y'];

  // -safe 0 because the script holds absolute paths.
  args.push('-f', 'concat', '-safe', '0', '-i', opts.concatPath);
  args.push('-i', opts.audioPath);
  if (opts.musicPath) args.push('-i', opts.musicPath);

  const filters: string[] = [
    // Normalise the frame rate BEFORE burning captions, not with an output -r.
    // Concat stills arrive with one frame per scene and irregular timestamps;
    // an output -r re-times the frames AFTER the subtitle filter has already
    // drawn them, so the burned pixels land at the wrong moment. Measured: cue
    // 1 still on screen at 6s when it should have ended at 3.17s, while the
    // pictures cut on time.
    `fps=${fps}`,
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
  ];
  if (opts.captionsPath) {
    const style = opts.subtitleStyle ?? defaultSubtitleStyle(opts.shape);
    filters.push(`subtitles='${escapeFilterPath(opts.captionsPath)}':force_style='${style}'`);
  }
  filters.push('format=yuv420p');

  // Same branch as buildRenderArgs: -vf and -filter_complex cannot both drive
  // one output, so music moves the whole graph into filter_complex and the
  // no-music path stays exactly as it was.
  if (opts.musicPath) {
    const music = buildMusicAudioGraph({ narrationInput: 1, musicInput: 2, volume: opts.musicVolume });
    args.push('-filter_complex', `[0:v]${filters.join(',')}[v];${music.graph}`);
    args.push('-map', '[v]', '-map', music.outLabel);
  } else {
    args.push('-vf', filters.join(','));
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23');
  // See buildRenderArgs: generated scenes arrive as JPEG/PNG and the encoder
  // otherwise settles on full-range yuvj420p.
  args.push('-pix_fmt', 'yuv420p');
  args.push('-c:a', 'aac', '-b:a', '128k');
  args.push('-shortest', '-movflags', '+faststart');
  args.push(opts.outputPath);
  return args;
}

/** Where ffmpeg might be, beyond PATH — the usual Windows install locations. */
const EXTRA_FFMPEG_PATHS = [
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
];

function canRun(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 10_000 }, (err) => resolve(!err));
  });
}

/**
 * Locate ffmpeg, or report that it is missing.
 *
 * HOMEBOT_FFMPEG is honoured first so a test or a portable install can point at
 * a binary without touching PATH.
 */
export async function findFfmpeg(): Promise<string | null> {
  const explicit = process.env.HOMEBOT_FFMPEG?.trim();
  if (explicit && fs.existsSync(explicit) && await canRun(explicit)) return explicit;
  if (await canRun('ffmpeg')) return 'ffmpeg';
  for (const candidate of EXTRA_FFMPEG_PATHS) {
    if (fs.existsSync(candidate) && await canRun(candidate)) return candidate;
  }
  return null;
}

export const FFMPEG_MISSING_MESSAGE =
  'Rendering needs ffmpeg, which is not installed. Get it from https://ffmpeg.org/download.html ' +
  '(on Windows: winget install Gyan.FFmpeg), then try again. Everything else about the video — ' +
  'script, narration and captions — is already saved.';

/**
 * How loud the music sits under the narration before ducking.
 *
 * Low on purpose. Background music that competes with a voice is the single
 * most common way a generated video becomes unwatchable, and the narration is
 * the reason the video exists.
 */
export const MUSIC_VOLUME_DEFAULT = 0.18;

/**
 * The audio graph that mixes a music bed under narration.
 *
 * Ducking rather than a fixed level: `sidechaincompress` pushes the music down
 * whenever the narration is speaking and lets it back up in the gaps, which is
 * what makes a bed sound deliberate instead of like two files playing at once.
 *
 * Three details are load-bearing:
 *
 *  - `asplit` — the narration is needed twice, once as the sidechain KEY and
 *    once as an actual mixed input. A filter output cannot be consumed twice.
 *  - `aloop` — a two-minute track under a six-minute video would otherwise stop
 *    dead two minutes in. Looping is bounded by the amix duration below.
 *  - `duration=first` with narration FIRST — the video ends when the speech
 *    ends. With music first, the infinite loop would define the length and the
 *    render would never terminate.
 *
 * `normalize=0` matters too: amix halves every input by default, which would
 * quietly drop the narration to half volume the moment music was switched on.
 */
export function buildMusicAudioGraph(opts: {
  narrationInput: number;
  musicInput: number;
  volume?: number;
}): { graph: string; outLabel: string } {
  const volume = opts.volume ?? MUSIC_VOLUME_DEFAULT;
  const graph = [
    `[${opts.narrationInput}:a]asplit=2[narmix][narkey]`,
    `[${opts.musicInput}:a]volume=${volume},aloop=loop=-1:size=2147483647[musicloop]`,
    `[musicloop][narkey]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=400[ducked]`,
    `[narmix][ducked]amix=inputs=2:duration=first:normalize=0[aout]`,
  ].join(';');
  return { graph, outLabel: '[aout]' };
}

export interface RenderResult {
  path: string;
  bytes: number;
  args: string[];
}

/**
 * Render one video. Throws with ffmpeg's own stderr on failure, because a
 * codec or filter complaint is the only thing that explains what went wrong.
 */
export async function renderVideo(opts: {
  ffmpeg: string;
  audioPath: string;
  outputPath: string;
  shape: VideoShape;
  imagePath?: string | null;
  captionsPath?: string | null;
  durationSeconds: number;
  zoom?: boolean;
  /** Concat script for a multi-scene render; a single still is used when absent. */
  concatPath?: string | null;
  /** Absolute path to a background music track. Omit for narration only. */
  musicPath?: string | null;
  /** Music level before ducking; defaults to MUSIC_VOLUME_DEFAULT. */
  musicVolume?: number;
}): Promise<RenderResult> {
  if (!fs.existsSync(opts.audioPath)) {
    throw new Error(`No narration audio at ${opts.audioPath}`);
  }
  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });

  const args = opts.concatPath
    ? buildTimelineRenderArgs({ ...opts, concatPath: opts.concatPath })
    : buildRenderArgs(opts);
  await new Promise<void>((resolve, reject) => {
    execFile(opts.ffmpeg, args, { timeout: 15 * 60_000, maxBuffer: 1024 * 1024 * 16 }, (err, _out, stderr) => {
      if (err) {
        // ffmpeg puts the real reason in the last few stderr lines.
        const tail = String(stderr || '').trim().split('\n').slice(-6).join('\n');
        reject(new Error(tail || err.message));
        return;
      }
      resolve();
    });
  });

  if (!fs.existsSync(opts.outputPath)) {
    throw new Error('ffmpeg reported success but wrote no file');
  }
  const bytes = fs.statSync(opts.outputPath).size;
  // A container with headers and no frames still exists on disk, so size is
  // checked rather than existence alone.
  if (bytes < 10_000) {
    throw new Error(`Rendered file is only ${bytes} bytes — the render produced no usable video`);
  }
  return { path: opts.outputPath, bytes, args };
}
