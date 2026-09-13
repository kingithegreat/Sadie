/**
 * Imagen3Adapter — retired provider.
 *
 * Google shut down Imagen 3 (`imagen-3.0-generate-002`) on 10 November 2025, so
 * this adapter stays registered only to give routers an honest rejection reason.
 * The probe reports it cannot generate without reading settings, a key or the
 * network; generation refuses through the retired client (tools/imagen.ts).
 * The cost is kept truthful (it was billed per image) so no FREE ONLY route
 * could ever treat it as free.
 */

import type { GenerationCapability, GenerationProvider, GenerationRequest, GenerationResult } from './types';
import { saveMovieShotImage } from './image-output';
import { generateImagen3, IMAGEN3_RETIRED_MESSAGE } from '../tools/imagen';

export { generateImagen3 };

/** Gemini API list price per Imagen 3 image while it existed (US$0.03). */
export const IMAGEN3_COST_MICRO_USD = 30_000;

export async function probeImagen3(_req: GenerationRequest): Promise<GenerationCapability> {
  return {
    canGenerate: false,
    reason: IMAGEN3_RETIRED_MESSAGE,
    costMicroUsd: IMAGEN3_COST_MICRO_USD,
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

export interface Imagen3Provider extends GenerationProvider {
  kind: 'image';
}

/** Kept for the router contract; the retired client refuses before any request. */
export async function generateImagen3Shot(req: GenerationRequest): Promise<GenerationResult> {
  try {
    const { base64 } = await generateImagen3(req.prompt, req.width, req.height);
    const file = saveMovieShotImage(req, base64);
    return { status: 'done', provider: 'imagen-3', files: [file], costMicroUsd: IMAGEN3_COST_MICRO_USD };
  } catch (err) {
    return { status: 'failed', provider: 'imagen-3', error: (err as Error).message || String(err) };
  }
}

export const imagen3Provider: Imagen3Provider = {
  id: 'imagen-3',
  kind: 'image' as const,
  probe: probeImagen3,
  generate: generateImagen3Shot,
};
