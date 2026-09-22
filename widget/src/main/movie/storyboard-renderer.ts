/**
 * storyboard-renderer.ts — One-Click 1080p Movie Renderer
 *
 * Compiles a Visual Storyboard project into a finished 1080p MP4 movie using local FFmpeg
 * and HomeBot's configured speech adapter. Online consent stays with that adapter.
 *
 * Key capabilities:
 * 1. Motion: Maps shot movement presets ('slow push in', 'pan right', 'tilt up', 'tracking', 'static')
 *    to cinematic FFmpeg zoompan and scaling filters.
 * 2. Voiceover: Automatically synthesizes narration lines via `renderNarrationToFile` (Edge or Kokoro TTS).
 * 3. Subtitles: Generates and burns aligned SRT dialogue/action subtitles.
 * 4. Output: Saves directly into the project folder (`renders/<projectId>-1080p.mp4`).
 */

import { execFile } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import { createStudioOutputSpec, resolveBurnSubtitles, resolveStudioOutputSpec, type StudioExportAttempt, type StudioOutputSpec, type StudioOutputVariant, type StudioRenderedOutput, type StudioMovieResult } from '../../shared/media-output';
import * as os from 'os';
import * as path from 'path';
import { findFfmpeg, escapeFilterPath, buildStudioFrameFilters, subtitleStyleFor, buildColorGradeFilter, buildMusicAudioGraph,
  MUSIC_VOLUME_DEFAULT, resolveVideoEncoder, type VideoEncoderPreference } from '../media-render';
import { isCustomCaptionStyle } from '../../shared/caption-style';
import { inspectRender, SILENCE_FLOOR_DB, FLAT_FRAME_STDDEV } from '../media-qa';
import { assembleStoryboardScenes, type AssembledScene, type AssembledShot } from './storyboard-assembly';
import { planTimeline, type Timeline } from '../../shared/transitions';
import { buildTransitionAudioGraph, buildTransitionVideoGraph, shotWindows } from './transition-graph';
import { buildTextCardAss, entriesFromShots } from './text-cards';
import type { NarrationEngine } from '../../shared/narration';
import { beginStoryboardExport, endStoryboardExport, recordStoryboardAttempt, storyboardSourceRevision,
  storyboardNarrationEngine, storyboardFileDigest, updateStoryboardExportMeta } from './storyboard-export-state';
import { buildSupersampledKenBurnsFilter } from './ken-burns-filter';

export interface StoryboardRenderOptions {
  projectId: string;
  sceneId?: string;
  motion?: boolean;
  burnSubtitles?: boolean;
  outputName?: string;
  outputSpec?: unknown;
  variantId?: StudioOutputVariant['id'];
  /** Voice for this export. Omit to use the saved setting. */
  narrationEngine?: NarrationEngine;
  /** Optional color grading LUT preset to burn into the export. */
  colorGrade?: string | null;
  /** Background music: true auto-picks from Settings, false disables it, or a local track path/name. */
  music?: boolean | string | null;
  /** Background-music gain from 0 to 1. */
  musicVolume?: number;
  /** Encoder preference. NVENC automatically falls back to software when its real probe fails. */
  encoder?: StoryboardEncoderPreference;
}

export type StoryboardRenderResult = StudioMovieResult;
export type StoryboardEncoderPreference = VideoEncoderPreference;
export { probeNvencSupport, resetNvencProbeCache, resolveVideoEncoder } from '../media-render';
export type { ResolvedVideoEncoder } from '../media-render';

function readableFile(file: unknown): file is string {
  if (typeof file !== 'string' || !file) return false;
  try { const stat = fs.statSync(file); return stat.isFile() && stat.size > 0; } catch { return false; }
}

/** Alias kept for callers/tests written against the older name. */
export type ShotManifest = AssembledShot;

/** Resolves the project directory inside the movie projects folder. */
export function getStoryboardProjectDir(projectId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectId)) {
    throw new Error('Choose a valid storyboard project before exporting.');
  }
  const customRoot = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
  const root = customRoot || path.join(os.homedir(), 'Desktop', 'homebot-movie-projects');
  return path.join(root, projectId);
}

