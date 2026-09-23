/**
 * GeminiImageAdapter — Google's current image model, paid per image.
 *
 * Imagen 3 and 4 are shut down (Gemini API deprecations page: 10 November 2025
 * and 17 August 2026); Google names `gemini-3.1-flash-image` as the replacement.
 * It has no free tier ("Not available" on the Gemini API pricing page, checked
 * 2026-09-16) and costs US$0.067 per 1K image, so it is only ever reached as an
 * explicit, confirmed choice — never as a fallback. Every image carries Google's
 * invisible SynthID watermark.
 *
 * Uses the owner's Gemini API key from Settings (the same key cloud chat uses),
 * sent in a header, only while Online is on.
 */

import type { GenerationCapability, GenerationProvider, GenerationRequest, GenerationResult } from './types';
import { getSettings } from '../config-manager';
import { apiKeyForProvider } from '../../shared/cloud-llm';
import { assertProviderOnlineAccess } from '../utils/provider-network-policy';
import { saveMovieShotImage } from './image-output';

export const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';
// Request shape follows Google's generateContent image guide (REST, checked
// 2026-09-16): v1 endpoint, aspect ratio and size under responseFormat.image.
export function geminiImageEndpoint(modelId = GEMINI_IMAGE_MODEL): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(modelId)) throw new Error('The selected Gemini image model is invalid. Check the account again in Settings.');
  return `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent`;
}

/** Gemini API list price for one standard 1K image (US$0.067). */
export const GEMINI_IMAGE_COST_MICRO_USD = 67_000;

/** The longest side of a 1K image in the shapes Storyboard draws (16:9 is 1376x768). */
const MAX_SIDE_1K = 1376;
const TIMEOUT_MS = 120_000;

export const GEMINI_IMAGE_NO_KEY_REASON = 'No Gemini API key is saved in Settings.';

