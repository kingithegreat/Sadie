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

function spawnFfmpeg(args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 50 * 1024 * 1024 },
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
      await spawnFfmpeg(args, TRIM_TIMEOUT_MS);
    } catch (e: any) {
      if (e.message?.includes('timed out')) {
        return { success: false, error: `ffmpeg timed out — try a shorter clip or check if the file is playing correctly. Error: ${e.message}` };
      }
      return { success: false, error: `ffmpeg error: ${e.message}` };
    }

    if (!fs.existsSync(outPath)) {
      return { success: false, error: 'The trimmed file was not created. The video may be corrupted or unsupported.' };
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
      await spawnFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', outputPath], 300000);
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