/** Formats seconds into SRT timestamp string: HH:MM:SS,mmm */
export function formatSrtTimestamp(seconds: number): string {
  const totalMs = Math.round(seconds * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/** Builds an SRT subtitles string from a sequence of shots. */
export function buildSrtFromShots(shots: ShotManifest[], timeline?: Timeline): string {
  // Cues follow the finished timeline, so a crossfade cannot slide the words
  // away from the pictures (MS-2).
  const windows = shotWindows(timeline ?? planTimeline(shots));
  let currentTime = 0;
  const blocks: string[] = [];

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const dur = shot.durationSec || 5;
    const startStr = formatSrtTimestamp(windows[i]?.startSec ?? currentTime);
    const endStr = formatSrtTimestamp(windows[i]?.endSec ?? currentTime + dur);
    const text = (shot.narration && shot.narration.trim()) ? shot.narration.trim() : shot.prompt;

    blocks.push(`${i + 1}\n${startStr} --> ${endStr}\n${text}\n`);
    currentTime += dur;
  }

  return blocks.join('\n');
}

/**
 * Supersampling for camera moves (MS-8), measured on this machine.
 *
 * zoompan computes its crop offset in WHOLE pixels of its input, so a 1.5
 * px/frame pan lands on 1 px for one frame and 2 px for the next — uneven
 * motion, which is what reads as judder on slow moves. Two things fix it, and
 * BOTH are needed:
 *
 *   1. Work on a frame twice the size, so a step is half an output pixel.
 *   2. Compute the position from the frame number (`on`) instead of adding to
 *      the previous position, so truncation cannot accumulate.
 *
 * Measured judder (standard deviation of per-frame motion over its mean, on a
 * brightness ramp; 0 is perfectly even):
 *
 *   | pan       | before | supersample only | + absolute position |
 *   |-----------|--------|------------------|---------------------|
 *   | 1.5 px/fr | 0.361  | 0.131            | 0.004               |
 *
 * It only works when the step is a whole number of SUPERSAMPLED pixels: at 2x,
 * 1.2 px/frame (2.4) measured 0.204 while 1.0 (2.0) measured 0.007. So pan
 * speeds are snapped to the supersample grid. Going beyond 2x buys nothing —
 * 4x measured the same 0.007 at roughly double the filter time (1.2s vs 3.3s
 * for two seconds of 1080p).
 */
export { MOTION_SUPERSAMPLE } from './ken-burns-filter';

/** Generates FFmpeg video filter for Ken Burns motion based on shot movement preset. */
export function buildKenBurnsFilter(movement: string, durationSec: number, fps = 30, outputVariant?: StudioOutputVariant): string {
  const base = outputVariant ? buildStudioFrameFilters(outputVariant).join(',') : '';
  if (outputVariant?.framing.mode === 'fit') return base;
  const w = outputVariant?.width ?? 1920;
  const h = outputVariant?.height ?? 1080;
  fps = outputVariant?.fps ?? fps;
  return buildSupersampledKenBurnsFilter(movement, durationSec, fps, { width: w, height: h, baseFilters: base });
}

function runCommand(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 300_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`FFmpeg exited with error (${err.message}): ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function validatedMusicVolume(value: unknown): number {
  const volume = value === undefined ? MUSIC_VOLUME_DEFAULT : value;
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error('Background music volume must be a number from 0 to 1.');
  }
  return volume;
}

async function resolveStoryboardMusic(
  opts: StoryboardRenderOptions,
  projectMeta: Record<string, any>,
  totalDuration: number,
): Promise<{ path: string | null; volume: number; warning?: string }> {
  const { chooseMusic, isMusicFile, listMusicTracks } = await import('../media-music');
  let mediaSettings: Record<string, any> = {};
  try {
    const { getSettings } = await import('../config-manager');
    mediaSettings = getSettings();
  } catch { /* Unit and non-Electron callers can still use an explicit track. */ }

  const requested = opts.music !== undefined
    ? opts.music !== false && opts.music !== null
    : projectMeta.musicEnabled !== undefined
      ? projectMeta.musicEnabled === true
      : mediaSettings.mediaMusicEnabled === true;
  const volume = validatedMusicVolume(opts.musicVolume ?? projectMeta.musicVolume);
  if (!requested) return { path: null, volume };

  const folder = typeof mediaSettings.mediaMusicFolder === 'string' ? mediaSettings.mediaMusicFolder.trim() : '';
  const namedTrack = typeof opts.music === 'string' && opts.music.trim()
    ? opts.music.trim()
    : typeof projectMeta.musicTrack === 'string' ? projectMeta.musicTrack.trim() : '';
  if (namedTrack) {
    if (fs.existsSync(namedTrack) && isMusicFile(namedTrack)) return { path: namedTrack, volume };
    if (folder && fs.existsSync(folder)) {
      const match = listMusicTracks(folder).find(track => path.basename(track).toLowerCase() === path.basename(namedTrack).toLowerCase());
      if (match) return { path: match, volume };
    }
    return { path: null, volume, warning: `The movie was exported without background music because the selected track was not found: ${namedTrack}` };
  }

  const choice = chooseMusic({ enabled: true, folder, seed: Math.round(totalDuration * 1000) });
  return choice.path
    ? { path: choice.path, volume }
    : { path: null, volume, warning: `The movie was exported without background music because ${choice.reason || 'no usable track was available'}.` };
}

/**
 * Compiles a storyboard project into a broadcast 1080p MP4 movie.
 */
export async function renderStoryboardMovie(
  opts: StoryboardRenderOptions
): Promise<StoryboardRenderResult> {
  let projectDir: string;
  let attempt: StudioExportAttempt;
  try {
    projectDir = getStoryboardProjectDir(opts.projectId);
    if (!fs.existsSync(projectDir)) throw new Error(`Storyboard project directory not found: ${projectDir}`);
    if (opts.sceneId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(opts.sceneId)) throw new Error('Choose a valid storyboard scene before exporting.');
    if (opts.musicVolume !== undefined) validatedMusicVolume(opts.musicVolume);
    attempt = beginStoryboardExport(projectDir, opts.sceneId);
  } catch (error) { return { ok: false, error: (error as Error).message }; }
  let prepared: Awaited<ReturnType<typeof prepareStoryboardInputs>> | undefined;
  let children: StudioExportAttempt[] = [];
  try {
    const metaPath = path.join(projectDir, 'project.json');
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
    const requested = opts.outputSpec === undefined ? meta.outputSpec : opts.outputSpec;
    const spec = requested === undefined ? undefined : resolveStudioOutputSpec(requested);
    if (opts.variantId !== undefined && !spec?.variants.some(v => v.id === opts.variantId)) throw new Error('Choose a saved output format to retry.');
    if (opts.outputName && (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.mp4$/.test(opts.outputName) || spec?.variants.length === 2)) {
      throw new Error('Choose an MP4 filename for one format, or let both formats use their own filenames.');
    }
    if (opts.outputName && fs.existsSync(path.join(projectDir, 'renders', opts.outputName))) throw new Error('Choose a new export filename. Existing exports are preserved.');
    const variants = spec?.variants ?? [undefined];
    const selected = opts.variantId === undefined ? variants : variants.filter(v => v?.id === opts.variantId);
    children = selected.map(variant => {
      const child: StudioExportAttempt = variants.length > 1 ? { id: randomUUID(), batchId: attempt.id,
        variantId: variant!.id, status: 'preparing', sourceRevision: null, startedAt: new Date().toISOString(),
        ...(opts.sceneId ? { sceneId: opts.sceneId } : {}) } : attempt;
      if (variant) child.variantId = variant.id;
      recordStoryboardAttempt(projectDir, child);
      return child;
    });
    prepared = await prepareStoryboardInputs({ ...opts, ...(spec ? { outputSpec: spec } : {}) });
    const results: StoryboardRenderResult[] = [];
    for (let i = 0; i < selected.length; i++) {
      const variant = selected[i];
      const child = children[i];
      const result = await renderStoryboardAttempt(opts, child, prepared, variant);
      Object.assign(child, { status: result.ok ? 'succeeded' : 'failed', finishedAt: new Date().toISOString(),
        ...(result.ok ? { exportId: result.renderedOutput?.exportId } : { error: result.error }) });
      recordStoryboardAttempt(projectDir, child);
      results.push({ ...result, ...(variant ? { variantId: variant.id } : {}) });
    }
    if (variants.length === 1) return results[0];
    const ok = results.every(result => result.ok);
    const error = results.flatMap((result, i) => result.ok ? [] : [`${selected[i]?.id}: ${result.error}`]).join('\n');
    recordStoryboardAttempt(projectDir, { ...attempt, status: ok ? 'succeeded' : 'failed', finishedAt: new Date().toISOString(), ...(ok ? {} : { error }) });
    return { ...results.find(result => result.ok), ok,
      variants: results as NonNullable<StoryboardRenderResult['variants']>, ...(ok ? {} : { error }) };
  } catch (error) {
    const message = `Movie export failed: ${(error as Error).message}`;
    try {
      for (const child of children.filter(child => ['preparing', 'rendering', 'validating'].includes(child.status))) {
        recordStoryboardAttempt(projectDir, { ...child, status: 'failed', finishedAt: new Date().toISOString(), error: message });
      }
      recordStoryboardAttempt(projectDir, { ...attempt, status: 'failed', finishedAt: new Date().toISOString(), error: message });
    } catch { /* Storage itself is unavailable; do not claim success. */ }
    return { ok: false, error: message };
  } finally {
    if (prepared) {
      try { fs.rmSync(prepared.inputDir, { recursive: true, force: true }); } catch { /* A remaining diagnostic input directory is not a successful movie. */ }
    }
    endStoryboardExport(projectDir);
  }
}

async function prepareStoryboardInputs(opts: StoryboardRenderOptions) {
  const { findManagedFfmpeg } = await import('../ffmpeg-setup');
  const ffmpeg = await findFfmpeg(findManagedFfmpeg());
  if (!ffmpeg) {
    throw new Error('FFmpeg was not found. Choose "Set it up for me" in Media Studio to install the video engine.');
  }
  // Probe before speech synthesis or frame work. A missing GPU must become a
  // cheap, transparent CPU fallback rather than failing after expensive prep.
  const videoEncoder = await resolveVideoEncoder(ffmpeg, opts.encoder);

  let projectDir: string;
  try {
    projectDir = getStoryboardProjectDir(opts.projectId);
  } catch (error) {
    throw new Error((error as Error).message);
  }
  if (!fs.existsSync(projectDir)) {
    throw new Error(`Storyboard project directory not found: ${projectDir}`);
  }

  const metaPath = path.join(projectDir, 'project.json');
  let projectMeta: Record<string, any>;
  let outputSpec: StudioOutputSpec | undefined;
  let burnSubtitles: boolean;
  try {
    projectMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
    const requestedSpec = opts.outputSpec === undefined ? projectMeta.outputSpec : opts.outputSpec;
    outputSpec = requestedSpec === undefined ? undefined : resolveStudioOutputSpec(requestedSpec);
    if (outputSpec && !fs.existsSync(metaPath)) throw new Error('Save this project before choosing an export format.');
    burnSubtitles = resolveBurnSubtitles(opts.burnSubtitles, resolveBurnSubtitles(projectMeta.burnSubtitles));
  } catch (error) {
    throw new Error(`Could not read output settings: ${(error as Error).message}`);
  }
  const sceneId = opts.sceneId;
  if (sceneId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(sceneId)) {
    throw new Error('Choose a valid storyboard scene before exporting.');
  }
  let shots: ShotManifest[];
  let sourceScenes: AssembledScene[];
  try {
    sourceScenes = assembleStoryboardScenes(projectDir).filter(scene => !sceneId || scene.sceneId === sceneId);
    shots = sourceScenes.flatMap(scene => scene.shots);
  } catch (error) {
    throw new Error(`Could not read the saved storyboard: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(shots) || shots.length === 0) {
    throw new Error('Storyboard scene contains no shots to render.');
  }

  // A saved manifest is input, not proof that its shots can be exported.
  if (shots.some(s => !s || typeof s.durationSec !== 'number' || !Number.isFinite(s.durationSec) || s.durationSec <= 0)) {
    throw new Error('Every shot needs a positive duration. Fix the shot timing and save the board before exporting.');
  }
  if (shots.some(s => typeof s.prompt !== 'string' || (s.narration !== undefined && typeof s.narration !== 'string'))) {
    throw new Error('A shot has invalid text. Open and save the storyboard before exporting.');
  }
  // A shot is exportable with a rendered keyframe OR a generated video clip
  // (PROV-4): a Veo shot has no keyframe, and requiring one would make every
  // video shot unrenderable.
  const missingFrames = shots.filter(s => !readableFile(s.frameImagePath) && !readableFile(s.videoClipPath));
  if (missingFrames.length === shots.length) {
    throw new Error('No rendered keyframes or video clips found for this storyboard. Generate frames or clips first before rendering.');
  }
  if (missingFrames.length > 0) {
    throw new Error(`${missingFrames.length} shot image(s) are missing or empty. Generate or replace those frames before exporting.`);
  }

  const rendersDir = path.join(projectDir, 'renders');
  let tempDir: string | undefined;

  try {
    fs.mkdirSync(rendersDir, { recursive: true });
    if (fs.realpathSync(rendersDir) !== path.join(fs.realpathSync(projectDir), 'renders')) throw new Error('The render folder must be inside this project, not a linked directory.');
    // Stage on the same filesystem. A failed replacement must retain the last good export.
    tempDir = fs.mkdtempSync(path.join(rendersDir, '.homebot-inputs-'));
    // Copy the inputs this attempt actually uses. An edit made while FFmpeg is
    // running must not produce a movie claiming the earlier image's revision.
    const snapshotScenes = sourceScenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => ({ ...shot })) }));
    let imageIndex = 0;
    for (const scene of snapshotScenes) {
      for (const shot of scene.shots) {
        if (readableFile(shot.videoClipPath)) {
          const copy = path.join(tempDir, `source-${imageIndex++}.mp4`);
          fs.copyFileSync(shot.videoClipPath!, copy, fs.constants.COPYFILE_EXCL);
          shot.videoClipPath = copy;
        } else {
          const copy = path.join(tempDir, `source-${imageIndex++}${path.extname(shot.frameImagePath!)}`);
          fs.copyFileSync(shot.frameImagePath!, copy, fs.constants.COPYFILE_EXCL);
          shot.frameImagePath = copy;
        }
      }
    }
    shots = snapshotScenes.flatMap(scene => scene.shots);
    // A video clip shorter than its shot cannot fill the timeline slot without
    // dragging every later shot early; refuse with the numbers instead.
    for (const shot of shots) {
      if (!readableFile(shot.videoClipPath)) continue;
      const clipFacts = await inspectRender(ffmpeg, shot.videoClipPath);
      if (!clipFacts.hasVideo || !clipFacts.durationSeconds) {
        throw new Error(`The generated clip for shot ${shot.shotId} cannot be decoded. Generate the clip again before exporting.`);
      }
      if (clipFacts.durationSeconds < shot.durationSec - 0.15) {
        throw new Error(`The clip for shot ${shot.shotId} runs ${clipFacts.durationSeconds.toFixed(1)}s but the shot needs ${shot.durationSec}s. Shorten the shot or generate a new clip.`);
      }
    }
    // The voice chosen for THIS export wins over the saved setting: with Online
    // off, the online voice throws and the only way out used to be Settings.
    const engine = opts.narrationEngine ?? storyboardNarrationEngine();
    // One timeline decides picture, voice and captions: a transition overlaps
    // two shots, so the movie is shorter than the sum of its shots (MS-2).
    const timeline = planTimeline(shots);
    const totalDuration = timeline.totalSec;
    const motion = opts.motion !== false;
    const hasNarration = shots.some(shot => !!shot.narration?.trim());

    // 1. Render Audio Track (Voiceover per shot or silent bed)
    const audioSegments: string[] = [];
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const dur = shot.durationSec;
      const shotAudioPath = path.join(tempDir, `shot_${String(i).padStart(3, '0')}.wav`);

      if (shot.narration && shot.narration.trim()) {
        const { renderNarrationToFile } = await import('../tools/voice');
        // Edge writes audio.mp3 and Kokoro writes narration.wav. Give each shot
        // a separate directory and use the returned path, including its actual codec.
        const speechDir = path.join(tempDir, `speech_${i}`);
        fs.mkdirSync(speechDir);
        // Framing retries must not buy/generate the same speech again. Only
        // reuse exact text + requested engine and verified local audio bytes.
        const cacheDir = path.join(rendersDir, '.homebot-narration');
        fs.mkdirSync(cacheDir, { recursive: true });
        if (fs.realpathSync(cacheDir) !== path.join(fs.realpathSync(rendersDir), '.homebot-narration')) throw new Error('The narration cache must be inside this project.');
        const cacheKey = createHash('sha256').update(JSON.stringify({ schema: 'storyboard-narration-1', text: shot.narration.trim(), engine, voice: 'adapter-default' })).digest('hex');
        const cacheMetaPath = path.join(cacheDir, `${cacheKey}.json`);
        let audio: { path: string; engine: string } | undefined;
        try {
          if (fs.realpathSync(cacheMetaPath) !== path.join(fs.realpathSync(cacheDir), `${cacheKey}.json`)) throw new Error('Linked cache record');
          const cached = JSON.parse(fs.readFileSync(cacheMetaPath, 'utf8'));
          if (cached.key !== cacheKey || typeof cached.filename !== 'string' ||
              !new RegExp(`^${cacheKey}-[a-f0-9-]+\\.(wav|mp3)$`).test(cached.filename)) throw new Error('Invalid cache identity');
          const cachedPath = path.join(cacheDir, cached.filename);
          if (fs.realpathSync(cachedPath) !== path.join(fs.realpathSync(cacheDir), cached.filename) ||
              !readableFile(cachedPath) || await storyboardFileDigest(cachedPath) !== cached.sha256) throw new Error('Changed cached audio');
          audio = { path: cachedPath, engine: cached.engine };
        } catch { /* Missing/unverifiable cache is not usable speech. The adapter below still enforces Online consent. */ }
        const reused = !!audio;
        audio ??= await renderNarrationToFile(shot.narration.trim(), path.join(speechDir, 'audio.mp3'), { engine });
        if (!readableFile(audio.path)) throw new Error(`Narration for shot ${i + 1} produced no usable audio file.`);
        const facts = await inspectRender(ffmpeg, audio.path);
        if (!facts.hasAudio || !Number.isFinite(facts.durationSeconds) || !facts.durationSeconds ||
            facts.meanVolumeDb === null || !Number.isFinite(facts.meanVolumeDb) || facts.meanVolumeDb < SILENCE_FLOOR_DB) {
          throw new Error(`Narration for shot ${i + 1} could not be verified as audible speech. Check the selected voice and retry.`);
        }
        if (!reused) {
          const extension = path.extname(audio.path).toLowerCase() === '.wav' ? '.wav' : '.mp3';
          const filename = `${cacheKey}-${randomUUID()}${extension}`;
          const cachedPath = path.join(cacheDir, filename);
          fs.copyFileSync(audio.path, cachedPath, fs.constants.COPYFILE_EXCL);
          const stagedMeta = `${cacheMetaPath}.${randomUUID()}.saving`;
          fs.writeFileSync(stagedMeta, JSON.stringify({ key: cacheKey, filename, sha256: await storyboardFileDigest(cachedPath), engine: audio.engine }), { flag: 'wx' });
          fs.renameSync(stagedMeta, cacheMetaPath);
        }
        if (facts.durationSeconds > dur + 0.05) {
          throw new Error(`Narration for shot ${i + 1} needs ${facts.durationSeconds.toFixed(1)} seconds. Increase its duration from ${dur} seconds or shorten the text.`);
        }
        // Padding prevents the next voice line starting early. Longer speech is
        // rejected above so fitting the audio never silently removes spoken words.
        await runCommand(ffmpeg, [
          '-y', '-i', audio.path, '-af', 'apad', '-t', String(dur),
          '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', shotAudioPath,
        ]);
      } else {
        // Generate silent segment matching shot duration
        await runCommand(ffmpeg, [
          '-y',
          '-f', 'lavfi',
          '-i', 'anullsrc=r=48000:cl=stereo',
          '-t', String(dur),
          '-c:a', 'pcm_s16le',
          shotAudioPath,
        ]);
      }
      audioSegments.push(shotAudioPath);
    }

    // Concatenate all audio segments
    const audioConcatList = path.join(tempDir, 'audio_concat.txt');
    const audioConcatContent = audioSegments
      .map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(audioConcatList, audioConcatContent, 'utf-8');

    const combinedAudioPath = path.join(tempDir, 'combined_audio.wav');
    await runCommand(ffmpeg, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', audioConcatList,
      '-c:a', 'pcm_s16le',
      combinedAudioPath,
    ]);

    // Resolve one deterministic local track for the complete export. A
    // transition timeline mixes it inside the final graph below; a cut-only
    // timeline can mix once here and reuse the resulting narration-length WAV.
    const music = await resolveStoryboardMusic(opts, projectMeta, totalDuration);
    let finalAudioPath = combinedAudioPath;
    if (music.path && !timeline.hasTransition) {
      const duckedAudioPath = path.join(tempDir, 'ducked_audio.wav');
      const mix = buildMusicAudioGraph({ narrationInput: 0, musicInput: 1, volume: music.volume, labelPrefix: 'story' });
      await runCommand(ffmpeg, [
        '-y', '-i', combinedAudioPath, '-i', music.path,
        '-filter_complex', mix.graph, '-map', mix.outLabel,
        '-c:a', 'pcm_s16le', duckedAudioPath,
      ]);
      finalAudioPath = duckedAudioPath;
    }

    // 2. Generate Subtitles file
    let srtPath: string | null = null;
    if (burnSubtitles) {
      srtPath = path.join(tempDir, 'subtitles.srt');
      const srtText = buildSrtFromShots(shots, timeline);
      fs.writeFileSync(srtPath, srtText, 'utf-8');
    }

    return { ffmpeg, projectDir, projectMeta, outputSpec, burnSubtitles, sceneId, shots, snapshotScenes,
      engine, totalDuration, motion, hasNarration, combinedAudioPath: finalAudioPath, audioSegments, timeline, srtPath,
      musicTrackPath: music.path, musicVolume: music.volume, musicWarning: music.warning, videoEncoder,
      inputDir: tempDir, rendersDir };
  } catch (error) {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function renderStoryboardAttempt(opts: StoryboardRenderOptions, attempt: StudioExportAttempt,
  prepared: Awaited<ReturnType<typeof prepareStoryboardInputs>>, variant?: StudioOutputVariant,
): Promise<StoryboardRenderResult> {
  const { ffmpeg, projectDir, projectMeta, burnSubtitles, sceneId, shots, snapshotScenes, engine,
    totalDuration, motion, hasNarration, combinedAudioPath, audioSegments, timeline, srtPath, rendersDir,
    musicTrackPath, musicVolume, musicWarning, videoEncoder } = prepared;
  const outputSpec = prepared.outputSpec ? { ...prepared.outputSpec, variants: [variant!] } : undefined;
  const outputVariant = variant;
  const width = variant?.width ?? 1920;
  const height = variant?.height ?? 1080;
  const fps = variant?.fps ?? 30;
  // The owner's saved caption style; legacy projects without an output shape keep their fixed 1080p style.
  const subtitleStyle = variant ? subtitleStyleFor(variant.aspectRatio, projectMeta.captionStyle)
    : isCustomCaptionStyle(projectMeta.captionStyle) ? subtitleStyleFor('16:9', projectMeta.captionStyle)
    : 'FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=35';
  const exportId = attempt.id;
  const outputFilename = opts.outputName || `${opts.projectId}${sceneId ? `-${sceneId}` : ''}-${variant?.id ?? '1080p'}-${exportId}.mp4`;
  const finalMoviePath = path.join(rendersDir, outputFilename);
  let tempDir: string | undefined;
  try {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.mp4$/.test(outputFilename)) throw new Error('The export needs an MP4 filename inside this project.');
    if (fs.existsSync(finalMoviePath)) throw new Error('Choose a new export filename. Existing exports are preserved.');
    tempDir = fs.mkdtempSync(path.join(rendersDir, '.homebot-render-'));

    // Title cards are measured against THIS variant's frame, so the same board
    // fits both 16:9 and 9:16 (movie/text-cards.ts).
    let textCardsPath: string | null = null;
    const cardAss = await buildTextCardAss(entriesFromShots(shots, shotWindows(timeline)), { width, height });
    if (cardAss) {
      textCardsPath = path.join(tempDir, 'text-cards.ass');
      fs.writeFileSync(textCardsPath, cardAss, 'utf-8');
    }
    const stagedMoviePath = path.join(tempDir, 'movie.mp4');
    const exportWarning = [musicWarning, videoEncoder.warning].filter(Boolean).join(' ') || undefined;
    attempt.sourceRevision = await storyboardSourceRevision(snapshotScenes, {
      ...projectMeta, outputSpec, burnSubtitles,
      ...(opts.music !== undefined ? { musicEnabled: opts.music !== false && opts.music !== null } : {}),
      ...(opts.musicVolume !== undefined ? { musicVolume } : {}),
    }, { sceneId, motion: opts.motion, engine });
    attempt.status = 'rendering';
    recordStoryboardAttempt(projectDir, attempt);

    // 3. Render Video Track
    if (timeline.hasTransition) {
      // Transitions overlap two shots, so the clips cannot simply be
      // concatenated: xfade dissolves them and the voices are placed at the
      // start times the finished timeline gives each shot (MS-2).
      const clips: string[] = [];
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        const clipPath = path.join(tempDir, `t_clip_${String(i).padStart(3, '0')}.mp4`);
        const stillFilter = outputVariant ? buildStudioFrameFilters(outputVariant).join(',') : 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080';
        // A video shot (PROV-4) is trimmed to the shot duration from its own
        // moving frames — no Ken Burns over a moving clip — and its built-in
        // audio is dropped, because the narration track owns the sound.
        const isVideoShot = readableFile(shot.videoClipPath);
        const frameFilter = isVideoShot ? stillFilter
          : motion ? buildKenBurnsFilter(shot.movement || 'static', shot.durationSec, fps, outputVariant) : stillFilter;
        const vf = [frameFilter, buildColorGradeFilter(opts.colorGrade), 'format=yuv420p'].filter(Boolean).join(',');
        const inputArgs = isVideoShot
          ? ['-i', shot.videoClipPath!, '-an']
          : ['-loop', '1', '-i', shot.frameImagePath!];
        await runCommand(ffmpeg, ['-y', ...inputArgs, '-vf', vf,
          '-c:v', videoEncoder.encoder, '-preset', videoEncoder.preset, '-t', String(shot.durationSec), '-r', String(fps), clipPath]);
        clips.push(clipPath);
      }

      const video = buildTransitionVideoGraph(timeline, fps);
      const audio = buildTransitionAudioGraph(timeline, clips.length);
      const overlays: string[] = [];
      if (srtPath && fs.existsSync(srtPath)) overlays.push(`subtitles='${escapeFilterPath(srtPath)}':force_style='${subtitleStyle}'`);
      if (textCardsPath) overlays.push(`subtitles='${escapeFilterPath(textCardsPath)}'`);
      const music = musicTrackPath
        ? buildMusicAudioGraph({ narrationInput: audio.outLabel, musicInput: clips.length + audioSegments.length,
            volume: musicVolume, labelPrefix: 'transition_bgm' })
        : null;
      const graph = [video.filter, overlays.length ? `${video.outLabel}${overlays.join(',')}[vfinal]` : '', audio.filter, music?.graph]
        .filter(Boolean).join(';');
      const videoOut = overlays.length ? '[vfinal]' : video.outLabel;
      const audioOut = music?.outLabel ?? audio.outLabel;

      await runCommand(ffmpeg, [
        '-y',
        ...clips.flatMap(clip => ['-i', clip]),
        ...audioSegments.flatMap(segment => ['-i', segment]),
        ...(musicTrackPath ? ['-i', musicTrackPath] : []),
        '-filter_complex', graph,
        '-map', videoOut, '-map', audioOut,
        '-c:v', videoEncoder.encoder, '-preset', videoEncoder.preset, '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-t', String(totalDuration), '-movflags', '+faststart',
        stagedMoviePath,
      ]);
    } else if (motion || shots.some(shot => readableFile(shot.videoClipPath))) {
      // Per-shot Ken Burns motion clips; also the only concat-safe path when a
      // video shot is present (an MP4 cannot join an image ffconcat list).
      const videoClips: string[] = [];
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        const dur = shot.durationSec;
        const imgPath = shot.frameImagePath!;

        const shotClipPath = path.join(tempDir, `clip_${String(i).padStart(3, '0')}.mp4`);
        const isVideoShot = readableFile(shot.videoClipPath);
        const stillFilter = outputVariant ? buildStudioFrameFilters(outputVariant).join(',') : 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080';
        const kbFilter = isVideoShot ? stillFilter : buildKenBurnsFilter(shot.movement || 'static', dur, fps, outputVariant);
        const lutFilter = buildColorGradeFilter(opts.colorGrade);
        const vf = [kbFilter, lutFilter, 'format=yuv420p'].filter(Boolean).join(',');

        const videoInputArgs = isVideoShot
          ? ['-i', shot.videoClipPath!, '-an']
          : ['-loop', '1', '-i', imgPath];
        await runCommand(ffmpeg, [
          '-y',
          ...videoInputArgs,
          '-vf', vf,
          '-c:v', videoEncoder.encoder,
          '-preset', videoEncoder.preset,
          '-t', String(dur),
          '-r', String(fps),
          shotClipPath,
        ]);
        videoClips.push(shotClipPath);
      }

      // Concatenate video clips and mux with audio & subtitles
      const videoConcatList = path.join(tempDir, 'video_concat.txt');
      const videoConcatContent = videoClips
        .map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
        .join('\n');
      fs.writeFileSync(videoConcatList, videoConcatContent, 'utf-8');

      const muxArgs: string[] = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', videoConcatList,
        '-i', combinedAudioPath,
      ];

      const muxFilters: string[] = [];
      if (srtPath && fs.existsSync(srtPath)) {
        muxFilters.push(`subtitles='${escapeFilterPath(srtPath)}':force_style='${subtitleStyle}'`);
      }
      // After the captions, so a card sits over them rather than under.
      if (textCardsPath) muxFilters.push(`subtitles='${escapeFilterPath(textCardsPath)}'`);
      if (muxFilters.length) muxArgs.push('-vf', muxFilters.join(','));

      muxArgs.push(
        '-c:v', videoEncoder.encoder,
        '-preset', videoEncoder.encoder === 'libx264' ? 'fast' : videoEncoder.preset,
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-t', String(totalDuration),
        '-movflags', '+faststart',
        stagedMoviePath
      );

      await runCommand(ffmpeg, muxArgs);
    } else {
      // Fast Timeline Render without Ken Burns
      const concatListPath = path.join(tempDir, 'timeline_concat.txt');
      const line = (p: string) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
      const rows: string[] = ['ffconcat version 1.0'];
      for (const s of shots) {
        rows.push(line(s.frameImagePath!));
        rows.push(`duration ${s.durationSec.toFixed(3)}`);
      }
      rows.push(line(shots[shots.length - 1].frameImagePath!));
      fs.writeFileSync(concatListPath, rows.join('\n') + '\n', 'utf-8');

      const filters = [
        `fps=${fps}`,
        ...(outputVariant ? buildStudioFrameFilters(outputVariant) : [
          'scale=1920:1080:force_original_aspect_ratio=increase', 'crop=1920:1080',
        ]),
      ];
      if (srtPath && fs.existsSync(srtPath)) {
        const escapedSrt = escapeFilterPath(srtPath);
        filters.push(`subtitles='${escapedSrt}':force_style='${subtitleStyle}'`);
      }
      if (textCardsPath) filters.push(`subtitles='${escapeFilterPath(textCardsPath)}'`);
      const lutFilter = buildColorGradeFilter(opts.colorGrade);
      if (lutFilter) filters.push(lutFilter);
      filters.push('format=yuv420p');

      await runCommand(ffmpeg, [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-i', combinedAudioPath,
        '-vf', filters.join(','),
        '-c:v', videoEncoder.encoder,
        '-preset', videoEncoder.preset,
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-t', String(totalDuration),
        '-movflags', '+faststart',
        stagedMoviePath,
      ]);
    }

    attempt.status = 'validating';
    recordStoryboardAttempt(projectDir, attempt);
    if (!readableFile(stagedMoviePath)) throw new Error('The video engine produced no usable movie file.');
    // Require a complete decode as well as metadata. An MP4 header or successful
    // encoder exit alone cannot establish that its video/audio packets are readable.
    await runCommand(ffmpeg, ['-v', 'error', '-xerror', '-i', stagedMoviePath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    const facts = await inspectRender(ffmpeg, stagedMoviePath);
    if (!facts.hasVideo || facts.width !== width || facts.height !== height || !facts.hasAudio ||
        !Number.isFinite(facts.durationSeconds) || facts.durationSeconds === null ||
        Math.abs(facts.durationSeconds - totalDuration) > 0.15) {
      throw new Error('The exported video did not match the storyboard duration, picture size or audio tracks. The previous export has been kept.');
    }
    if (hasNarration && (facts.meanVolumeDb === null || !Number.isFinite(facts.meanVolumeDb) || facts.meanVolumeDb < SILENCE_FLOOR_DB)) {
      throw new Error('The exported narration is missing or silent. Check the selected voice and retry.');
    }
    // A render can match every number above and still be a solid-color
    // placeholder — every frame the same flat color with narration playing
    // over it. This is the same gate the job pipeline (evaluateRenderQa) and
    // the movie runner apply; fail only when EVERY sampled frame is flat, so
    // one legitimately simple frame does not trip it.
    if (facts.frameSamples && facts.frameSamples.length > 0) {
      const maxStdDev = Math.max(...facts.frameSamples.map(s => s.stdDev));
      if (maxStdDev < FLAT_FRAME_STDDEV) {
        throw new Error('The exported video is a flat color with no picture content — the frames look like placeholders, not real scene art. The previous export has been kept.');
      }
    }
    // The existence check above is only a friendly early error. EXCL is the
    // actual no-overwrite guarantee if another process creates that name later.
    fs.copyFileSync(stagedMoviePath, finalMoviePath, fs.constants.COPYFILE_EXCL);
    const renderedOutput: StudioRenderedOutput = { exportId, filename: outputFilename, createdAt: new Date().toISOString(),
        sourceSavedAt: typeof projectMeta.updatedAt === 'string' ? projectMeta.updatedAt : null,
        durationSeconds: facts.durationSeconds, burnSubtitles,
        outputSpec: outputSpec ?? createStudioOutputSpec('16:9', totalDuration > 60 ? 'long' : 'short', '1080p', 'crop'),
        sourceRevision: attempt.sourceRevision!, fileSizeBytes: fs.statSync(finalMoviePath).size,
        sha256: await storyboardFileDigest(finalMoviePath), motion, ...(sceneId ? { sceneId } : {}) };
    fs.writeFileSync(`${finalMoviePath}.json`, JSON.stringify(renderedOutput, null, 2), { flag: 'wx' });
    if (!sceneId) {
        // Keep any edits made while rendering. The output records its original
        // specification; saving the pointer must not overwrite newer settings.
        updateStoryboardExportMeta(projectDir, { latestSuccessfulOutput: renderedOutput });
    }
    return {
      ok: true,
      moviePath: finalMoviePath,
      durationSec: facts.durationSeconds,
      totalShots: shots.length,
      burnSubtitles,
      ...(outputSpec ? { outputSpec } : {}), renderedOutput,
      ...(exportWarning ? { warning: exportWarning } : {}),
    };
  } catch (error) {
    return { ok: false, error: `Movie export failed: ${(error as Error).message}` };
  } finally {
    // Cleanup temporary files
    try {
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error */
    }
  }
}
