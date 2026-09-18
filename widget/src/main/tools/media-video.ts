import { buildTimelineFinishGraph, finishChangesAnything, type TimelineFinish } from '../movie/timeline-finish';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ToolDefinition, ToolHandler, ToolResult } from './types';
import { resolveWithinHome } from '../utils/path-guard';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv', '.wmv']);
const TRIM_TIMEOUT_MS = 120000;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Verify a produced video file is actually a usable video, not merely present.
 * The trim/splice tools used to trust the file existing on disk; an empty,
 * corrupt or headerless output read as a successful trim. Same probe the media
 * QA gate uses (ffmpeg, never ffprobe), so a file ffmpeg cannot read fails here
 * rather than shipping as a "trimmed" clip.
 */
async function verifyVideoFile(ffmpeg: string, filePath: string): Promise<void> {
  const { inspectRender } = await import('../media-qa');
  const facts = await inspectRender(ffmpeg, filePath);
  if (!facts.hasVideo) throw new Error('the output is not a video');
  if (facts.durationSeconds === null || facts.durationSeconds <= 0) {
    throw new Error('the output has no measurable duration');
  }
}

function spawnFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // The binary the handler resolved, not the bare name: HomeBot's managed
    // FFmpeg is not on PATH, so 'ffmpeg' fails with ENOENT on a machine that
    // never installed it globally. Trim and splice were both dead there.
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          if ((error as any).killed) {
            reject(new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
            return;
          }
          if ((error as any).code !== undefined) {
            resolve({ code: (error as any).code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
            return;
          }
          reject(error);
          return;
        }
        resolve({ code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      });
  });
}

export const trimVideoDef: ToolDefinition = {
  name: 'media_trim_clip',
  description:
    'Trim a video clip to extract only a specific time range. The original file is not modified; the trimmed result is written next to the source with "-trimmed" appended to the filename. The clip must be inside your user folder.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      videoPath: {
        type: 'string',
        description: 'Full path to the video clip to trim',
      },
      startSec: {
        type: 'number',
        description: 'Start time in seconds',
      },
      durationSec: {
        type: 'number',
        description: 'Duration of the trimmed clip in seconds',
      },
    },
    required: ['videoPath', 'startSec', 'durationSec'],
  },
};

const trimVideoHandler: ToolHandler = async (callArgs: Record<string, any>): Promise<ToolResult> => {
  try {
    const videoPath = resolveWithinHome(String(callArgs?.videoPath || ''));
    if ('error' in videoPath || !fs.existsSync(videoPath.resolved)) {
      return {
        success: false,
        error: 'That video path does not work — it must be an existing file inside your user folder.',
      };
    }

    const resolvedPath = videoPath.resolved;
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) {
      return { success: false, error: 'Unsupported video format. Only .mp4, .mov, .webm, .avi, .mkv, .wmv are supported.' };
    }

    const startSec = Number(callArgs?.startSec);
    const durationSec = Number(callArgs?.durationSec);
    if (isNaN(startSec) || startSec < 0) {
      return { success: false, error: 'startSec must be a non-negative number.' };
    }
    if (isNaN(durationSec) || durationSec <= 0) {
      return { success: false, error: 'durationSec must be a positive number.' };
    }

    const { findFfmpeg } = await import('../media-render');
    const { findManagedFfmpeg } = await import('../ffmpeg-setup');
    const ffmpeg = await findFfmpeg(findManagedFfmpeg());
    if (!ffmpeg) {
      return { success: false, error: 'FFmpeg is not available. Set it up in Media Studio settings.' };
    }

    const dir = path.dirname(resolvedPath);
    const baseName = path.basename(resolvedPath, ext);
    const outPath = path.join(dir, `${baseName}-trimmed${ext}`);

    const args = [
      '-y',
      '-ss', String(startSec),
      '-i', resolvedPath,
      '-t', String(durationSec),
      '-c', 'copy',
      outPath,
    ];

    try {
      await spawnFfmpeg(ffmpeg, args, TRIM_TIMEOUT_MS);
    } catch (e: any) {
      if (e.message?.includes('timed out')) {
        return { success: false, error: `ffmpeg timed out — try a shorter clip or check if the file is playing correctly. Error: ${e.message}` };
      }
      return { success: false, error: `ffmpeg error: ${e.message}` };
    }

    if (!fs.existsSync(outPath)) {
      return { success: false, error: 'The trimmed file was not created. The video may be corrupted or unsupported.' };
    }

    try {
      await verifyVideoFile(ffmpeg, outPath);
    } catch (e: any) {
      return { success: false, error: `The trimmed file is not a usable video: ${errText(e)}` };
    }

    const originalSize = fs.statSync(resolvedPath).size;
    const trimmedSize = fs.statSync(outPath).size;

    return {
      success: true,
      result: {
        path: outPath,
        originalPath: resolvedPath,
        originalSize,
        trimmedSize,
      },
    };
  } catch (e: any) {
    return { success: false, error: errText(e) };
  }
};

export const spliceVideoDef: ToolDefinition = {
  name: 'media_splice_video',
  description:
    'Splice (concatenate) multiple video clips together in sequence. The input files must be in your user folder. The resulting video is written to the output path, which should also be in your user folder. This uses stream copy (no re-encoding), so all clips must have compatible codecs and pixel formats.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      clips: {
        type: 'array',
        description: 'List of video file paths in the order they should be spliced',
        items: { type: 'string' },
      },
      outputPath: {
        type: 'string',
        description: 'Full path for the output spliced video',
      },
      finish: {
        type: 'object',
        description:
          'Optional finishing pass applied to the joined video (MS-6), which re-encodes: '
          + 'colorGrade (warm_nile, teal_orange, nocturne), volume (multiplier), mute, '
          + 'speed (0.25-4), transition (cut, crossfade, fade_black) with transitionSec and '
          + 'clipDurations in seconds. Omit it to stream-copy, which is faster and lossless.',
      },
    },
    required: ['clips', 'outputPath'],
  },
};

