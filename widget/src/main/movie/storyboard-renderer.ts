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
import { findFfmpeg, escapeFilterPath, buildStudioFrameFilters, subtitleStyleFor, buildColorGradeFilter, buildMusicAudioGraph, MUSIC_VOLUME_DEFAULT } from '../media-render';
import { isCustomCaptionStyle } from '../../shared/caption-style';
import { inspectRender, SILENCE_FLOOR_DB, FLAT_FRAME_STDDEV } from '../media-qa';
import { assembleStoryboardScenes, type AssembledScene, type AssembledShot } from './storyboard-assembly';
import { planTimeline, type Timeline } from '../../shared/transitions';
import { buildTransitionAudioGraph, buildTransitionVideoGraph, shotWindows } from './transition-graph';
import { buildTextCardAss, entriesFromShots } from './text-cards';
import type { NarrationEngine } from '../../shared/narration';
import { beginStoryboardExport, endStoryboardExport, recordStoryboardAttempt, storyboardSourceRevision,
  storyboardNarrationEngine, storyboardFileDigest, updateStoryboardExportMeta } from './storyboard-export-state';

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
  /** Background music track: true (auto-pick), false (no music), or specific track name/path. */
  music?: boolean | string | null;
  /** Volume level for background music (default 0.18). */
  musicVolume?: number;
  /** Preferred video encoder ('auto' | 'nvenc' | 'cpu'). Default 'auto'. */
  encoder?: 'auto' | 'nvenc' | 'cpu';
}

export type StoryboardRenderResult = StudioMovieResult;

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
export const MOTION_SUPERSAMPLE = 2;

/** Generates FFmpeg video filter for Ken Burns motion based on shot movement preset. */
export function buildKenBurnsFilter(movement: string, durationSec: number, fps = 30, outputVariant?: StudioOutputVariant): string {
  const base = outputVariant ? buildStudioFrameFilters(outputVariant).join(',') : '';
  if (outputVariant?.framing.mode === 'fit') return base;
  const w = outputVariant?.width ?? 1920;
  const h = outputVariant?.height ?? 1080;
  fps = outputVariant?.fps ?? fps;
  const k = MOTION_SUPERSAMPLE;
  // Bicubic on the way up: nearest would put the same stair-step back.
  const framed = (filter: string) => [base, `scale=iw*${k}:ih*${k}:flags=bicubic`, filter].filter(Boolean).join(',');
  const frames = Math.max(1, Math.round(durationSec * fps));
  const move = movement.toLowerCase().trim();
  /** A pan speed in output pixels per frame, snapped to whole supersampled pixels. */
  const step = (outputPixelsPerFrame: number) => Math.max(1, Math.round(outputPixelsPerFrame * k));

  if (move === 'slow push in') {
    // Zoom from 1.0 to 1.25 toward center
    return framed(`zoompan=z='min(1+0.0015*on,1.25)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=${fps}`);
  } else if (move === 'pan right') {
    // Constant 1.15 scale with horizontal rightward pan
    return framed(`zoompan=z='1.15':x='min((iw-iw/zoom)/2+on*${step(1.5)},iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`);
  } else if (move === 'tilt up') {
    // Constant 1.15 scale with upward vertical tilt
    return framed(`zoompan=z='1.15':x='iw/2-(iw/zoom/2)':y='max((ih-ih/zoom)/2-on*${step(1.5)},0)':d=${frames}:s=${w}x${h}:fps=${fps}`);
  } else if (move === 'tracking') {
    // Slight zoom with diagonal flow. 1.0 px/frame, not 1.2: 1.2 does not land
    // on the supersample grid and measured 30x more judder (0.204 vs 0.007).
    return framed(`zoompan=z='min(1+0.001*on,1.18)':x='min((iw-iw/zoom)/2+on*${step(1)},iw-iw/zoom)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`);
  } else {
    // Static locked shot: scale to fill 1920x1080 cleanly
    return base || `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080`;
  }
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

let cachedNvencSupport: boolean | null = null;

export function resetNvencProbeCache(val: boolean | null = null): void {
  cachedNvencSupport = val;
}

/**
 * Detects whether the local FFmpeg build and hardware GPU support h264_nvenc encoding.
 */
export async function probeNvencSupport(ffmpeg: string): Promise<boolean> {
  if (cachedNvencSupport !== null) return cachedNvencSupport;
  try {
    await runCommand(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=duration=0.04:size=320x240:rate=25',
      '-c:v', 'h264_nvenc',
      '-f', 'null',
      '-',
    ]);
    cachedNvencSupport = true;
    return true;
  } catch {
    cachedNvencSupport = false;
    return false;
  }
}

