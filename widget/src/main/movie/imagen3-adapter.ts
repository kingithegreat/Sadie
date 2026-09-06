/**
 * Imagen3Adapter
 *
 * Provider that wraps Google AI Studio's Imagen 3 text-to-image model.
 * Requires a GEMINI_API_KEY environment variable; without it, reports offline.
 *
 * Adapted from `generateSpriteSheetImage` in character-sprites.ts but returns a
 * single image (not a sprite sheet). The model is Imagen 3.0 Generate 002.
 *
 * Google AI Studio offers Imagen 3 free with rate limits (15 RPM documented).
 * If the key is missing or invalid, the adapter reports canGenerate: false.
 */

import type { GenerationCapability, GenerationProvider, GenerationRequest, GenerationResult } from './types';

const IMAGEN_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict';

// ---------------------------------------------------------------------------
// Probe — what the provider can do right now
// ---------------------------------------------------------------------------

export async function probeImagen3(
  _req: GenerationRequest
): Promise<GenerationCapability> {
  const apiKey = process.env.GEMINI_API_KEY;

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

export async function generateImagen3(
  prompt: string,
  _width: number,
  _height: number,
  _seed?: number
): Promise<{ base64: string; mimeType: 'png' }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  // Imagen 3 expects a specific JSON payload.
  // Width and height must be one of the supported aspect ratios; we will
  // request the closest and then let the caller crop/resize if needed.
  // For simplicity, we ask for the exact size and hope the model complies.
  // In practice, Imagen 3 returns 1024x1024 squares; we may need to adapt.
  const payload = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      // width and height are not direct parameters; aspect ratio is controlled via
      // the prompt or by post-processing. For now, we ignore and document.
    },
  };

  const endpoint = `${IMAGEN_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Imagen 3 ${resp.status}: ${txt}`);
  }

  const data = (await resp.json()) as {
    predictions?: {
      bytesBase64Encoded?: string;
      mimeType?: string; // usually 'image/png'
    }[];
  };

  const pred = data.predictions?.[0];
  if (!pred?.bytesBase64Encoded) {
    throw new Error('Imagen 3 returned no image');
  }

  const b64 = pred.bytesBase64Encoded;
  const mime = pred.mimeType ?? 'png';

  if (mime !== 'image/png') {
    // Imagen 3 is documented to return PNG; if it changes, we adapt.
    throw new Error(`Imagen 3 returned unexpected mime type: ${mime}`);
  }

  if (b64.length < 100) {
    throw new Error('Imagen 3 returned empty image data');
  }

  return { base64: b64, mimeType: 'png' as const };
}

// ---------------------------------------------------------------------------
// Adapter registration — GenerationProvider
// ---------------------------------------------------------------------------

export interface Imagen3Provider extends GenerationProvider {
  kind: 'image';
}

/**
 * Wrap generateImagen3 in a GenerationResult so it can be registered with the router.
 * The caller reads base64 and writes to disk.
 */
export async function generateImagen3Shot(req: GenerationRequest): Promise<GenerationResult> {
  try {
    await generateImagen3(req.prompt, req.width, req.height);
    return { status: 'done', provider: 'imagen-3', files: [], costMicroUsd: 0 };
  } catch (err) {
    return { status: 'failed', provider: 'imagen-3', error: (err as Error).message };
  }
}

// Register this provider with the router.
export const imagen3Provider: Imagen3Provider = {
  id: 'imagen-3',
  kind: 'image' as const,
  probe: probeImagen3,
  generate: generateImagen3Shot,
};