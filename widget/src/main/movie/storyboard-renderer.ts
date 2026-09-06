/**
 * storyboard-renderer.ts — One-Click 1080p Movie Renderer
 *
 * Compiles a Visual Storyboard project into a finished 1080p MP4 movie using local FFmpeg
 * and HomeBot's local speech synthesis engine ($0.00 spend invariant).
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
import { renderNarrationToFile } from '../tools/voice';

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

export interface ShotManifest {
  shotId: string;
  order: number;
  prompt: string;
  framing: string;
  lens: string;
  movement: string;
  durationSec: number;
  narration?: string;
  status: string;
  frameImagePath: string | null;
}

/** Resolves the project directory inside the movie projects folder. */
export function getStoryboardProjectDir(projectId: string): string {
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
    execFile(bin, args, { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
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
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) {
    return {
      ok: false,
      error: 'FFmpeg was not found. Please install FFmpeg or set HOMEBOT_FFMPEG to render videos.',
    };
  }

  const projectDir = getStoryboardProjectDir(opts.projectId);
  if (!fs.existsSync(projectDir)) {
    return { ok: false, error: `Storyboard project directory not found: ${projectDir}` };
  }

  const sceneId = opts.sceneId || 'scene_01';
  const manifestPath = path.join(projectDir, 'scenes', sceneId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, error: `Scene manifest not found: ${manifestPath}` };
  }

  let shots: ShotManifest[] = [];
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    shots = JSON.parse(raw);
  } catch (e: any) {
    return { ok: false, error: `Could not parse scene manifest: ${e.message}` };
  }

  if (!Array.isArray(shots) || shots.length === 0) {
    return { ok: false, error: 'Storyboard scene contains no shots to render.' };
  }

  // Check frames
  const missingFrames = shots.filter(s => !s.frameImagePath || !fs.existsSync(s.frameImagePath));
  if (missingFrames.length === shots.length) {
    return {
      ok: false,
      error: 'No rendered keyframes found for this storyboard. Please generate frames first before rendering.',
    };
  }

  // Create temporary directory for render artifacts
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `homebot-render-${opts.projectId}-`));
  const rendersDir = path.join(projectDir, 'renders');
  if (!fs.existsSync(rendersDir)) {
    fs.mkdirSync(rendersDir, { recursive: true });
  }

  const outputFilename = opts.outputName || `${opts.projectId}-1080p.mp4`;
  const finalMoviePath = path.join(rendersDir, outputFilename);

  try {
    const totalDuration = shots.reduce((acc, s) => acc + (s.durationSec || 5), 0);
    const motion = opts.motion !== false;
    const burnSubtitles = opts.burnSubtitles !== false;

    // 1. Render Audio Track (Voiceover per shot or silent bed)
    const audioSegments: string[] = [];
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const dur = shot.durationSec || 5;
      const shotAudioPath = path.join(tempDir, `shot_${String(i).padStart(3, '0')}.mp3`);

      if (shot.narration && shot.narration.trim()) {
        try {
          await renderNarrationToFile(shot.narration.trim(), shotAudioPath);
          audioSegments.push(shotAudioPath);
        } catch {
          // Fallback to silent segment if TTS failed
          await runCommand(ffmpeg, [
            '-y',
            '-f', 'lavfi',
            '-i', 'anullsrc=r=44100:cl=stereo',
            '-t', String(dur),
            '-q:a', '9',
            shotAudioPath,
          ]);
          audioSegments.push(shotAudioPath);
        }
      } else {
        // Generate silent segment matching shot duration
        await runCommand(ffmpeg, [
          '-y',
          '-f', 'lavfi',
          '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', String(dur),
          '-q:a', '9',
          shotAudioPath,
        ]);
        audioSegments.push(shotAudioPath);
      }
    }

    // Concatenate all audio segments
    const audioConcatList = path.join(tempDir, 'audio_concat.txt');
    const audioConcatContent = audioSegments
      .map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(audioConcatList, audioConcatContent, 'utf-8');

    const combinedAudioPath = path.join(tempDir, 'combined_audio.mp3');
    await runCommand(ffmpeg, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', audioConcatList,
      '-c:a', 'libmp3lame',
      '-q:a', '2',
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
        const dur = shot.durationSec || 5;
        const imgPath = (shot.frameImagePath && fs.existsSync(shot.frameImagePath))
          ? shot.frameImagePath
          : (shots.find(s => s.frameImagePath && fs.existsSync(s.frameImagePath))?.frameImagePath || '');

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
        '-shortest',
        '-movflags', '+faststart',
        finalMoviePath
      );

      await runCommand(ffmpeg, muxArgs);
    } else {
      // Fast Timeline Render without Ken Burns
      const concatListPath = path.join(tempDir, 'timeline_concat.txt');
      const usableShots = shots.filter(s => s.frameImagePath && fs.existsSync(s.frameImagePath));
      const line = (p: string) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
      const rows: string[] = ['ffconcat version 1.0'];
      for (const s of usableShots) {
        rows.push(line(s.frameImagePath!));
        rows.push(`duration ${Number(s.durationSec || 5).toFixed(3)}`);
      }
      rows.push(line(usableShots[usableShots.length - 1].frameImagePath!));
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
        '-shortest',
        '-movflags', '+faststart',
        finalMoviePath,
      ]);
    }

    return {
      ok: true,
      moviePath: finalMoviePath,
      durationSec: totalDuration,
      totalShots: shots.length,
    };
  } finally {
    // Cleanup temporary files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error */
    }
  }
}
