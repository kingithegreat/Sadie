import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { AddressInfo } from 'net';

// Contract tests for the explicit Storyboard frame provider choice. Real
// handlers and adapters; settings, the Gemini key and the decoder are doubles.
jest.mock('electron', () => ({
  app: { getAppPath: () => 'fake-app-root', getPath: () => require('os').tmpdir() },
  nativeImage: require('./helpers/movie-image').movieNativeImageStub,
}));
let mockSettings: Record<string, any> = {};
jest.mock('../config-manager', () => ({
  getSettings: () => mockSettings,
  saveSettings: (next: Record<string, any>) => { mockSettings = next; },
}));
let mockGeminiKey = '';
jest.mock('../../shared/cloud-llm', () => ({
  ...jest.requireActual('../../shared/cloud-llm'),
  apiKeyForProvider: (_s: unknown, provider: string) => (provider === 'google-ai-studio' ? mockGeminiKey : ''),
}));

import { movieImageFixture } from './helpers/movie-image';
import {
  mediaCreateStoryboardHandler,
  mediaGenerateStoryboardFrameHandler,
  mediaGetStoryboardHandler,
  setStoryboardFrameProvider,
} from '../tools/media-storyboard';
import { describeStoryboardFrameProviders, recordPaidFrameConfirmation } from '../movie/storyboard-frame-providers';
import { STORYBOARD_FRAME_PROVIDERS } from '../../shared/storyboard-frame-providers';
import { createStudioOutputSpec } from '../../shared/media-output';

// These are real-handler tests that render frames through a loopback ComfyUI
// server; the 3-frame auto-generation test takes ~4.6s alone, so the Jest
// 5000ms default is too tight under a loaded runner (it has flaked as a timeout).
jest.setTimeout(15_000);

const ctx = { executionId: 'frame-provider-test' };
const originalFetch = globalThis.fetch;
const originalProjects = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
const originalComfy = process.env.COMFY_ENDPOINT;
let root: string;
let fetchMock: jest.Mock;
let comfyPrompts: string[];
let comfySizes: Array<{ width: number; height: number }>;
let comfy: http.Server;

beforeAll(async () => {
  // Loopback ComfyUI API: records every prompt it is asked to render.
  comfy = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const json = (body: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/system_stats') return json({});
    if (url.pathname.startsWith('/object_info')) return json({});
    if (url.pathname === '/prompt') {
      let raw = ''; req.on('data', c => (raw += c));
      req.on('end', () => { const body = JSON.parse(raw); comfyPrompts.push(body.prompt['6'].inputs.text); comfySizes.push({ width: body.prompt['5'].inputs.width, height: body.prompt['5'].inputs.height }); json({ prompt_id: `p${comfyPrompts.length}` }); });
      return;
    }
    if (url.pathname.startsWith('/history/')) {
      const id = decodeURIComponent(url.pathname.slice('/history/'.length));
      return json({ [id]: { outputs: { 9: { images: [{ filename: 'f.png', subfolder: '', type: 'output' }] } } } });
    }
    if (url.pathname === '/view') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(movieImageFixture); }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => comfy.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => { await new Promise<void>(resolve => comfy.close(() => resolve())); });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-frame-provider-'));
  process.env.HOMEBOT_MOVIE_PROJECTS_DIR = root;
  process.env.COMFY_ENDPOINT = `http://127.0.0.1:${(comfy.address() as AddressInfo).port}`;
  mockSettings = { useCustomLLM: false };
  mockGeminiKey = '';
  comfyPrompts = [];
  comfySizes = [];
  fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ predictions: [{ bytesBase64Encoded: movieImageFixture.toString('base64'), mimeType: 'image/png' }] }) }));
  globalThis.fetch = fetchMock as any;
  const created = await mediaCreateStoryboardHandler({ projectId: 'harbour', title: 'Harbour', shots: [{ prompt: 'Old harbour at dawn', durationSec: 4 }] }, ctx);
  expect(created.success).toBe(true);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.HOMEBOT_MOVIE_PROJECTS_DIR = originalProjects;
  if (originalComfy === undefined) delete process.env.COMFY_ENDPOINT; else process.env.COMFY_ENDPOINT = originalComfy;
  fs.rmSync(root, { recursive: true, force: true });
});

