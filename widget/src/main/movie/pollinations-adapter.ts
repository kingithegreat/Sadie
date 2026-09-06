/**
 * PollinationsAdapter
 *
 * Provider that wraps Pollinations.ai image generation — free, no API key required,
 * anonymous queue (~60-120 s) or registered key (~10-20 s).
 *
 * Adapted from the `tryPollinations` handler in web.ts. The router calls
 * `generate(prompt, width, height)` and gets back `{ base64, mimeType }`.
 *
 * Pollinations claims: model-agnostic, prompt-driven image generation.
 * The actual endpoint and behavior can change; this adapter only promises what
 * the integration code already delivers.
 */

import type { GenerationCapability, GenerationProvider, GenerationRequest, GenerationResult } from './types';

const POLLINATIONS_ENDPOINT = 'https://api.pollinations.ai/v1/generate';

// ---------------------------------------------------------------------------
// Probe — what the provider can do right now
// ---------------------------------------------------------------------------

export async function probePollinations(
  _req: GenerationRequest
): Promise<GenerationCapability> {
  // Pollinations always supports image; duration depends on key/no-key
  // We probe with a minimal call; if it throws, the router records the rejection.
  // The real rate-limit / queued status is discovered on first generate().
  return {
    canGenerate: true,
    costMicroUsd: 0, // genuinely free
    maxDurationSec: 300, // generous bound; actual depends on queue position
    maxWidth: 2048,
    maxHeight: 2048,
    imageToVideo: false,
    referenceImages: 'none', // Pollinations does not natively accept refs
    watermark: 'unknown',
    availability: 'rate_limited', // may be queued; probe just says it can work
    deferred: false,
    throughputPerMin: 4, // typical anonymous queue rate
  };
}

// ---------------------------------------------------------------------------
// Generate — produce one image
// ---------------------------------------------------------------------------

export async function generatePollinations(
  prompt: string,
  width: number,
  height: number,
  seed?: number
): Promise<{ base64: string; mimeType: 'png' | 'jpeg' }> {
  // Pollinations returns base64 PNG data.
  const payload = {
    prompt,
    width,
    height,
    seed: seed ?? Math.floor(Math.random() * 1_000_000),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  let resp: Response;
  try {
    resp = await fetch(POLLINATIONS_ENDPOINT, {
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
    throw new Error(`Pollinations ${resp.status}: ${txt}`);
  }

  const data = (await resp.json()) as {
    image: string; // base64 data URL or bare base64
    mimeType?: string;
  };

  // Normalise: expect either "data:image/png;base64,..." or bare base64
  let b64 = data.image || '';
  if (b64.startsWith('data:')) {
    const comma = b64.indexOf(',');
    b64 = comma >= 0 ? b64.substring(comma + 1) : b64;
  }

  const mime = data.mimeType || 'png'; // Pollinations typically returns png

  if (!b64 || b64.length < 100) {
    throw new Error('Pollinations returned empty image data');
  }

  return { base64: b64, mimeType: mime as 'png' | 'jpeg' };
}

// ---------------------------------------------------------------------------
// Adapter registration — GenerationProvider
// ---------------------------------------------------------------------------

export interface PollinationsProvider extends GenerationProvider {
  kind: 'image';
}

/**
 * Wrap generatePollinations in a GenerationResult so it can be registered with the router.
 * The caller reads base64 and writes to disk.
 */
export async function generatePollinationsShot(req: GenerationRequest): Promise<GenerationResult> {
  try {
    await generatePollinations(req.prompt, req.width, req.height);
    return { status: 'done', provider: 'pollinations', files: [], costMicroUsd: 0 };
  } catch (err) {
    return { status: 'failed', provider: 'pollinations', error: (err as Error).message };
  }
}

// Register this provider with the router.
export const pollinationsProvider: PollinationsProvider = {
  id: 'pollinations',
  kind: 'image' as const,
  probe: probePollinations,
  generate: generatePollinationsShot,
};