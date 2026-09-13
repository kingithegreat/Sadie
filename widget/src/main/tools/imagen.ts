/**
 * Google AI Studio Imagen 3 — RETIRED.
 *
 * Google shut down `imagen-3.0-generate-002` on 10 November 2025 (Gemini API
 * deprecations page; its Imagen 4 successors were shut down on 17 August 2026).
 * Any request to it can only fail, so HomeBot refuses before reaching the
 * network: no Gemini key is read or sent, and callers fall back or report this
 * message. A replacement Google image model would be a new paid provider and
 * needs the owner's explicit decision; it is not wired in here.
 */

export const IMAGEN3_RETIRED_MESSAGE =
  'Google retired Imagen 3 on 10 November 2025, so HomeBot no longer uses it. Choose another way to make images.';

export class Imagen3RetiredError extends Error {
  readonly code = 'IMAGEN3_RETIRED';
  constructor() {
    super(IMAGEN3_RETIRED_MESSAGE);
    this.name = 'Imagen3RetiredError';
  }
}

export async function generateImagen3(
  _prompt: string,
  _width: number,
  _height: number,
  _seed?: number,
): Promise<{ base64: string; mimeType: 'png' }> {
  throw new Imagen3RetiredError();
}
