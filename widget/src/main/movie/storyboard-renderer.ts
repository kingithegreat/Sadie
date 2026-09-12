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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findFfmpeg, escapeFilterPath } from '../media-render';
import { inspectRender, SILENCE_FLOOR_DB } from '../media-qa';
import { assembleShotsForScene, assembleStoryboardScenes, type AssembledShot } from './storyboard-assembly';

export interface StoryboardRenderOptions {
  projectId: string;
  sceneId?: string;
  motion?: boolean;
  burnSubtitles?: boolean;
  outputName?: string;
}

export interface StoryboardRenderResult {
  ok: boolean;
  moviePath?: string;
  durationSec?: number;
  totalShots?: number;
  error?: string;
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
export function buildSrtFromShots(shots: ShotManifest[]): string {
  let currentTime = 0;
  const blocks: string[] = [];

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const dur = shot.durationSec || 5;
    const startStr = formatSrtTimestamp(currentTime);
    const endStr = formatSrtTimestamp(currentTime + dur);
    const text = (shot.narration && shot.narration.trim()) ? shot.narration.trim() : shot.prompt;

    blocks.push(`${i + 1}\n${startStr} --> ${endStr}\n${text}\n`);
    currentTime += dur;
  }

  return blocks.join('\n');
}

/** Generates FFmpeg video filter for Ken Burns motion based on shot movement preset. */
export function buildKenBurnsFilter(movement: string, durationSec: number, fps = 30): string {
  const frames = Math.max(1, Math.round(durationSec * fps));
  const move = movement.toLowerCase().trim();

  if (move === 'slow push in') {
    // Zoom from 1.0 to 1.25 toward center
    return `zoompan=z='min(zoom+0.0015,1.25)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${fps}`;
  } else if (move === 'pan right') {
    // Constant 1.15 scale with horizontal rightward pan
    return `zoompan=z='1.15':x='if(lte(on,1),(iw-iw/zoom)/2,min(x+1.5,iw-iw/zoom))':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${fps}`;
  } else if (move === 'tilt up') {
    // Constant 1.15 scale with upward vertical tilt
    return `zoompan=z='1.15':x='iw/2-(iw/zoom/2)':y='if(lte(on,1),(ih-ih/zoom)/2,max(y-1.5,0))':d=${frames}:s=1920x1080:fps=${fps}`;
  } else if (move === 'tracking') {
    // Slight zoom with diagonal flow
    return `zoompan=z='min(zoom+0.001,1.18)':x='if(lte(on,1),(iw-iw/zoom)/2,min(x+1.2,iw-iw/zoom))':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${fps}`;
  } else {
    // Static locked shot: scale to fill 1920x1080 cleanly
    return `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080`;
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

/**
 * Compiles a storyboard project into a broadcast 1080p MP4 movie.
 */
export async function renderStoryboardMovie(
  opts: StoryboardRenderOptions
): Promise<StoryboardRenderResult> {
  const { findManagedFfmpeg } = await import('../ffmpeg-setup');
  const ffmpeg = await findFfmpeg(findManagedFfmpeg());
  if (!ffmpeg) {
    return {
      ok: false,
      error: 'FFmpeg was not found. Choose "Set it up for me" in Media Studio to install the video engine.',
    };
  }

  let projectDir: string;
  try {
    projectDir = getStoryboardProjectDir(opts.projectId);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (!fs.existsSync(projectDir)) {
    return { ok: false, error: `Storyboard project directory not found: ${projectDir}` };
  }

  const sceneId = opts.sceneId;
  if (sceneId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(sceneId)) {
    return { ok: false, error: 'Choose a valid storyboard scene before exporting.' };
  }
  let shots: ShotManifest[];
  try {
    shots = sceneId === undefined
      ? assembleStoryboardScenes(projectDir).flatMap(scene => scene.shots)
      : assembleShotsForScene(projectDir, sceneId);
  } catch (error) {
    return { ok: false, error: `Could not read the saved storyboard: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!Array.isArray(shots) || shots.length === 0) {
    return { ok: false, error: 'Storyboard scene contains no shots to render.' };
  }

  // A saved manifest is input, not proof that its shots can be exported.
  if (shots.some(s => !s || typeof s.durationSec !== 'number' || !Number.isFinite(s.durationSec) || s.durationSec <= 0)) {
    return { ok: false, error: 'Every shot needs a positive duration. Fix the shot timing and save the board before exporting.' };
  }
  if (shots.some(s => typeof s.prompt !== 'string' || (s.narration !== undefined && typeof s.narration !== 'string'))) {
    return { ok: false, error: 'A shot has invalid text. Open and save the storyboard before exporting.' };
  }
  const readableFile = (file: unknown): file is string => {
    if (typeof file !== 'string' || !file) return false;
    try { const stat = fs.statSync(file); return stat.isFile() && stat.size > 0; } catch { return false; }
  };
  const missingFrames = shots.filter(s => !readableFile(s.frameImagePath));
  if (missingFrames.length === shots.length) {
    return {
      ok: false,
      error: 'No rendered keyframes found for this storyboard. Please generate frames first before rendering.',
    };
  }
  if (missingFrames.length > 0) {
    return { ok: false, error: `${missingFrames.length} shot image(s) are missing or empty. Generate or replace those frames before exporting.` };
  }

  const rendersDir = path.join(projectDir, 'renders');
  const outputFilename = opts.outputName || `${opts.projectId}${sceneId ? `-${sceneId}` : ''}-1080p.mp4`;
  if (path.basename(outputFilename) !== outputFilename || /[<>:"|?*\\/\x00-\x1f]/.test(outputFilename) || !/\.mp4$/i.test(outputFilename)) {
    return { ok: false, error: 'The export needs an MP4 filename inside this project.' };
  }
  const finalMoviePath = path.join(rendersDir, outputFilename);
  let tempDir: string | undefined;

  try {
    fs.mkdirSync(rendersDir, { recursive: true });
    // Stage on the same filesystem. A failed replacement must retain the last good export.
    tempDir = fs.mkdtempSync(path.join(rendersDir, '.homebot-render-'));
    const stagedMoviePath = path.join(tempDir, 'movie.mp4');
    const totalDuration = shots.reduce((acc, s) => acc + s.durationSec, 0);
    const motion = opts.motion !== false;
    const burnSubtitles = opts.burnSubtitles !== false;
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
        const audio = await renderNarrationToFile(shot.narration.trim(), path.join(speechDir, 'audio.mp3'));
        if (!readableFile(audio.path)) throw new Error(`Narration for shot ${i + 1} produced no usable audio file.`);
        const facts = await inspectRender(ffmpeg, audio.path);
        if (!facts.hasAudio || !Number.isFinite(facts.durationSeconds) || !facts.durationSeconds ||
            facts.meanVolumeDb === null || !Number.isFinite(facts.meanVolumeDb) || facts.meanVolumeDb < SILENCE_FLOOR_DB) {
          throw new Error(`Narration for shot ${i + 1} could not be verified as audible speech. Check the selected voice and retry.`);
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

    // 2. Generate Subtitles file
    let srtPath: string | null = null;
    if (burnSubtitles) {
      srtPath = path.join(tempDir, 'subtitles.srt');
      const srtText = buildSrtFromShots(shots);
      fs.writeFileSync(srtPath, srtText, 'utf-8');
    }

    // 3. Render Video Track
    if (motion) {
      // Per-shot Ken Burns motion clips
      const videoClips: string[] = [];
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        const dur = shot.durationSec;
        const imgPath = shot.frameImagePath!;

        const shotClipPath = path.join(tempDir, `clip_${String(i).padStart(3, '0')}.mp4`);
        const kbFilter = buildKenBurnsFilter(shot.movement || 'static', dur, 30);

        await runCommand(ffmpeg, [
          '-y',
          '-loop', '1',
          '-i', imgPath,
          '-vf', `${kbFilter},format=yuv420p`,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-t', String(dur),
          '-r', '30',
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

      if (srtPath && fs.existsSync(srtPath)) {
        const escapedSrt = escapeFilterPath(srtPath);
        muxArgs.push(
          '-vf',
          `subtitles='${escapedSrt}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=35'`
        );
      }

      muxArgs.push(
        '-c:v', 'libx264',
        '-preset', 'fast',
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
        'fps=30',
        'scale=1920:1080:force_original_aspect_ratio=increase',
        'crop=1920:1080',
      ];
      if (srtPath && fs.existsSync(srtPath)) {
        const escapedSrt = escapeFilterPath(srtPath);
        filters.push(`subtitles='${escapedSrt}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=35'`);
      }
      filters.push('format=yuv420p');

      await runCommand(ffmpeg, [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-i', combinedAudioPath,
        '-vf', filters.join(','),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-t', String(totalDuration),
        '-movflags', '+faststart',
        stagedMoviePath,
      ]);
    }

    if (!readableFile(stagedMoviePath)) throw new Error('The video engine produced no usable movie file.');
    // Require a complete decode as well as metadata. An MP4 header or successful
    // encoder exit alone cannot establish that its video/audio packets are readable.
    await runCommand(ffmpeg, ['-v', 'error', '-xerror', '-i', stagedMoviePath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    const facts = await inspectRender(ffmpeg, stagedMoviePath);
    if (!facts.hasVideo || facts.width !== 1920 || facts.height !== 1080 || !facts.hasAudio ||
        !Number.isFinite(facts.durationSeconds) || facts.durationSeconds === null ||
        Math.abs(facts.durationSeconds - totalDuration) > 0.15) {
      throw new Error('The exported video did not match the storyboard duration, picture size or audio tracks. The previous export has been kept.');
    }
    if (hasNarration && (facts.meanVolumeDb === null || !Number.isFinite(facts.meanVolumeDb) || facts.meanVolumeDb < SILENCE_FLOOR_DB)) {
      throw new Error('The exported narration is missing or silent. Check the selected voice and retry.');
    }
    fs.renameSync(stagedMoviePath, finalMoviePath);
    return {
      ok: true,
      moviePath: finalMoviePath,
      durationSec: facts.durationSeconds,
      totalShots: shots.length,
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
