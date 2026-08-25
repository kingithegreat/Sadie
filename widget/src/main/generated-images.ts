/**
 * Durable storage for images HomeBot generates.
 *
 * The chat path has always written its results here (message-router.ts) and
 * rendered them back by filename; the panel path did not — its result lived in
 * React state only, so Clear or closing the panel destroyed the image. This
 * module gives both paths the same durable home and naming convention.
 *
 * Pure fs + data: no Electron import, so the caller supplies the directory
 * (usually path.join(app.getPath('userData'), 'generated-images')) and tests
 * supply a temp one.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Same shape the chat path has always used, so both paths are indistinguishable on disk. */
export function generatedImagesFilename(now: () => number = Date.now): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `img-${now()}-${rand}.png`;
}

/**
 * Decode a base64 image and write it durably.
 *
 * Returns the filename it was written under, or null when there was nothing
 * to write (empty/undecodable input) or the write failed — a persistence
 * failure must not fail the generation that already succeeded.
 */
export function saveGeneratedImage(base64: string, dir: string, now: () => number = Date.now): string | null {
  const b64 = String(base64 || '').trim();
  if (!b64) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  if (!buf || buf.length === 0) return null;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = generatedImagesFilename(now);
    fs.writeFileSync(path.join(dir, filename), buf);
    return filename;
  } catch (e) {
    console.error('[Generated Images] Could not persist image:', e);
    return null;
  }
}