const generate = () => mediaGenerateStoryboardFrameHandler({ projectId: 'harbour', shotId: 'shot_001' }, ctx);
const shotStatus = () => JSON.parse(fs.readFileSync(path.join(root, 'harbour', 'scenes', 'scene_01', 'shot_001', 'status.json'), 'utf8'));

test('the picker never offers Ancient Pathways or local SD 1.5 for still frames', () => {
  // Imagen was removed when Google retired it (10 November 2025).
  expect(STORYBOARD_FRAME_PROVIDERS.map(o => o.routerProviderId).sort()).toEqual(['comfyui', 'pollinations']);
  expect(STORYBOARD_FRAME_PROVIDERS.some(o => o.paid)).toBe(false);
  expect(STORYBOARD_FRAME_PROVIDERS.find(o => o.id === 'online')?.label).toMatch(/may add a watermark/);
});

test('a new storyboard has no provider; generating asks for a choice and contacts nothing', async () => {
  const res = await generate();
  expect(res.success).toBe(false);
  expect(res.error).toMatch(/Choose how this storyboard makes frame images/);
  expect(comfyPrompts).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('the choice persists per project and unknown providers are refused', async () => {
  expect((await setStoryboardFrameProvider({ projectId: 'harbour', frameProvider: 'this-pc' })).success).toBe(true);
  const got = await mediaGetStoryboardHandler({ projectId: 'harbour' }, ctx);
  expect((got.result as any).project.frameProvider).toBe('this-pc');
  for (const bad of ['ancient-pathways', 'pollinations', '', 42]) {
    expect((await setStoryboardFrameProvider({ projectId: 'harbour', frameProvider: bad })).success).toBe(false);
  }
  expect(JSON.parse(fs.readFileSync(path.join(root, 'harbour', 'project.json'), 'utf8')).frameProvider).toBe('this-pc');
});

test('the frame is drawn in the shape the project exports, not always 16:9', async () => {
  // A 16:9 frame in a 9:16 export loses the middle 32% of every shot.
  await setStoryboardFrameProvider({ projectId: 'harbour', frameProvider: 'this-pc' });
  const metaPath = path.join(root, 'harbour', 'project.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  fs.writeFileSync(metaPath, JSON.stringify({
    ...meta,
    outputSpec: createStudioOutputSpec('9:16'),
  }));

  const res = await generate();
  expect(res.success).toBe(true);
  expect(comfySizes).toEqual([{ width: 576, height: 1024 }]);
  expect((res.result as any).frameSize).toMatchObject({ width: 576, height: 1024, aspectRatio: '9:16' });
});

test('a landscape project still gets 16:9 frames, and both shapes say which one crops', async () => {
  await setStoryboardFrameProvider({ projectId: 'harbour', frameProvider: 'this-pc' });
  const metaPath = path.join(root, 'harbour', 'project.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  fs.writeFileSync(metaPath, JSON.stringify({
    ...meta,
    outputSpec: { ...createStudioOutputSpec('16:9'),
      variants: [...createStudioOutputSpec('16:9').variants, ...createStudioOutputSpec('9:16').variants] },
  }));

  const res = await generate();
  expect(res.success).toBe(true);
  expect(comfySizes).toEqual([{ width: 1024, height: 576 }]);
  expect((res.result as any).message).toMatch(/also exports 9:16, which crops from this frame/);
});

test('the chosen provider alone makes the frame, and attempts count up on regenerate', async () => {
  await setStoryboardFrameProvider({ projectId: 'harbour', frameProvider: 'this-pc' });
  const first = await generate();
  expect(first.success).toBe(true);
  expect((first.result as any).provider).toBe('comfyui');
  expect(comfyPrompts).toEqual(['Old harbour at dawn']);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(shotStatus()).toMatchObject({ provider: 'comfyui', frameProvider: 'this-pc', attempts: 1 });
  expect((await generate()).success).toBe(true);
  expect(shotStatus().attempts).toBe(2);
});

