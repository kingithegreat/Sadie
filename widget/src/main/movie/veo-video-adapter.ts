/**
 * VeoVideoAdapter — Google's current Veo 3.1 video model, paid per second.
 *
 * Model id verified against Google's deprecations page on 2026-09-22:
 * `veo-3.1-generate-preview` has "No shutdown date announced", while Veo 2.0
 * and 3.0 shut down 2026-06-30 with this id named as the replacement
 * (https://ai.google.dev/gemini-api/docs/deprecations#veo-models). The live
 * model list recorded from the owner's connected key also lists it
 * (`google-models-list.recording.json`), which is the entitlement signal the
 * registry (PROV-1) already keys on.
 *
 * Pricing verified against Google's Gemini API pricing page on 2026-09-22
 * (https://ai.google.dev/gemini-api/docs/pricing#veo-3.1), paid tier per
 * second of video with audio, no free tier: Veo 3.1 US$0.40/s at 720p/1080p,
 * Veo 3.1 Fast US$0.10/s at 720p, Veo 3.1 Lite US$0.05/s at 720p.
 *
 * Request shape follows the Veo REST example in Google's video docs (checked
 * 2026-09-22, https://ai.google.dev/gemini-api/docs/veo): POST
 * `{BASE_URL}/models/{model}:predictLongRunning` (BASE_URL v1beta), poll
 * `GET {BASE_URL}/{operation.name}` until `done`, then download
 * `.response.generateVideoResponse.generatedSamples[0].video.uri` — every call
 * authenticated with the key in the `x-goog-api-key` header.
 *
 * Uses the owner's Gemini API key from Settings (the same key cloud chat uses),
 * sent in a header, only while Online is on. It is only ever reached as an
 * explicit, confirmed choice — never as a fallback.
 */

import * as fs from 'fs';
import type { GenerationCapability, GenerationProvider, GenerationRequest, GenerationResult } from './types';
import { getSettings } from '../config-manager';
import { apiKeyForProvider } from '../../shared/cloud-llm';
import { assertProviderOnlineAccess } from '../utils/provider-network-policy';
import { saveMovieShotVideo } from './image-output';

export const VEO_VIDEO_MODEL = 'veo-3.1-generate-preview';
// Veo durations Google accepts (checked 2026-09-22): 4, 6 or 8 seconds at 720p.
export const VEO_DURATIONS_SEC = [4, 6, 8] as const;
export const VEO_MAX_DURATION_SEC = 8;
export const VEO_VIDEO_NO_KEY_REASON = 'No Gemini API key is saved in Settings.';

/** Veo 3.1 paid-tier price per second of video, in integer micro-dollars (720p). */
export const VEO_PER_SECOND_MICRO_USD: Readonly<Record<string, number>> = {
  'veo-3.1-generate-preview': 400_000,
  'veo-3.1-fast-generate-preview': 100_000,
  'veo-3.1-lite-generate-preview': 50_000,
};

/** US$ cost per second for the chosen model; 0 when the id is unknown. */
export function veoPerSecondMicroUsd(modelId = VEO_VIDEO_MODEL): number {
  return VEO_PER_SECOND_MICRO_USD[modelId] ?? 0;
}

/** The smallest accepted Veo duration that covers the shot, so the render can trim. */
export function veoDurationFor(shotDurationSec: number): number | null {
  if (!Number.isFinite(shotDurationSec) || shotDurationSec <= 0) return null;
  for (const candidate of VEO_DURATIONS_SEC) {
    if (candidate >= shotDurationSec) return candidate;
  }
  return null;
}

export function veoVideoEndpoint(modelId = VEO_VIDEO_MODEL): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(modelId)) throw new Error('The selected Veo model is invalid. Check the account again in Settings.');
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predictLongRunning`;
}

export function veoOperationEndpoint(operationName: string): string {
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(operationName)) throw new Error('Google returned an operation name Veo cannot poll.');
  return `https://generativelanguage.googleapis.com/v1beta/${operationName}`;
}

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 600_000;
const FETCH_TIMEOUT_MS = 120_000;

interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string; code?: number };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
    };
  };
}

function veoKey(): string {
  const settings = getSettings() as any;
  return apiKeyForProvider(settings, 'google-ai-studio') || apiKeyForProvider(settings, 'google-gemini');
}

export async function probeVeoVideo(req: GenerationRequest): Promise<GenerationCapability> {
  assertProviderOnlineAccess('Veo (Google)');
  const hasKey = !!veoKey();
  const perSecond = veoPerSecondMicroUsd(req.modelId);
  return {
    canGenerate: hasKey,
    ...(hasKey ? {} : { reason: VEO_VIDEO_NO_KEY_REASON }),
    // A per-second price reported against the shot's own duration: what the
    // router sums is what Google charges for exactly this clip.
    costMicroUsd: perSecond * Math.ceil(req.durationSec ?? 0),
    maxDurationSec: VEO_MAX_DURATION_SEC,
    maxWidth: 1920,
    maxHeight: 1080,
    imageToVideo: true,
    referenceImages: 'none',
    watermark: 'provider',
    availability: hasKey ? 'ready' : 'offline',
    deferred: false,
  };
}

