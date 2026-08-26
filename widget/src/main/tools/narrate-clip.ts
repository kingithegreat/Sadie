/**
 * narrate-clip.ts — "narrate my clip": bring-your-own video narration from chat.
 *
 * Aden's redirect of the NBA voiceover pipeline (#236/#239): the pieces existed
 * as repo scripts and an n8n workflow, but he wants it INSIDE HomeBot. This
 * tool is the in-app rung:
 *
 *   video path → Gemini watches the footage and writes the script
 *              → HomeBot's own narration engine speaks it
 *              → ffmpeg muxes the narration onto the original clip
 *              → final MP4 lands next to the source video
 *
 * Reuse rules honoured here:
 *  - The Gemini key is read through apiKeyForProvider(settings,
 *    'google-ai-studio') — never a second key lookup; that duplication is how
 *    chat once showed Gemini configured while Ollama answered.
 *  - Narration goes through renderNarrationToFile, the same seam media_narrate
 *    uses, so engine preference/fallback stays in one place.
 *  - ffmpeg resolution goes through findFfmpeg like media_render.
 *
 * Boundaries: the input clip must be inside the user's home directory, and the
 * output is always written next to the input, so nothing can land outside it.
 * Without a Gemini key the tool fails closed with setup guidance instead of
 * guessing.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import type { ToolDefinition, ToolHandler, ToolResult } from './types';
import { resolveWithinHome } from '../utils/path-guard';

const ANALYZE_TIMEOUT_MS = 300_000;
const MUX_TIMEOUT_MS = 120_000;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);

// ---- pure helpers (exported for tests) ----

/** argv tail for scripts/analyze_clip.py: <video> -o <out> */
export function buildAnalyzerArgs(videoPath: string, outPath: string): string[] {
  return [videoPath, '-o', outPath];
}

/** Parse the analyzer's JSON output file into the fields this tool needs. */
export function parseAnalyzerOutput(filePath: string): { durationSec?: number; script: string } {
  const raw = fs.readFileSync(filePath, 'utf8');
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('the analyzer did not return readable JSON');
  }
  const script = typeof data?.script === 'string' ? data.script.trim() : '';
  if (!script) throw new Error('Gemini watched the clip but wrote no script');
  const durationSec = typeof data.duration_sec === 'number' ? data.duration_sec : undefined;
  return { durationSec, script };
}

/**
 * ffmpeg argv: copy the original video stream verbatim, encode only the new
 * narration to AAC, take audio solely from input 1, end with the shorter
 * stream. Mirrors scripts/mux_media.py exactly.
 */
export function buildMuxArgs(video: string, audio: string, out: string): string[] {
  return [
    '-y',
    '-i', video,
    '-i', audio,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-shortest',
    out,
  ];
}

/**
 * Locate scripts/analyze_clip.py. In dev, app.getAppPath() is widget/, so the
 * repo root is one level up. A packaged install does not ship the scripts
 * folder, and callers must say so rather than pretend.
 */
