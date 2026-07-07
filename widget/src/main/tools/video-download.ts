/**
 * HomeBot Video Download Tool
 *
 * Fetches metadata for and downloads videos from YouTube and other
 * yt-dlp-supported sites. Shells out to the `yt-dlp` binary (must be
 * installed separately and reachable on PATH — HomeBot does not bundle it).
 *
 * Safety:
 * - Arguments are always passed as an argv array via execFile (no shell),
 *   so a malicious/odd URL can't break out into shell injection.
 * - download_video requires user confirmation (writes a file to disk).
 * - Output path is resolved through filesystem.ts's resolveUserPath, so
 *   downloads are confined to the user's home directory by default
 *   (defaults to the Downloads folder).
 * - Playlists are refused by default (--no-playlist) unless allow_playlist
 *   is explicitly set, to avoid an accidental mass-download.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';
import { resolveUserPath } from './filesystem';

const execFileAsync = promisify(execFile);

const INFO_TIMEOUT_MS = 20_000;      // metadata lookups should be fast
const DOWNLOAD_TIMEOUT_MS = 600_000; // 10 min ceiling for a single download

type Quality = 'best' | '1080p' | '720p' | '480p' | 'audio_only';

// ---- yt-dlp availability check (cached for the process lifetime) ----
let ytDlpAvailable: boolean | null = null;

async function isYtDlpAvailable(): Promise<boolean> {
  if (ytDlpAvailable !== null) return ytDlpAvailable;
  try {
    await execFileAsync('yt-dlp', ['--version'], { timeout: 5000, windowsHide: true });
    ytDlpAvailable = true;
  } catch {
    ytDlpAvailable = false;
  }
  return ytDlpAvailable;
}

const YT_DLP_MISSING_ERROR =
  'yt-dlp is not installed or not on PATH. Install it with "winget install yt-dlp.yt-dlp" ' +
  '(or "pip install yt-dlp"), restart HomeBot, and try again.';

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatSelectorFor(quality: Quality): string[] {
  switch (quality) {
    case '1080p':
      return ['-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]'];
    case '720p':
      return ['-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]'];
    case '480p':
      return ['-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]'];
    case 'audio_only':
      return ['-x', '--audio-format', 'mp3'];
    case 'best':
    default:
      return ['-f', 'bestvideo+bestaudio/best'];
  }
}

// ============= TOOL DEFINITIONS =============

export const getVideoInfoDef: ToolDefinition = {
  name: 'get_video_info',
  description:
    'Look up metadata for a video URL (YouTube and hundreds of other sites via yt-dlp) ' +
    'without downloading it. Returns title, uploader, duration, view count, thumbnail, ' +
    'and the available video qualities. For playlist URLs, only the first video is inspected.',
  category: 'web',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The video URL to look up (e.g. a YouTube link).'
      }
    },
    required: ['url']
  }
};

export const downloadVideoDef: ToolDefinition = {
  name: 'download_video',
  description:
    'Download a video from a URL (YouTube and hundreds of other sites via yt-dlp) to disk. ' +
    'Saves into the Downloads folder by default. Requires user confirmation. ' +
    'Refuses playlist URLs unless allow_playlist is set, to avoid downloading an entire playlist by accident.',
  category: 'filesystem',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The video URL to download.'
      },
      quality: {
        type: 'string',
        description: 'Desired quality/format. Defaults to "best".',
        enum: ['best', '1080p', '720p', '480p', 'audio_only'],
        default: 'best'
      },
      output_dir: {
        type: 'string',
        description: 'Folder to save into (e.g. "Downloads", "Desktop/clips"). Defaults to Downloads.',
        default: 'Downloads'
      },
      allow_playlist: {
        type: 'boolean',
        description: 'If true and the URL is a playlist, download every video in it. Default false (single video only).',
        default: false
      }
    },
    required: ['url']
  }
};

// ============= TOOL HANDLERS =============

export const getVideoInfoHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const url = String(args.url || '').trim();
    if (!url) return { success: false, error: 'url is required' };
    if (!isValidHttpUrl(url)) return { success: false, error: 'url must be a valid http(s) URL' };

    if (!(await isYtDlpAvailable())) {
      return { success: false, error: YT_DLP_MISSING_ERROR };
    }

    const { stdout } = await execFileAsync(
      'yt-dlp',
      ['--dump-json', '--no-warnings', '--no-playlist', url],
      { timeout: INFO_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 * 20 }
    );

    const info = JSON.parse(stdout.trim().split('\n')[0]);

    const heights = new Set<number>();
    let hasAudioOnly = false;
    for (const f of info.formats || []) {
      if (f.vcodec && f.vcodec !== 'none' && f.height) heights.add(f.height);
      if ((!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none') hasAudioOnly = true;
    }
    const availableQualities = Array.from(heights).sort((a, b) => b - a).map((h) => `${h}p`);
    if (hasAudioOnly) availableQualities.push('audio_only');

    return {
      success: true,
      result: {
        title: info.title,
        uploader: info.uploader || info.channel || null,
        duration_seconds: info.duration ?? null,
        view_count: info.view_count ?? null,
        thumbnail: info.thumbnail || null,
        site: info.extractor_key || info.extractor || null,
        webpage_url: info.webpage_url || url,
        available_qualities: availableQualities
      }
    };
  } catch (err: any) {
    return { success: false, error: `get_video_info failed: ${err.message}` };
  }
};

export const downloadVideoHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  try {
    const url = String(args.url || '').trim();
    if (!url) return { success: false, error: 'url is required' };
    if (!isValidHttpUrl(url)) return { success: false, error: 'url must be a valid http(s) URL' };

    const quality = (args.quality as Quality) || 'best';
    const allowPlaylist = args.allow_playlist === true;
    const outputDirArg = args.output_dir ? String(args.output_dir) : 'Downloads';

    if (!(await isYtDlpAvailable())) {
      return { success: false, error: YT_DLP_MISSING_ERROR };
    }

    const resolvedDir = resolveUserPath(outputDirArg);
    if (!resolvedDir) {
      return { success: false, error: `output_dir is not allowed: ${outputDirArg}` };
    }
    fs.mkdirSync(resolvedDir, { recursive: true });

    const outputTemplate = path.join(resolvedDir, '%(title)s.%(ext)s');

    const cliArgs = [
      '--no-warnings',
      '--windows-filenames',
      '-o', outputTemplate,
      '--print', 'after_move:filepath',
      ...formatSelectorFor(quality),
      ...(allowPlaylist ? [] : ['--no-playlist']),
      url
    ];

    context?.onProgress?.(`Downloading (${quality}) with yt-dlp...`);

    const { stdout } = await execFileAsync('yt-dlp', cliArgs, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 20
    });

    const printedPaths = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && fs.existsSync(l));

    return {
      success: true,
      result: {
        quality,
        output_dir: resolvedDir,
        files: printedPaths,
        file_path: printedPaths[0] || null
      }
    };
  } catch (err: any) {
    if (err.killed || /timed? out/i.test(err.message || '')) {
      return {
        success: false,
        error: 'download_video timed out (10 min limit). Try a lower quality or a shorter video.'
      };
    }
    return { success: false, error: `download_video failed: ${err.message}` };
  }
};

// ============= EXPORTS =============

export const videoDownloadToolDefs: ToolDefinition[] = [getVideoInfoDef, downloadVideoDef];

export const videoDownloadToolHandlers: Record<string, ToolHandler> = {
  get_video_info: getVideoInfoHandler,
  download_video: downloadVideoHandler
};
