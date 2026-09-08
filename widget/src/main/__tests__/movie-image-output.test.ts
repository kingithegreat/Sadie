import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { AddressInfo } from 'net';

// Node contract tests use a decoder double that accepts only the known fixture.
// The Electron regression exercises the real native decoder and saved pixels.
jest.mock('electron', () => ({ nativeImage: require('./helpers/movie-image').movieNativeImageStub }));
jest.mock('../config-manager', () => ({ getSettings: () => ({ useCustomLLM: true, allowCloud: true }) }));
jest.mock('../../shared/cloud-llm', () => ({ ...jest.requireActual('../../shared/cloud-llm'), apiKeyForProvider: () => 'test-fixture-key' }));

import { generatePollinationsShot } from '../movie/pollinations-adapter';
import { generateImagen3Shot } from '../movie/imagen3-adapter';
import { generateLocalSD15Shot } from '../movie/local-sd15-adapter';
import { GenerationRouter } from '../movie/router';
import { MovieProjectRunner } from '../movie/project-runner';
import { saveMovieShotImage } from '../movie/image-output';
import type { GenerationProvider, GenerationRequest } from '../movie/types';

const bytes = fs.readFileSync(path.join(__dirname, '../../../resources/icon.png'));
let dir: string;
let req: GenerationRequest;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-image-output-'));
  req = { kind: 'image', prompt: 'Fixture', width: 256, height: 256, shotId: 'shot_01', shotDir: dir,
    freeOnly: true, allowWatermark: true, allowDeferred: false };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

for (const [name, generate] of [['Pollinations', generatePollinationsShot], ['Imagen', generateImagen3Shot]] as const) {
  for (const valid of [true, false]) {
    test(`${name} ${valid ? 'saves the returned image before done' : 'rejects corrupt image bytes'}`, async () => {
      const base64 = (valid ? bytes : Buffer.from('not an image'.repeat(100))).toString('base64');
      globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
        image: base64, mimeType: 'image/png', predictions: [{ bytesBase64Encoded: base64, mimeType: 'image/png' }],
      }) });
      const result = await generate(req);
      expect(result.status).toBe(valid ? 'done' : 'failed');
      if (result.status === 'done') {
        expect(result.files).toHaveLength(1);
        expect(fs.readFileSync(result.files[0])).toEqual(bytes);
      } else expect(fs.existsSync(path.join(dir, 'image', 'shot_01.png'))).toBe(false);
    });
  }
}

test('Stable Diffusion writes real loopback response bytes to the shot folder', async () => {
  const server = http.createServer((_request, response) => response.end(JSON.stringify({ images: [bytes.toString('base64')] })));
  const original = process.env.LOCAL_SD_ENDPOINT;
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.LOCAL_SD_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}/sdapi/v1/txt2img`;
  try {
    const result = await generateLocalSD15Shot(req);
    expect(result.status).toBe('done');
    if (result.status !== 'done') throw new Error('Expected saved output');
    expect(result.files).toHaveLength(1);
    expect(fs.readFileSync(result.files[0])).toEqual(bytes);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (original === undefined) delete process.env.LOCAL_SD_ENDPOINT;
    else process.env.LOCAL_SD_ENDPOINT = original;
  }
});

function provider(files: string[]): GenerationProvider {
  return { id: 'fixture', kind: 'image', probe: async () => ({ canGenerate: true, costMicroUsd: 0,
    maxWidth: 2048, maxHeight: 2048, maxDurationSec: 0, imageToVideo: false, referenceImages: 'none',
    watermark: 'none', availability: 'ready', deferred: false }),
  generate: async () => ({ status: 'done', provider: 'fixture', files, costMicroUsd: 0 }) };
}

test.each(['empty list', 'missing', 'empty file', 'corrupt', 'directory', 'outside'])('router refuses success with %s output', async kind => {
  const file = path.join(dir, 'image.png');
  if (kind === 'outside') {
    req.shotDir = path.join(dir, 'shot');
    fs.mkdirSync(req.shotDir);
    fs.writeFileSync(file, bytes); // A real valid image, outside this shot only.
  }
  if (kind === 'empty file' || kind === 'corrupt') fs.writeFileSync(file, kind === 'corrupt' ? 'bad image' : '');
  if (kind === 'directory') fs.mkdirSync(file);
  const result = await new GenerationRouter().register(provider(kind === 'empty list' ? [] : [file])).generate(req);
  expect(result.result.status).toBe('failed');
});

test('router falls back from unusable output to a saved image', async () => {
  const file = path.join(dir, 'good.png');
  fs.writeFileSync(file, bytes);
  const fallback = { ...provider([file]), id: 'fallback' };
  const { result } = await new GenerationRouter().register(provider([])).register(fallback).generate(req);
  expect(result).toMatchObject({ status: 'done', files: [file] });
});

test('router accepts a readable image with its saved path', async () => {
  const file = path.join(dir, 'good.png');
  fs.writeFileSync(file, bytes);
  const { result } = await new GenerationRouter().register(provider([file])).generate(req);
  expect(result).toMatchObject({ status: 'done', files: [file] });
});

test('invalid replacement keeps the previous image bytes intact', () => {
  const file = saveMovieShotImage(req, `data:image/png;base64,${bytes.toString('base64')}`);
  expect(() => saveMovieShotImage(req, 'corrupt!base64')).toThrow();
  expect(fs.readFileSync(file)).toEqual(bytes);
  expect(fs.readdirSync(path.dirname(file))).toEqual(['shot_01.png']);
});

test('rejects an image-folder junction outside the shot without writing there', () => {
  const outside = path.join(dir, 'outside');
  const shot = path.join(dir, 'shot');
  fs.mkdirSync(outside);
  fs.mkdirSync(shot);
  fs.symlinkSync(outside, path.join(shot, 'image'), 'junction');
  expect(() => saveMovieShotImage({ ...req, shotDir: shot }, bytes.toString('base64'))).toThrow(/link/);
  expect(fs.readdirSync(outside)).toEqual([]);
});

test.each(['../escape', 'bad/name', 'bad\\name', 'C:escape', ''])('rejects unsafe shot ID %s', shotId => {
  expect(() => saveMovieShotImage({ ...req, shotId }, bytes.toString('base64'))).toThrow(/shot ID/);
  expect(fs.readdirSync(dir)).toEqual([]);
});

test.each(['IMAGE_GENERATED', 'APPROVED', 'AWAITING_WORKER'])('runner does not count a corrupt %s image as completed', async status => {
  const shotDir = path.join(dir, 'scenes', 'scene_01', req.shotId);
  fs.mkdirSync(path.join(shotDir, 'image'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ projectId: 'fixture', freeOnly: true }));
  fs.writeFileSync(path.join(shotDir, 'prompt.json'), JSON.stringify(req));
  fs.writeFileSync(path.join(shotDir, 'status.json'), JSON.stringify({ status, attempts: 1 }));
  fs.writeFileSync(path.join(shotDir, 'image', 'shot_01.png'), 'bad image');
  const report = await MovieProjectRunner.runProject(dir, { router: new GenerationRouter() });
  expect(report.completedShots).toBe(0);
  expect(report.failedShots).toBe(1);
  expect(JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf8')).status).toBe('FAILED');
});