/** Aspect ratios the model accepts, as width/height. */
const ASPECT_RATIOS: ReadonlyArray<[string, number]> = [
  ['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3],
  ['4:5', 4 / 5], ['5:4', 5 / 4], ['9:16', 9 / 16], ['16:9', 16 / 9], ['21:9', 21 / 9],
];

/** The supported aspect ratio closest to the requested frame. */
export function geminiAspectRatio(width: number, height: number): string {
  const wanted = Math.log(width / height);
  let best = ASPECT_RATIOS[0]!;
  for (const candidate of ASPECT_RATIOS) {
    if (Math.abs(Math.log(candidate[1]) - wanted) < Math.abs(Math.log(best[1]) - wanted)) best = candidate;
  }
  return best[0];
}

function geminiKey(): string {
  const settings = getSettings() as any;
  return apiKeyForProvider(settings, 'google-ai-studio') || apiKeyForProvider(settings, 'google-gemini');
}

export async function probeGeminiImage(_req: GenerationRequest): Promise<GenerationCapability> {
  assertProviderOnlineAccess('Gemini');
  const hasKey = !!geminiKey();
  return {
    canGenerate: hasKey,
    ...(hasKey ? {} : { reason: GEMINI_IMAGE_NO_KEY_REASON }),
    costMicroUsd: GEMINI_IMAGE_COST_MICRO_USD,
    maxDurationSec: 0,
    maxWidth: MAX_SIDE_1K,
    maxHeight: MAX_SIDE_1K,
    imageToVideo: false,
    referenceImages: 'none',
    watermark: 'provider',
    availability: hasKey ? 'ready' : 'offline',
    deferred: false,
  };
}

interface GeminiPart { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

/** Google's error, in words the owner can act on. Never includes the key. */
export function describeGeminiImageError(status: number, bodyText: string): string {
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
  if (status === 429 && /free[_ ]tier|limit: 0/i.test(message)) {
    return 'Google says this Gemini key has no image quota. Gemini image models have no free tier: turn on billing for the key\'s project in Google AI Studio, then try again.';
  }
  if (status === 429) return `Google is rate-limiting this Gemini key. Wait a minute and try again. (${message || code || 'HTTP 429'})`;
  if (/API_KEY_INVALID|API key not valid/i.test(message) || status === 401) {
    return 'Google rejected the Gemini API key. Check the key saved in Settings.';
  }
  if (status === 403) return `Google refused this Gemini key for image generation. (${message || code || 'HTTP 403'})`;
  return `Gemini image request failed with HTTP ${status}. ${message}`.trim();
}

export async function generateGeminiImage(
  prompt: string,
  width: number,
  height: number,
  modelId = GEMINI_IMAGE_MODEL,
): Promise<{ base64: string; mimeType: string }> {
  assertProviderOnlineAccess('Gemini');
  const key = geminiKey();
  if (!key) throw new Error(GEMINI_IMAGE_NO_KEY_REASON);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(geminiImageEndpoint(modelId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          responseFormat: { image: { aspectRatio: geminiAspectRatio(width, height), imageSize: '1K' } },
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('Gemini did not return an image within 2 minutes. Try again.');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok) throw new Error(describeGeminiImageError(resp.status, await resp.text()));

  const data = (await resp.json()) as GeminiResponse;
  const candidate = data.candidates?.[0];
  for (const part of candidate?.content?.parts ?? []) {
    const blob = part.inlineData ?? (part.inline_data && { mimeType: part.inline_data.mime_type, data: part.inline_data.data });
    if (blob?.data && blob.data.length >= 100) return { base64: blob.data, mimeType: blob.mimeType || 'image/png' };
  }
  const why = data.promptFeedback?.blockReason || candidate?.finishReason;
  throw new Error(why
    ? `Gemini made no image for this prompt (${why}). Try rewording the shot.`
    : 'Gemini returned no image data.');
}

export async function generateGeminiImageShot(req: GenerationRequest): Promise<GenerationResult> {
  try {
    const { base64 } = await generateGeminiImage(req.prompt, req.width, req.height, req.modelId);
    const file = saveMovieShotImage(req, base64);
    return { status: 'done', provider: 'gemini-image', files: [file], costMicroUsd: GEMINI_IMAGE_COST_MICRO_USD };
  } catch (err) {
    return { status: 'failed', provider: 'gemini-image', error: (err as Error).message || String(err) };
  }
}

export const geminiImageProvider: GenerationProvider = {
  id: 'gemini-image',
  kind: 'image',
  probe: probeGeminiImage,
  generate: generateGeminiImageShot,
};


// Image-to-image: Google's image guide (raw docs, checked 2026-09-17) sends
// reference images through the Interactions API — typed `input` blocks and a
// response format. `store: false` because the default keeps every request,
// images included, on Google's servers for 55 days.
const GEMINI_INTERACTIONS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** Gemini 3.1 Flash Image accepts up to 10 object images plus 4 character images. */
export const GEMINI_MAX_REFERENCE_IMAGES = 14;

export interface GeminiInputImage { mimeType: 'image/png' | 'image/jpeg'; base64: string }

/** The last image block anywhere in an Interactions response (`output_image` in the SDKs). */
export function lastInteractionImage(body: unknown): { base64: string; mimeType: string } | null {
  let found: { base64: string; mimeType: string } | null = null;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o.type === 'image' && typeof o.data === 'string' && o.data.length >= 100) {
      found = { base64: o.data, mimeType: typeof o.mime_type === 'string' ? o.mime_type : 'image/png' };
    }
    for (const value of Object.values(o)) if (value && typeof value === 'object') walk(value);
  };
  walk(body);
  return found;
}

/** Draw from a prompt plus reference images (a layout guide, the character's art). */
export async function generateGeminiImageFromImages(
  prompt: string,
  images: GeminiInputImage[],
  aspectRatio: string,
): Promise<{ base64: string; mimeType: string }> {
  assertProviderOnlineAccess('Gemini');
  const key = geminiKey();
  if (!key) throw new Error(GEMINI_IMAGE_NO_KEY_REASON);
  if (images.length > GEMINI_MAX_REFERENCE_IMAGES) {
    throw new Error(`Gemini takes at most ${GEMINI_MAX_REFERENCE_IMAGES} reference images.`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(GEMINI_INTERACTIONS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: GEMINI_IMAGE_MODEL,
        input: [
          { type: 'text', text: prompt },
          ...images.map(image => ({ type: 'image', mime_type: image.mimeType, data: image.base64 })),
        ],
        response_format: { type: 'image', aspect_ratio: aspectRatio, image_size: '1K' },
        store: false,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('Gemini did not return an image within 2 minutes. Try again.');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  const textBody = await resp.text();
  if (!resp.ok) throw new Error(describeGeminiImageError(resp.status, textBody));
  let body: unknown;
  try { body = JSON.parse(textBody); } catch { throw new Error('Gemini returned a response that is not JSON.'); }
  const image = lastInteractionImage(body);
  if (!image) {
    const status = (body as { status?: string })?.status;
    throw new Error(`Gemini returned no image${status ? ` (status ${status})` : ''}. Try again.`);
  }
  return image;
}
