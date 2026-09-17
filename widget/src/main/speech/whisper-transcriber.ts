/**
 * Voice input: Whisper speech-to-text in the MAIN process.
 *
 * It used to run in the renderer, where the model download is a fetch to
 * huggingface.co — and the renderer's CSP is connect-src 'self', so every first
 * use failed with "Voice error: Failed to fetch" (measured in the built app).
 * Loosening the CSP would also have let the download ignore the Online choice.
 * Here, like Kokoro (tools/voice.ts), the model downloads only while Online is
 * on, once, into HomeBot's own data folder; afterwards voice works offline.
 * The renderer records and resamples; only the 16 kHz samples cross IPC.
 */

import { app } from 'electron';
import * as path from 'path';
import { getSettings } from '../config-manager';
import { resolveCloudLLM } from '../../shared/cloud-llm';

/** Whisper checkpoints Settings can pick (see renderer utils/speech.ts pickWhisperModelId). */
const MODEL_ID = /^Xenova\/whisper-(tiny|base|small)(\.en)?$/;
const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 120;

export interface WhisperProgress { status: 'downloading'; percent: number }

export interface WhisperTranscribeRequest {
  modelId: string;
  language?: string;
  /** Mono samples at 16 kHz, -1..1. */
  audio: Float32Array;
}

export function whisperCacheDir(): string {
  return path.join(app.getPath('userData'), 'models', 'transformers');
}

function onlineAllowed(): boolean {
  try { return resolveCloudLLM(getSettings()).intended; } catch { return false; }
}

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text?: string }>;
const loaded = new Map<string, Asr>();
const loading = new Map<string, Promise<Asr>>();

async function loadWhisper(modelId: string, allowDownloads: boolean, onProgress?: (p: WhisperProgress) => void): Promise<Asr> {
  const ready = loaded.get(modelId);
  if (ready) return ready;
  // A cache-only request must not join a load that is allowed to download.
  const key = `${modelId}|${allowDownloads}`;
  let pending = loading.get(key);
  if (!pending) {
    pending = (async () => {
      const { pipeline } = require('@huggingface/transformers') as typeof import('@huggingface/transformers');
      let last = -1;
      const asr = await pipeline('automatic-speech-recognition', modelId, {
        cache_dir: whisperCacheDir(),
        local_files_only: !allowDownloads,
        device: 'cpu',
        progress_callback: (p: any) => {
          if (p?.status === 'progress' && typeof p.progress === 'number') {
            const percent = Math.round(p.progress);
            if (percent !== last) { last = percent; onProgress?.({ status: 'downloading', percent }); }
          }
        },
      }) as unknown as Asr;
      loaded.set(modelId, asr);
      return asr;
    })().finally(() => loading.delete(key));
    loading.set(key, pending);
  }
  return pending;
}

/** Plain words for a failed model load. */
export function describeWhisperLoadError(err: unknown, allowDownloads: boolean, modelId: string): string {
  const msg = String((err as Error)?.message || err);
  if (!allowDownloads && /local_files_only|not found locally|allowRemoteModels/i.test(msg)) {
    return `The voice model (${modelId.replace('Xenova/', '')}) downloads once. Turn on Online in Settings and try again — after that, voice works offline.`;
  }
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(msg)) {
    return 'Could not download the voice model. Check your internet connection and try again.';
  }
  return `The voice model could not load: ${msg.slice(0, 200)}`;
}

export async function transcribeWithWhisper(
  req: WhisperTranscribeRequest,
  onProgress?: (p: WhisperProgress) => void,
): Promise<string> {
  if (typeof req?.modelId !== 'string' || !MODEL_ID.test(req.modelId)) throw new Error('Choose a supported voice model in Settings → Voice.');
  if (Object.prototype.toString.call(req?.audio) !== '[object Float32Array]' || req.audio.length === 0) throw new Error('No audio was recorded.');
  if (req.audio.length > SAMPLE_RATE * MAX_SECONDS) throw new Error(`Recordings are limited to ${MAX_SECONDS} seconds.`);

  const allowDownloads = onlineAllowed();
  let asr: Asr;
  try {
    asr = await loadWhisper(req.modelId, allowDownloads, onProgress);
  } catch (err) {
    throw new Error(describeWhisperLoadError(err, allowDownloads, req.modelId));
  }

  const language = (req.language || 'en').toLowerCase();
  const generate: Record<string, unknown> = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false };
  // English-only checkpoints reject a language option; multilingual ones need it.
  if (!req.modelId.endsWith('.en') && language !== 'en') {
    generate.language = language;
    generate.task = 'transcribe';
  }
  const output = await asr(req.audio, generate);
  return String(output?.text || '').trim();
}

/** Test seam: forget loaded models. */
export function __resetWhisperForTests(): void {
  loaded.clear();
  loading.clear();
}