export function resolveAnalyzerScript(): string | null {
  const candidates = [
    path.join(app.getAppPath(), '..', 'scripts', 'analyze_clip.py'),
    path.join(process.cwd(), '..', 'scripts', 'analyze_clip.py'),
    path.join(process.cwd(), 'scripts', 'analyze_clip.py'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function spawnHelper(cmd: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        if (error && (error as any).killed) {
          reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`));
          return;
        }
        // Non-zero exit resolves so callers can render the stderr tail; only
        // spawn-level failures (binary missing) reject.
        if (error && (error as any).code === undefined) {
          reject(error);
          return;
        }
        resolve({ code: typeof (error as any)?.code === 'number' ? (error as any).code : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      }
    );
  });
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- tool surface ----

export const narrateClipDef: ToolDefinition = {
  name: 'media_narrate_clip',
  description:
    'Narrate an existing video clip: Gemini watches YOUR clip and writes a high-energy script timed to ' +
    "the action, HomeBot's narration engine records it, and the result is muxed back over the original " +
    'footage as a finished MP4 next to the source. Needs the Google AI Studio key in Settings → API Keys. ' +
    'The clip must be a .mp4/.mov/.webm inside your user folder.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      videoPath: {
        type: 'string',
        description: 'Full path to the video clip to narrate (.mp4, .mov or .webm)',
      },
      voice: { type: 'string', description: 'Optional voice name; defaults to the saved narration preference' },
      engine: {
        type: 'string',
        enum: ['edge', 'kokoro'],
        description: "Narration engine; defaults to the saved narrationEngine preference ('kokoro' falls back to 'edge' when it cannot run)",
      },
    },
    required: ['videoPath'],
  },
};

export const narrateClipHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    // Shared home-boundary guard (#230) — one implementation for every tool.
    const boundary = resolveWithinHome(String(args.videoPath || ''));
    if ('error' in boundary || !fs.existsSync(boundary.resolved)) {
      return {
        success: false,
        error:
          'That video path does not work — it must be an existing file inside your user folder ' +
          '(for example C:\\Users\\you\\Videos\\clip.mp4).',
      };
    }
    const videoPath = boundary.resolved;
    if (!VIDEO_EXTENSIONS.has(path.extname(videoPath).toLowerCase())) {
      return { success: false, error: 'Only .mp4, .mov and .webm clips can be narrated.' };
    }

    const { getSettings } = await import('../config-manager');
    const { apiKeyForProvider } = await import('../../shared/cloud-llm');
    const geminiKey = apiKeyForProvider(getSettings() as any, 'google-ai-studio');
    if (!geminiKey) {
      return {
        success: false,
        error:
          'No Google AI Studio key yet — add it in Settings → Advanced → API Keys (free tier works), then ask again.',
      };
    }

    const analyzerScript = resolveAnalyzerScript();
    if (!analyzerScript) {
      return { success: false, error: 'scripts/analyze_clip.py was not found next to the app — it ships with the repository, not the installer.' };
    }

    // 1. Gemini watches the clip and writes the script.
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const analysisOut = path.join(os.tmpdir(), `homebot-narrate-${Date.now()}.json`);
    let analyze: { code: number; stdout: string; stderr: string };
    try {
      analyze = await spawnHelper(
        python,
        buildAnalyzerArgs(analyzerScript, analysisOut),
        ANALYZE_TIMEOUT_MS,
        { GEMINI_API_KEY: geminiKey },
      );
    } catch (e) {
      return { success: false, error: `Could not start the clip analyzer (${errText(e)}). Is Python installed?` };
    }
    if (analyze.code !== 0 || !fs.existsSync(analysisOut)) {
      const tail = analyze.stderr.trim().split('\n').slice(-4).join(' | ');
      return {
        success: false,
        error: `Clip analysis failed${tail ? `: ${tail}` : ' with no details'}. Check the Google AI Studio key and your connection.`,
      };
    }

    let parsed: { durationSec?: number; script: string };
    try {
      parsed = parseAnalyzerOutput(analysisOut);
    } catch (e) {
      return { success: false, error: errText(e) };
    } finally {
      try { fs.unlinkSync(analysisOut); } catch { /* temp file, best effort */ }
    }

    // 2. HomeBot's own engine records the narration — same seam as media_narrate,
    //    so engine preference and Kokoro→Edge fallback stay defined in one place.
    const { renderNarrationToFile } = await import('./voice');
    const stem = path.basename(videoPath, path.extname(videoPath));
    const outDir = path.dirname(videoPath);
    const stamp = Date.now();
    const audioPath = path.join(outDir, `${stem}-narration-${stamp}.mp3`);
    const audio = await renderNarrationToFile(parsed.script, audioPath, {
      voice: args.voice ? String(args.voice) : undefined,
      engine: args.engine === 'kokoro' || args.engine === 'edge' ? args.engine : undefined,
    });

    // 3. Mux onto the original footage — video stream copied, never re-encoded.
    const { findFfmpeg, FFMPEG_MISSING_MESSAGE } = await import('../media-render');
    const { findManagedFfmpeg } = await import('../ffmpeg-setup');
    const ffmpeg = await findFfmpeg(findManagedFfmpeg());
    if (!ffmpeg) return { success: false, error: FFMPEG_MISSING_MESSAGE };

    const finalPath = path.join(outDir, `${stem}-narrated-${stamp}.mp4`);
    const mux = await spawnHelper(ffmpeg, buildMuxArgs(videoPath, audio.path, finalPath), MUX_TIMEOUT_MS);
    if (mux.code !== 0 || !fs.existsSync(finalPath)) {
      const tail = mux.stderr.trim().split('\n').slice(-4).join(' | ');
      try { fs.unlinkSync(audio.path); } catch { /* keep the narration at least */ }
      return { success: false, error: `Muxing failed${tail ? `: ${tail}` : ''} — the narration audio was kept at ${audio.path}.` };
    }
    try { fs.unlinkSync(audio.path); } catch { /* already gone */ }

    const sizeMb = (fs.statSync(finalPath).size / 1e6).toFixed(1);
    return {
      success: true,
      result: [
        `Narrated "${stem}" — finished video: ${finalPath} (${sizeMb} MB).`,
        parsed.durationSec ? `Clip length: ~${Math.round(parsed.durationSec)}s.` : '',
        `Script opening: "${parsed.script.slice(0, 140)}${parsed.script.length > 140 ? '…' : ''}"`,
        'Say "show my narrated videos" or open the folder above to watch it.',
      ].filter(Boolean).join(' '),
    };
  } catch (e: any) {
    return { success: false, error: `Could not narrate the clip: ${errText(e)}` };
  }
};

export const narrateClipToolDefs: ToolDefinition[] = [narrateClipDef];
export const narrateClipToolHandlers: Record<string, ToolHandler> = {
  media_narrate_clip: narrateClipHandler,
};