/**
 * Resolves video encoder and preset based on user preference and hardware capabilities.
 * Supports 'auto' (GPU NVENC preferred, falling back to CPU), 'nvenc', and 'cpu' (libx264).
 */
export async function resolveVideoEncoder(
  ffmpeg: string,
  requested?: 'auto' | 'nvenc' | 'cpu'
): Promise<{ encoder: 'h264_nvenc' | 'libx264'; preset: string }> {
  if (requested === 'cpu') {
    return { encoder: 'libx264', preset: 'veryfast' };
  }
  const supported = await probeNvencSupport(ffmpeg);
  if (requested === 'nvenc') {
    if (supported) return { encoder: 'h264_nvenc', preset: 'p4' };
    throw new Error('NVENC GPU acceleration was requested but h264_nvenc is not supported on this device.');
  }
  // 'auto': use NVENC if available, else libx264
  if (supported) {
    return { encoder: 'h264_nvenc', preset: 'p4' };
  }
  return { encoder: 'libx264', preset: 'veryfast' };
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
  const missingFrames = shots.filter(s => !readableFile(s.frameImagePath));
  if (missingFrames.length === shots.length) {
    throw new Error('No rendered keyframes found for this storyboard. Please generate frames first before rendering.');
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
        const copy = path.join(tempDir, `source-${imageIndex++}${path.extname(shot.frameImagePath!)}`);
        fs.copyFileSync(shot.frameImagePath!, copy, fs.constants.COPYFILE_EXCL);
        shot.frameImagePath = copy;
      }
    }
    shots = snapshotScenes.flatMap(scene => scene.shots);
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

    // 2. Mix background music if requested (MS-4)
    let finalAudioPath = combinedAudioPath;
    const { chooseMusic, listMusicTracks } = await import('../media-music');
    let mediaSettings: any = null;
    try {
      const { getSettings } = await import('../config-manager');
      mediaSettings = getSettings();
    } catch {
      /* Non-electron or test environment */
    }
    const musicWanted = opts.music !== undefined
      ? Boolean(opts.music)
      : (projectMeta.musicEnabled !== undefined ? Boolean(projectMeta.musicEnabled) : !!mediaSettings?.mediaMusicEnabled);
    const musicFolder = (mediaSettings?.mediaMusicFolder || '').trim();
    let musicTrackPath: string | null = null;

    if (musicWanted) {
      if (typeof opts.music === 'string' && opts.music.trim()) {
        const candidate = opts.music.trim();
        if (fs.existsSync(candidate)) {
          musicTrackPath = candidate;
        } else if (musicFolder && fs.existsSync(musicFolder)) {
          const tracks = listMusicTracks(musicFolder);
          const matched = tracks.find(t => path.basename(t).toLowerCase() === path.basename(candidate).toLowerCase());
          if (matched) musicTrackPath = matched;
        }
      } else if (typeof projectMeta.musicTrack === 'string' && projectMeta.musicTrack.trim()) {
        const candidate = projectMeta.musicTrack.trim();
        if (fs.existsSync(candidate)) {
          musicTrackPath = candidate;
        } else if (musicFolder && fs.existsSync(musicFolder)) {
          const tracks = listMusicTracks(musicFolder);
          const matched = tracks.find(t => path.basename(t).toLowerCase() === path.basename(candidate).toLowerCase());
          if (matched) musicTrackPath = matched;
        }
      } else if (musicFolder && fs.existsSync(musicFolder)) {
        const choice = chooseMusic({ enabled: true, folder: musicFolder, seed: Math.round(totalDuration) });
        musicTrackPath = choice.path;
      }
    }

    if (musicTrackPath && fs.existsSync(musicTrackPath)) {
      const volume = opts.musicVolume ?? projectMeta.musicVolume ?? MUSIC_VOLUME_DEFAULT;
      const duckedAudioPath = path.join(tempDir, 'ducked_audio.wav');
      if (hasNarration) {
        const { graph, outLabel } = buildMusicAudioGraph({
          narrationInput: 0,
          musicInput: 1,
          volume,
        });
        await runCommand(ffmpeg, [
          '-y',
          '-i', combinedAudioPath,
          '-i', musicTrackPath,
          '-filter_complex', graph,
          '-map', outLabel,
          '-c:a', 'pcm_s16le',
          duckedAudioPath,
        ]);
      } else {
        await runCommand(ffmpeg, [
          '-y',
          '-i', musicTrackPath,
          '-filter_complex', `[0:a]volume=${volume},aloop=loop=-1:size=2147483647[aout]`,
          '-map', '[aout]',
          '-t', String(totalDuration),
          '-c:a', 'pcm_s16le',
          duckedAudioPath,
        ]);
      }
      finalAudioPath = duckedAudioPath;
    }

    // 3. Generate Subtitles file
    let srtPath: string | null = null;
    if (burnSubtitles) {
      srtPath = path.join(tempDir, 'subtitles.srt');
      const srtText = buildSrtFromShots(shots, timeline);
      fs.writeFileSync(srtPath, srtText, 'utf-8');
    }

    return { ffmpeg, projectDir, projectMeta, outputSpec, burnSubtitles, sceneId, shots, snapshotScenes,
      engine, totalDuration, motion, hasNarration, combinedAudioPath: finalAudioPath, audioSegments, timeline, srtPath, inputDir: tempDir, rendersDir };
  } catch (error) {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function renderStoryboardAttempt(opts: StoryboardRenderOptions, attempt: StudioExportAttempt,
  prepared: Awaited<ReturnType<typeof prepareStoryboardInputs>>, variant?: StudioOutputVariant,
): Promise<StoryboardRenderResult> {
  const { ffmpeg, projectDir, projectMeta, burnSubtitles, sceneId, shots, snapshotScenes, engine,
    totalDuration, motion, hasNarration, combinedAudioPath, audioSegments, timeline, srtPath, rendersDir } = prepared;
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
    attempt.sourceRevision = await storyboardSourceRevision(snapshotScenes, { ...projectMeta, outputSpec, burnSubtitles }, { sceneId, motion: opts.motion, engine });
    attempt.status = 'rendering';
    recordStoryboardAttempt(projectDir, attempt);

    // 3. Render Video Track (MS-9 GPU acceleration with CPU fallback)
    const videoEncoder = await resolveVideoEncoder(ffmpeg, opts.encoder);
    if (timeline.hasTransition) {
      // Transitions overlap two shots, so the clips cannot simply be
      // concatenated: xfade dissolves them and the voices are placed at the
      // start times the finished timeline gives each shot (MS-2).
      const clips: string[] = [];
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        const clipPath = path.join(tempDir, `t_clip_${String(i).padStart(3, '0')}.mp4`);
        const frameFilter = motion
          ? buildKenBurnsFilter(shot.movement || 'static', shot.durationSec, fps, outputVariant)
          : (outputVariant ? buildStudioFrameFilters(outputVariant).join(',') : 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080');
        const vf = [frameFilter, buildColorGradeFilter(opts.colorGrade), 'format=yuv420p'].filter(Boolean).join(',');
        await runCommand(ffmpeg, ['-y', '-loop', '1', '-i', shot.frameImagePath!, '-vf', vf,
          '-c:v', videoEncoder.encoder, '-preset', videoEncoder.preset, '-t', String(shot.durationSec), '-r', String(fps), clipPath]);
        clips.push(clipPath);
      }

      const video = buildTransitionVideoGraph(timeline, fps);
      const audio = buildTransitionAudioGraph(timeline, clips.length);
      const overlays: string[] = [];
      if (srtPath && fs.existsSync(srtPath)) overlays.push(`subtitles='${escapeFilterPath(srtPath)}':force_style='${subtitleStyle}'`);
      if (textCardsPath) overlays.push(`subtitles='${escapeFilterPath(textCardsPath)}'`);
      const graph = [video.filter, overlays.length ? `${video.outLabel}${overlays.join(',')}[vfinal]` : '', audio.filter]
        .filter(Boolean).join(';');
      const videoOut = overlays.length ? '[vfinal]' : video.outLabel;

      await runCommand(ffmpeg, [
        '-y',
        ...clips.flatMap(clip => ['-i', clip]),
        ...audioSegments.flatMap(segment => ['-i', segment]),
        '-filter_complex', graph,
        '-map', videoOut, '-map', audio.outLabel,
        '-c:v', videoEncoder.encoder, '-preset', videoEncoder.preset, '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-t', String(totalDuration), '-movflags', '+faststart',
        stagedMoviePath,
      ]);
    } else if (motion) {
      // Per-shot Ken Burns motion clips
      const videoClips: string[] = [];
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        const dur = shot.durationSec;
        const imgPath = shot.frameImagePath!;

        const shotClipPath = path.join(tempDir, `clip_${String(i).padStart(3, '0')}.mp4`);
        const kbFilter = buildKenBurnsFilter(shot.movement || 'static', dur, fps, outputVariant);
        const lutFilter = buildColorGradeFilter(opts.colorGrade);
        const vf = [kbFilter, lutFilter, 'format=yuv420p'].filter(Boolean).join(',');

        await runCommand(ffmpeg, [
          '-y',
          '-loop', '1',
          '-i', imgPath,
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
        '-preset', videoEncoder.preset === 'veryfast' ? 'fast' : videoEncoder.preset,
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