const spliceVideoHandler: ToolHandler = async (callArgs: Record<string, any>): Promise<ToolResult> => {
  try {
    const clipsArg = callArgs?.clips;
    if (!Array.isArray(clipsArg) || clipsArg.length < 2) {
      return { success: false, error: 'At least 2 clips are required for splicing.' };
    }

    const outputPathArg = String(callArgs?.outputPath || '');
    const outputBoundary = resolveWithinHome(outputPathArg);
    if ('error' in outputBoundary) {
      return { success: false, error: outputBoundary.error };
    }

    const resolvedClips: string[] = [];
    for (const clip of clipsArg) {
      const boundary = resolveWithinHome(String(clip || ''));
      if ('error' in boundary || !fs.existsSync(boundary.resolved)) {
        return { success: false, error: `Clip not found or outside user folder: ${clip}` };
      }
      resolvedClips.push(boundary.resolved);
    }

    const outputPath = outputBoundary.resolved;
    const outDir = path.dirname(outputPath);

    if (!fs.existsSync(outDir)) {
      try { fs.mkdirSync(outDir, { recursive: true }); } catch (e: any) {
        return { success: false, error: `Could not create output directory: ${errText(e)}` };
      }
    }

    const { findFfmpeg } = await import('../media-render');
    const { findManagedFfmpeg } = await import('../ffmpeg-setup');
    const ffmpeg = await findFfmpeg(findManagedFfmpeg());
    if (!ffmpeg) {
      return { success: false, error: 'FFmpeg is not available. Set it up in Media Studio settings.' };
    }

    // MS-6: a finishing pass turns the Timeline inspector into real output.
    // Without one the stream copy below is kept: faster, and lossless.
    const finish = (callArgs?.finish ?? null) as TimelineFinish | null;
    if (finishChangesAnything(finish)) {
      let graph;
      try {
        graph = buildTimelineFinishGraph(resolvedClips.length, finish!);
      } catch (e: any) {
        return { success: false, error: errText(e) };
      }
      const args = ['-y', ...resolvedClips.flatMap(clip => ['-i', clip]), '-filter_complex', graph.filter,
        '-map', graph.videoLabel];
      if (graph.audioLabel) args.push('-map', graph.audioLabel, '-c:a', 'aac', '-b:a', '192k');
      else args.push('-an');
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
      if (graph.durationSec) args.push('-t', String(graph.durationSec));
      args.push('-movflags', '+faststart', outputPath);
      try {
        await spawnFfmpeg(ffmpeg, args, 600000);
      } catch (e: any) {
        return { success: false, error: `ffmpeg error while applying the timeline settings: ${errText(e)}` };
      }
      if (!fs.existsSync(outputPath)) {
        return { success: false, error: 'The finished file was not created.' };
      }
      try {
        await verifyVideoFile(ffmpeg, outputPath);
      } catch (e: any) {
        return { success: false, error: `The finished file is not a usable video: ${errText(e)}` };
      }
      return {
        success: true,
        result: {
          path: outputPath, clipCount: resolvedClips.length, finished: true,
          outputSize: fs.statSync(outputPath).size,
          originalTotalSize: resolvedClips.reduce((sum, clip) => sum + (fs.statSync(clip).size || 0), 0),
        },
      };
    }

    const concatListPath = path.join(os.tmpdir(), `homebot-concat-${Date.now()}.txt`);
    try {
      let concatContent = '';
      for (const clip of resolvedClips) {
        concatContent += `file '${clip.replace(/'/g, "'\\''")}'\n`;
      }
      fs.writeFileSync(concatListPath, concatContent, 'utf8');
    } catch (e: any) {
      return { success: false, error: `Could not create concat list: ${errText(e)}` };
    }

    try {
      await spawnFfmpeg(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', outputPath], 300000);
    } catch (e: any) {
      try { fs.unlinkSync(concatListPath); } catch { /* cleanup */ }
      if (e.message?.includes('timed out')) {
        return { success: false, error: `Splicing timed out. Try shorter clips or check if they have compatible codecs.` };
      }
      if (e.message?.includes('Invalid data found')) {
        return { success: false, error: `Codec mismatch between clips. All clips must have the same codec and pixel format. Try re-encoding them first, or use separate outputs.` };
      }
      return { success: false, error: `ffmpeg error: ${e.message}` };
    } finally {
      try { fs.unlinkSync(concatListPath); } catch { /* best effort */ }
    }

    if (!fs.existsSync(outputPath)) {
      return { success: false, error: 'The spliced file was not created. Check that all clips have compatible formats.' };
    }

    try {
      await verifyVideoFile(ffmpeg, outputPath);
    } catch (e: any) {
      return { success: false, error: `The spliced file is not a usable video: ${errText(e)}` };
    }

    const totalSize = resolvedClips.reduce((sum, p) => sum + (fs.statSync(p).size || 0), 0);
    const outputFileStat = fs.statSync(outputPath);

    return {
      success: true,
      result: {
        path: outputPath,
        clipCount: resolvedClips.length,
        originalTotalSize: totalSize,
        outputSize: outputFileStat.size,
      },
    };
  } catch (e: any) {
    return { success: false, error: errText(e) };
  }
};

export const videoToolDefs: ToolDefinition[] = [trimVideoDef, spliceVideoDef];
export const videoToolHandlers: Record<string, ToolHandler> = {
  media_trim_clip: trimVideoHandler,
  media_splice_video: spliceVideoHandler,
};