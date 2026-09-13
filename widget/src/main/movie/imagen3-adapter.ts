/**
 * Imagen3Adapter
 *
 * Provider that wraps Google AI Studio's Imagen 3 text-to-image model.
 * Uses the Gemini API key from settings (google-ai-studio provider vault).
 *
 * Adapted from `generateSpriteSheetImage` in character-sprites.ts but returns a
 * single image (not a sprite sheet). The model is Imagen 3.0 Generate 002.
 *
 * Google retired Imagen 3 on 2026-08-17. The adapter remains registered so
 * existing projects produce a clear, local failure instead of transmitting a
 * prompt to a retired endpoint.
 */

import type { GenerationCapability, GenerationProvider, GenerationRequest, GenerationResult } from './types';
import { assertProviderOnlineAccess } from '../utils/provider-network-policy';

export const IMAGEN_3_RETIRED_MESSAGE =
  'Google Imagen 3 was retired on 2026-08-17. Choose Pollinations or update the configured image provider before generating.';


// ---------------------------------------------------------------------------
// Probe — what the provider can do right now
// ---------------------------------------------------------------------------

export async function probeImagen3(
  _req: GenerationRequest
): Promise<GenerationCapability> {
  assertProviderOnlineAccess('Imagen');
  return {
    canGenerate: false,
    reason: IMAGEN_3_RETIRED_MESSAGE,
    costMicroUsd: 0,
    maxDurationSec: 0,
    maxWidth: 0,
    maxHeight: 0,
    imageToVideo: false,
    referenceImages: 'none', // Imagen 3 does not natively accept refs
    watermark: 'unknown',
    availability: 'offline',
    deferred: false,
    throughputPerMin: 0,
  };
}

// ---------------------------------------------------------------------------
// Generate — produce one image
// ---------------------------------------------------------------------------

export { generateImagen3 } from '../tools/imagen';

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
    assertProviderOnlineAccess('Imagen');
  } catch (err) {
    return { status: 'failed', provider: 'imagen-3', error: (err as Error).message };
  }
  void req;
  return { status: 'failed', provider: 'imagen-3', error: IMAGEN_3_RETIRED_MESSAGE };
}

// Register this provider with the router.
export const imagen3Provider: Imagen3Provider = {
  id: 'imagen-3',
  kind: 'image' as const,
  probe: probeImagen3,
  generate: generateImagen3Shot,
};
