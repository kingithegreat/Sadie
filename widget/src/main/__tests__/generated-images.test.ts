/**
 * generated-images.test.ts
 *
 * Rung 1 of the image-edit ladder: a generated image must be durable - on
 * disk, in one known place, under the same naming the chat path has always
 * used. These tests are pure fs; no Electron.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { saveGeneratedImage, generatedImagesFilename } from '../generated-images';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-img-test-'));
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('saveGeneratedImage', () => {
  test('writes decodable bytes and returns the filename it used', () => {
    const base64 = Buffer.from('not-a-real-png-but-unique-bytes-1234').toString('base64');
    const filename = saveGeneratedImage(base64, dir);

    expect(filename).toMatch(/^img-[0-9]+-[a-z0-9]+\.png$/);
    const written = fs.readFileSync(path.join(dir, filename!), 'utf8');
    expect(written).toBe('not-a-real-png-but-unique-bytes-1234');
  });

  test('creates the directory when it does not exist', () => {
    const nested = path.join(dir, 'generated-images');
    const filename = saveGeneratedImage(Buffer.from('x').toString('base64'), nested);
    expect(filename).toBeTruthy();
    expect(fs.existsSync(path.join(nested, filename!))).toBe(true);
  });

  test('empty input persists nothing and says so with null', () => {
    expect(saveGeneratedImage('', dir)).toBeNull();
    expect(saveGeneratedImage('   ', dir)).toBeNull();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  test('two saves never share a filename', () => {
    const b64 = Buffer.from('same-bytes').toString('base64');
    const a = saveGeneratedImage(b64, dir, () => 1000);
    const b = saveGeneratedImage(b64, dir, () => 1000);
    expect(a).not.toBe(b);
    expect(fs.readdirSync(dir)).toHaveLength(2);
  });
});

describe('generatedImagesFilename', () => {
  test('follows the convention the chat path established', () => {
    // img-<ts>-<rand>.png - message-router.ts has written this shape since
    // chat images first became durable; the panel must be indistinguishable.
    expect(generatedImagesFilename(() => 1781674517271)).toMatch(/^img-1781674517271-[a-z0-9]{2,8}\.png$/);
  });
});
