/**
 * Imagen3Adapter
 *
 * Provider that wraps Google AI Studio's Imagen 3 text-to-image model.
 * Uses the Gemini API key from settings (google-ai-studio provider vault).
 *
 * Adapted from `generateSpriteSheetImage` in character-sprites.ts but returns a
 * single image (not a sprite sheet). The model is Imagen 3.0 Generate 002.
 *
 * Google AI Studio offers Imagen 3 free with rate limits (15 RPM documented).
 * If the key is missing or invalid, the adapter reports canGenerate: false.
 */

import type { GenerationCapability, GenerationProvider, GenerationRequest, GenerationResult } from './types';
import { getSettings } from '../config-manager';
import { apiKeyForProvider } from '../../shared/cloud-llm';
import { assertProviderOnlineAccess } from '../utils/provider-network-policy';
import { saveMovieShotImage } from './image-output';


// ---------------------------------------------------------------------------
// Probe — what the provider can do right now
// ---------------------------------------------------------------------------

export async function probeImagen3(
  _req: GenerationRequest
): Promise<GenerationCapability> {
  assertProviderOnlineAccess('Imagen');
  const settings = getSettings();
  const apiKey = apiKeyForProvider(settings as any, 'google-ai-studio');

  // If no key is present, we cannot generate.
  if (!apiKey) {
    return {
      canGenerate: false,
      reason: 'GEMINI_API_KEY not set',
      costMicroUsd: 0,
      maxDurationSec: 0,
      maxWidth: 0,
      maxHeight: 0,
      imageToVideo: false,
      referenceImages: 'none',
      watermark: 'unknown',
      availability: 'offline',
      deferred: false,
      throughputPerMin: 0,
    };
  }

  // With a key, we assume the service is reachable; actual quota errors
  // will be caught during generate() and turned into rejections.
  return {
    canGenerate: true,
    costMicroUsd: 0, // free with key
    maxDurationSec: 300,
    maxWidth: 2048,
    maxHeight: 2048,
    imageToVideo: false,
    referenceImages: 'none', // Imagen 3 does not natively accept refs
    watermark: 'unknown',
    availability: 'ready', // optimistic; generate() will discover rate limits
    deferred: false,
    throughputPerMin: 15, // documented free tier RPM
  };
}

// ---------------------------------------------------------------------------
// Generate — produce one image
// ---------------------------------------------------------------------------

import { generateImagen3 } from '../tools/imagen';
export { generateImagen3 };

// ---------------------------------------------------------------------------
// Adapter registration — GenerationProvider
// ---------------------------------------------------------------------------

export interface Imagen3Provider extends GenerationProvider {
  kind: 'image';
}

/**
 * Wrap generateImagen3 in a GenerationResult so it can be registered with the router.
 * Save the decoded image inside the shot before reporting completion.
 */
export async function generateImagen3Shot(req: GenerationRequest): Promise<GenerationResult> {
  try {
    const { base64 } = await generateImagen3(req.prompt, req.width, req.height);
    const file = saveMovieShotImage(req, base64);
    return { status: 'done', provider: 'imagen-3', files: [file], costMicroUsd: 0 };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (msg.includes('not configured') || msg.includes('API key')) {
      return { status: 'failed', provider: 'imagen-3', error: `Imagen 3 unavailable: ${msg}` };
    }
    return { status: 'failed', provider: 'imagen-3', error: msg };
  }
}

// Register this provider with the router.
export const imagen3Provider: Imagen3Provider = {
  id: 'imagen-3',
  kind: 'image' as const,
  probe: probeImagen3,
  generate: generateImagen3Shot,
};