/** Google's error, in words the owner can act on. Never includes the key. */
export function describeVeoVideoError(status: number, bodyText: string): string {
  let message = '';
  let code = '';
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string; status?: string } };
    message = parsed.error?.message ?? '';
    code = parsed.error?.status ?? '';
  } catch {
    message = bodyText;
  }
  message = message.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (status === 429 && /billing|free.tier|limit: 0|quota/i.test(message)) {
    return 'Google says this Gemini key has no Veo quota. Veo has no free tier: turn on billing for the key\'s project in Google AI Studio, then try again.';
  }
  if (status === 429) return `Google is rate-limiting this Gemini key. Wait a minute and try again. (${message || code || 'HTTP 429'})`;
  if (/API_KEY_INVALID|API key not valid/i.test(message) || status === 401) {
    return 'Google rejected the Gemini API key. Check the key saved in Settings.';
  }
  if (status === 403) return `Google refused this Gemini key for video generation. (${message || code || 'HTTP 403'})`;
  return `Veo request failed with HTTP ${status}. ${message}`.trim();
}

async function fetchJson(url: string, key: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('Veo did not answer within 2 minutes. Try again.');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function pollOperation(name: string, key: string): Promise<VeoOperation> {
  const started = Date.now();
  for (;;) {
    const resp = await fetchJson(veoOperationEndpoint(name), key);
    if (!resp.ok) throw new Error(describeVeoVideoError(resp.status, await resp.text()));
    const op = (await resp.json()) as VeoOperation;
    if (op.done) return op;
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      throw new Error('Veo did not finish the clip within 10 minutes. Try again.');
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export async function generateVeoVideoShot(req: GenerationRequest): Promise<GenerationResult> {
  const provider = 'veo-video';
  try {
    assertProviderOnlineAccess('Veo (Google)');
    const key = veoKey();
    if (!key) throw new Error(VEO_VIDEO_NO_KEY_REASON);
    const modelId = req.modelId || VEO_VIDEO_MODEL;
    const durationSec = req.durationSec && VEO_DURATIONS_SEC.includes(req.durationSec as 4 | 6 | 8)
      ? req.durationSec : undefined;
    if (!durationSec) throw new Error(`Veo makes 4, 6 or 8 second clips, not ${req.durationSec} seconds. Snap the shot duration to one of those before generating.`);

    // The image-to-video still travels as base64 in the request instance.
    let image: { bytesBase64Encoded: string; mimeType: string } | undefined;
    if (req.initImage) {
      const bytes = fs.readFileSync(req.initImage);
      const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      image = {
        bytesBase64Encoded: bytes.toString('base64'),
        mimeType: isPng ? 'image/png' : 'image/jpeg',
      };
    }

    const start = await fetchJson(veoVideoEndpoint(modelId), key, {
      method: 'POST',
      body: JSON.stringify({
        instances: [{ prompt: req.prompt, ...(image ? { image } : {}) }],
        parameters: {
          aspectRatio: req.height > req.width ? '9:16' : '16:9',
          durationSeconds: durationSec,
          resolution: '720p',
        },
      }),
    });
    if (!start.ok) throw new Error(describeVeoVideoError(start.status, await start.text()));
    const operation = (await start.json()) as VeoOperation;
    if (!operation.name) throw new Error('Google accepted the Veo request but returned no operation to poll.');

    const done = operation.done ? operation : await pollOperation(operation.name, key);
    if (done.error?.message) throw new Error(`Google reported the clip failed: ${done.error.message}`);
    const uri = done.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error('Veo finished without a downloadable video. Try again.');

    // The download URI is itself key-gated, and it must be fetched through the
    // same Online-consent gate as everything else.
    const video = await fetchJson(uri, key);
    if (!video.ok) throw new Error(`Veo's clip could not be downloaded (HTTP ${video.status}). Try again.`);
    const bytes = Buffer.from(await video.arrayBuffer());
    const file = saveMovieShotVideo(req, bytes);
    return { status: 'done', provider, files: [file], costMicroUsd: veoPerSecondMicroUsd(modelId) * durationSec };
  } catch (err) {
    return { status: 'failed', provider, error: (err as Error).message || String(err) };
  }
}

export const veoVideoProvider: GenerationProvider = {
  id: 'veo-video',
  kind: 'video',
  probe: probeVeoVideo,
  generate: generateVeoVideoShot,
};
