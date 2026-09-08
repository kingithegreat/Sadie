/** Studio image artifacts. No provider, credential or routing authority lives here. */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { nativeImage } from 'electron';
import { resolveWithinHome } from '../utils/path-guard';
import { isWithinHomeDir } from '../utils/home-boundary';
import type { GenerationRequest } from './types';

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

function shotRoot(shotDir: string): string {
  if (!shotDir || !path.isAbsolute(shotDir)) throw new Error('Image output needs an absolute shot folder.');
  const checked = resolveWithinHome(shotDir);
  if ('error' in checked) throw new Error(checked.error);
  // Check existing ancestors before mkdir, including junctions on Windows.
  let ancestor = checked.resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (!isWithinHomeDir(fs.realpathSync(ancestor), fs.realpathSync(os.homedir()))) {
    throw new Error('Image output folder leaves the home directory through a link.');
  }
  return checked.resolved;
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function decode(bytes: Buffer): 'png' | 'jpg' {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image output is empty or exceeds 32 MB.');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw new Error('Image output is not a PNG or JPEG image.');
  const image = nativeImage.createFromBuffer(bytes);
  const size = image.getSize();
  if (image.isEmpty() || size.width <= 0 || size.height <= 0) throw new Error('Image output could not be decoded.');
  return png ? 'png' : 'jpg';
}

/** Decode first, then replace the canonical shot image with a complete file. */
export function saveMovieShotImage(req: GenerationRequest, base64: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(req.shotId)) throw new Error('Image output has an invalid shot ID.');
  const b64 = base64.replace(/^data:image\/(?:png|jpe?g);base64,/i, '').trim();
  if (!b64 || b64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw new Error('Image output contains invalid or oversized base64 data.');
  }
  const bytes = Buffer.from(b64, 'base64');
  const extension = decode(bytes);
  const root = shotRoot(req.shotDir);
  fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync(root);
  const imageDir = path.join(root, 'image');
  if (fs.existsSync(imageDir) && !inside(realRoot, fs.realpathSync(imageDir))) {
    throw new Error('Image output folder leaves the shot through a link.');
  }
  fs.mkdirSync(imageDir, { recursive: true });
  const output = path.join(imageDir, `${req.shotId}.${extension}`);
  const temporary = path.join(imageDir, `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    fs.renameSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return output;
}

/** Do not trust a provider's done flag, a filename, or a cached state alone. */
export function validateMovieImageFiles(shotDir: string, files: string[]): void {
  if (!Array.isArray(files) || files.length === 0) throw new Error('No image output was saved.');
  const root = fs.realpathSync(shotRoot(shotDir));
  for (const file of files) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !inside(root, fs.realpathSync(file))) {
      throw new Error('Image output must stay inside its shot folder.');
    }
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) throw new Error('Image output is not a usable file.');
    decode(fs.readFileSync(file));
  }
}
