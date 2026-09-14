import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Contract-only decoder double: accepts any PNG/JPEG signature so a regenerate
// can change format the way real providers do (Pollinations sends JPEG, the
// local plate and Imagen send PNG). Real decoding is covered by the e2e suite.
jest.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (bytes: Buffer) => ({
      isEmpty: () => bytes.length === 0,
      getSize: () => ({ width: 64, height: 36 }),
    }),
  },
}));

import { saveMovieShotImage } from '../movie/image-output';
import { assembleScene } from '../movie/storyboard-assembly';
import type { GenerationRequest } from '../movie/types';

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, 1)]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

let projectDir: string;
let shotDir: string;
let req: GenerationRequest;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-frame-replace-'));
  const sceneDir = path.join(projectDir, 'scenes', 'scene_01');
  shotDir = path.join(sceneDir, 'shot_001');
  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, 'scene.json'), JSON.stringify({ sceneId: 'scene_01', shots: ['shot_001'] }));
  fs.writeFileSync(path.join(shotDir, 'prompt.json'), JSON.stringify({ prompt: 'Harbour at dawn', durationSec: 4 }));
  req = { kind: 'image', prompt: 'Harbour at dawn', width: 1024, height: 576, shotId: 'shot_001', shotDir,
    freeOnly: true, allowWatermark: false, allowDeferred: false };
});
afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

/** A regenerate happens after the first attempt; make that ordering explicit on disk. */
function age(file: string) {
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(file, past, past);
}

test.each([
  ['JPEG then PNG', jpeg, png],
  ['PNG then JPEG', png, jpeg],
])('a regenerated frame (%s) is the one the board and export use', (_name, first, second) => {
  const original = saveMovieShotImage(req, first.toString('base64'));
  age(original);
  const replacement = saveMovieShotImage(req, second.toString('base64'));
  expect(replacement).not.toBe(original);
  expect(assembleScene(projectDir, 'scene_01')!.shots[0].frameImagePath).toBe(replacement);
  // The earlier attempt is retained on disk as a recoverable version, not deleted.
  expect(fs.readFileSync(original)).toEqual(first);
});

test('a frame generated after a legacy frame.png replaces it for the board and export', () => {
  const legacy = path.join(shotDir, 'image', 'frame.png');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, png);
  age(legacy);
  const generated = saveMovieShotImage(req, jpeg.toString('base64'));
  expect(assembleScene(projectDir, 'scene_01')!.shots[0].frameImagePath).toBe(generated);
});

test('an unchanged single frame is still found', () => {
  const only = saveMovieShotImage(req, png.toString('base64'));
  expect(assembleScene(projectDir, 'scene_01')!.shots[0].frameImagePath).toBe(only);
});

describe('a failed or invalid replacement keeps the previous good frame', () => {
  const corrupt = Buffer.from('this is not an image, whatever the provider claimed');
  const listing = () => fs.readdirSync(path.join(shotDir, 'image')).sort();

  test.each([
    ['PNG', png],
    ['JPEG', jpeg],
  ])('previous %s stays active and byte-identical when the next attempt is invalid', (_name, good) => {
    const kept = saveMovieShotImage(req, good.toString('base64'));
    const before = listing();
    expect(() => saveMovieShotImage(req, corrupt.toString('base64'))).toThrow(/not a PNG or JPEG/);
    expect(() => saveMovieShotImage(req, 'not base64 at all!')).toThrow();
    expect(listing()).toEqual(before); // no partial or temporary file left behind
    expect(fs.readFileSync(kept)).toEqual(good);
    expect(assembleScene(projectDir, 'scene_01')!.shots[0].frameImagePath).toBe(kept);
  });

  test('after a mixed-format history, a failed attempt leaves the newest successful frame active and every version recoverable', () => {
    const first = saveMovieShotImage(req, png.toString('base64'));
    age(first);
    const second = saveMovieShotImage(req, jpeg.toString('base64'));
    expect(() => saveMovieShotImage(req, corrupt.toString('base64'))).toThrow();
    expect(listing()).toEqual(['shot_001.jpg', 'shot_001.png']);
    expect(assembleScene(projectDir, 'scene_01')!.shots[0].frameImagePath).toBe(second);
    expect(fs.readFileSync(first)).toEqual(png);
    expect(fs.readFileSync(second)).toEqual(jpeg);
  });
});
