/**
 * LocalSD15Adapter
 *
 * Provider that wraps a LOCAL Stable Diffusion 1.5 instance running behind
 * AUTOMATIC1111 at http://127.0.0.1:7860/sdapi/v1/txt2img.
 *
 * Measured constraints on the RTX 2050 (4 GB):
 *   - SDXL needs 8-12 GB; cannot run it.
 *   - SD 1.5 fits and produces 512x512 reliably.
 *
 * The adapter therefore advertises max 512x512 and the router will REJECT
 * larger requests with a clear "max 512x512 < requested NxN" reason.
 *
 * Adapted from `tryAutomatic1111` in web.ts but returns a GenerationResult.
 */

import * as http from 'http';
import type { GenerationCapability, GenerationRequest, GenerationResult, GenerationProvider } from './types';

const LOCAL_SD_URL = process.env.LOCAL_SD_ENDPOINT ?? 'http://127.0.0.1:7860/sdapi/v1/txt2img';
// ---------------------------------------------------------------------------
// Probe — what the provider can do right now
// ---------------------------------------------------------------------------

export async function probeLocalSD15(
  _req: GenerationRequest
): Promise<GenerationCapability> {
  // Quick reachability check: hit the A1111 /sdapi/v1/sd-models endpoint.
  // If it answers, WebUI is up and SD 1.5 is loaded (assumed).
  const reachable = await isReachable();
  if (!reachable) {
    return {
      canGenerate: false,
      reason: 'local SD WebUI not reachable at http://127.0.0.1:7860',
      costMicroUsd: 0,
      maxDurationSec: 0,
      maxWidth: 0,
      maxHeight: 0,
      imageToVideo: false,
      referenceImages: 'single',
      watermark: 'none',
      availability: 'offline',
      deferred: false,
      throughputPerMin: 0,
    };
  }

  return {
    canGenerate: true,
    costMicroUsd: 0,
    maxDurationSec: 0,
    maxWidth: 512,
    maxHeight: 512,
    imageToVideo: false,
    referenceImages: 'single',
    watermark: 'none',
    availability: 'ready',
    deferred: false,
    throughputPerMin: 2,
  };
}

/**
 * Reachability probe: a 1-second OPTIONS call to the A1111 base URL.
 * Returns true if the WebUI responds with anything, false otherwise.
 */
async function isReachable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const url = new URL(LOCAL_SD_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: '/sdapi/v1/sd-models',
        method: 'GET',
        timeout: 2000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
// ---------------------------------------------------------------------------
// Generate — produce one image
// ---------------------------------------------------------------------------

export async function generateLocalSD15(
  _prompt: string,
  _width: number,
  _height: number,
  _steps: number = 20
): Promise<{ base64: string; mimeType: 'png' }> {
  if (_width > 512 || _height > 512) {
    throw new Error(`Local SD 1.5 max resolution is 512x512; requested ${_width}x${_height}`);
  }

  const payload = JSON.stringify({
    prompt: _prompt,
    negative_prompt: '',
    width: _width,
    height: _height,
    steps: _steps,
    cfg_scale: 7,
    sampler_name: 'Euler a',
  });

  const base64Image = await new Promise<string>((resolve, reject) => {
    const url = new URL(LOCAL_SD_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 180000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Local SD 1.5 returned ${res.statusCode}: ${text}`));
            return;
          }
          try {
            const data = JSON.parse(text);
            if (data.images?.[0]) {
              resolve(data.images[0]);
            } else {
              reject(new Error('Local SD 1.5 returned no images'));
            }
          } catch (err) {
            reject(new Error(`Local SD 1.5 parse error: ${(err as Error).message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Local SD 1.5 request timed out'));
    });
    req.write(payload);
    req.end();
  });

  if (!base64Image || base64Image.length < 100) {
    throw new Error('Local SD 1.5 returned empty image data');
  }

    return { base64: base64Image, mimeType: 'png' as const };
}

// ---------------------------------------------------------------------------
// Adapter registration — GenerationProvider
// ---------------------------------------------------------------------------

/**
 * Wrap generateLocalSD15 in a GenerationResult so it can be registered with the router.
 * The caller reads base64 and writes to disk.
 */
export async function generateLocalSD15Shot(req: GenerationRequest): Promise<GenerationResult> {
  if (req.width > 512 || req.height > 512) {
    return {
      status: 'failed',
      provider: 'local-sd15',
      error: `Local SD 1.5 max resolution is 512x512; requested ${req.width}x${req.height}`,
    };
  }

  try {
    await generateLocalSD15(req.prompt, req.width, req.height);
    return { status: 'done', provider: 'local-sd15', files: [], costMicroUsd: 0 };
  } catch (err) {
    return { status: 'failed', provider: 'local-sd15', error: (err as Error).message };
  }
}

export const localSD15Provider: GenerationProvider = {
  id: 'local-sd15',
  kind: 'image' as const,
  probe: probeLocalSD15,
  generate: generateLocalSD15Shot,
};
