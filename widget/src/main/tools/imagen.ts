/**
 * Core Google AI Studio Imagen 3 generation client.
 * Uses the Gemini API key from settings (google-ai-studio provider vault).
 */

import { getSettings } from '../config-manager';
import { apiKeyForProvider } from '../../shared/cloud-llm';
import { assertProviderOnlineAccess } from '../utils/provider-network-policy';

export const IMAGEN_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict';

export async function generateImagen3(
  prompt: string,
  _width: number,
  _height: number,
  _seed?: number
): Promise<{ base64: string; mimeType: 'png' }> {
  assertProviderOnlineAccess('Imagen');
  const settings = getSettings();
  const apiKey = apiKeyForProvider(settings as any, 'google-ai-studio');
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Add it in Settings → Custom LLM → Google AI Studio.');
  }

  const payload = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
    },
  };

  const endpoint = `${IMAGEN_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  let resp: Response;
  try {
    assertProviderOnlineAccess('Imagen');
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
      mimeType?: string;
    }[];
  };

  const pred = data.predictions?.[0];
  if (!pred?.bytesBase64Encoded) {
    throw new Error('Imagen 3 returned no image');
  }

  const b64 = pred.bytesBase64Encoded;
  const mime = pred.mimeType ?? 'png';

  if (mime !== 'image/png') {
    throw new Error(`Imagen 3 returned unexpected mime type: ${mime}`);
  }

  if (b64.length < 100) {
    throw new Error('Imagen 3 returned empty image data');
  }

  return { base64: b64, mimeType: 'png' as const };
}