test('an Online choice with Online off fails honestly and does not fall back to this PC', async () => {
  await setStoryboardFrameProvider({ projectId: 'harbour', frameProvider: 'online' });
  const res = await generate();
  expect(res.success).toBe(false);
  expect(res.error).toMatch(/Online/);
  expect(comfyPrompts).toEqual([]); // ComfyUI is reachable, and still not used
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a project that saved Imagen before it was retired is asked to choose again, and nothing is contacted', async () => {
  mockSettings = { useCustomLLM: true };
  mockGeminiKey = 'AIza-test-key';
  const metaPath = path.join(root, 'harbour', 'project.json');
  fs.writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(metaPath, 'utf8')), frameProvider: 'imagen' }));
  const res = await generate();
  expect(res.success).toBe(false);
  expect(res.error).toMatch(/Choose how this storyboard makes frame images/);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(comfyPrompts).toEqual([]);
  expect((await setStoryboardFrameProvider({ projectId: 'harbour', frameProvider: 'imagen' })).success).toBe(false);
});

test('no current option can record a paid confirmation', () => {
  for (const id of ['imagen', 'online', 'this-pc', 'ancient-pathways']) {
    expect(recordPaidFrameConfirmation(id).ok).toBe(false);
  }
  expect(mockSettings.paidFrameConfirmations).toBeUndefined();
});

test('status checks say what each option needs, without generating anything', async () => {
  let status = Object.fromEntries((await describeStoryboardFrameProviders()).map(s => [s.id, s]));
  expect(status.online).toMatchObject({ ready: false, needs: 'online' });
  expect(status['this-pc']).toMatchObject({ ready: true, needs: null });
  expect(Object.keys(status).sort()).toEqual(['online', 'this-pc']);
  mockSettings = { useCustomLLM: true };
  mockGeminiKey = 'AIza-test-key';
  status = Object.fromEntries((await describeStoryboardFrameProviders()).map(s => [s.id, s]));
  expect(status.online).toMatchObject({ ready: true });
  expect(comfyPrompts).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

describe('Auto-Director frames follow the same choice', () => {
  const direct = async (extra: Record<string, unknown>) => {
    const { directScriptToStoryboard } = await import('../movie/script-director');
    return directScriptToStoryboard({ script: 'A keeper lights the lamp. A storm rolls in. The boats come home.', shotCount: 3, projectId: 'directed', ...extra });
  };

  test('asked to auto-generate with no provider, it makes no frames, says why, and contacts nothing', async () => {
    const res = await direct({ autoGenerateFrames: true });
    expect(res.ok).toBe(true);
    expect(res.framesGenerated).toBe(0);
    expect(res.framesSkipped).toMatch(/Choose how this storyboard makes frame images/);
    expect(comfyPrompts).toEqual([]); // ComfyUI is reachable and still not used
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('with a chosen provider it saves the choice and makes every frame through it alone', async () => {
    const res = await direct({ autoGenerateFrames: true, frameProvider: 'this-pc' });
    expect(res).toMatchObject({ ok: true, framesGenerated: 3 });
    expect(res.framesSkipped).toBeUndefined();
    expect(comfyPrompts).toHaveLength(3);
    expect(JSON.parse(fs.readFileSync(path.join(res.projectDir!, 'project.json'), 'utf8')).frameProvider).toBe('this-pc');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a retired provider named from chat is not saved and makes no frames', async () => {
    mockSettings = { useCustomLLM: true };
    mockGeminiKey = 'AIza-test-key';
    const res = await direct({ autoGenerateFrames: true, frameProvider: 'imagen' });
    expect(res.framesGenerated).toBe(0);
    expect(res.framesSkipped).toMatch(/Choose how this storyboard makes frame images/);
    expect(JSON.parse(fs.readFileSync(path.join(res.projectDir!, 'project.json'), 'utf8')).frameProvider).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(comfyPrompts).toEqual([]);
  });
});
