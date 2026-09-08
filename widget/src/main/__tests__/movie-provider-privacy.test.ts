import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

const mockGetSettings = jest.fn();
jest.mock('../config-manager', () => ({ getSettings: () => mockGetSettings() }));
jest.mock('../ancient-pathways', () => ({
  resolveAncientPathwaysDir: () => null,
  checkRenderLock: jest.fn(),
  runShowrunner: jest.fn(),
}));
jest.mock('http');
jest.mock('https');

import { generateImagen3, imagen3Provider } from '../movie/imagen3-adapter';
import { generatePollinations, pollinationsProvider } from '../movie/pollinations-adapter';
import { generateComfyUI, getAvailableCheckpoints, isComfyUIReachable, comfyUIProvider } from '../movie/comfyui-adapter';
import { generateLocalSD15, localSD15Provider } from '../movie/local-sd15-adapter';
import { colabProvider } from '../movie/colab-adapter';
import { GenerationRouter } from '../movie/router';
import { MovieProjectRunner } from '../movie/project-runner';
import { mediaProduceMovieHandler } from '../tools/media-movie';
import type { GenerationRequest } from '../movie/types';
import { ShotStatus } from '../movie/types';

const originalFetch = global.fetch;
const mockFetch = jest.fn();
const originalComfyEndpoint = process.env.COMFY_ENDPOINT;
const originalSdEndpoint = process.env.LOCAL_SD_ENDPOINT;
let fixtureDir: string;
let settings: Record<string, unknown>;

const shot = (): GenerationRequest => ({
  kind: 'image', prompt: 'A private draft scene', width: 512, height: 512,
  shotId: 'shot_01', shotDir: path.join(fixtureDir, 'shot_01'),
  freeOnly: true, allowWatermark: true, allowDeferred: true,
});

function noRequests(): void {
  expect(mockFetch).not.toHaveBeenCalled();
  expect(http.request).not.toHaveBeenCalled();
  expect(https.request).not.toHaveBeenCalled();
}

beforeEach(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-movie-privacy-'));
  settings = { useCustomLLM: false, customLLM: { enabled: true }, providerApiKeys: { 'google-ai-studio': 'fixture-key' } };
  mockGetSettings.mockReset().mockImplementation(() => settings);
  mockFetch.mockReset().mockRejectedValue(new Error('Unexpected network request'));
  global.fetch = mockFetch;
  process.env.COMFY_ENDPOINT = 'http://render.example.invalid:8188';
  process.env.LOCAL_SD_ENDPOINT = 'http://render.example.invalid:7860/sdapi/v1/txt2img';
  for (const transport of [http, https]) {
    (transport.request as jest.Mock).mockReset().mockImplementation(() => {
      const request: any = {
        on: jest.fn((event, callback) => {
          if (event === 'error') callback(new Error('Unexpected network request'));
          return request;
        }),
        end: jest.fn(), write: jest.fn(), destroy: jest.fn(),
      };
      return request;
    });
  }
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalComfyEndpoint === undefined) delete process.env.COMFY_ENDPOINT;
  else process.env.COMFY_ENDPOINT = originalComfyEndpoint;
  if (originalSdEndpoint === undefined) delete process.env.LOCAL_SD_ENDPOINT;
  else process.env.LOCAL_SD_ENDPOINT = originalSdEndpoint;
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

test.each([imagen3Provider, pollinationsProvider, comfyUIProvider, localSD15Provider, colabProvider])(
  '$id is rejected during discovery and direct execution when Online is off', async provider => {
    await expect(provider.probe(shot())).rejects.toThrow(/Online/);
    expect(await provider.generate(shot())).toMatchObject({ status: 'failed', error: expect.stringMatching(/Online/) });
    noRequests();
    expect(fs.existsSync(path.join(shot().shotDir, 'ticket.json'))).toBe(false);
  },
);

test.each([
  ['Imagen', () => generateImagen3('private', 512, 512)],
  ['Pollinations', () => generatePollinations('private', 512, 512)],
  ['ComfyUI', () => generateComfyUI('private', 512, 512)],
  ['ComfyUI health', () => isComfyUIReachable()],
  ['ComfyUI checkpoints', () => getAvailableCheckpoints()],
  ['Stable Diffusion', () => generateLocalSD15('private', 512, 512)],
] as const)('%s direct helper cannot bypass online consent', async (_name, invoke) => {
  await expect(invoke()).rejects.toThrow(/Online/);
  noRequests();
});

test.each([undefined, {}, { customLLM: { enabled: false } }])('missing/offline settings fail closed: %j', async value => {
  mockGetSettings.mockReturnValue(value);
  await expect(generatePollinations('private', 512, 512)).rejects.toThrow(/Online/);
  noRequests();
});

test('unreadable settings fail closed without exposing the underlying exception', async () => {
  mockGetSettings.mockImplementation(() => { throw new Error('sensitive config detail'); });
  await expect(generatePollinations('private', 512, 512)).rejects.toThrow(/Online/);
  noRequests();
});

test.each([
  'http://localhost.example.invalid:8188', 'http://127.0.0.1.example.invalid:8188',
  'http://192.168.1.9:8188', 'http://10.0.0.2:8188', 'http://0.0.0.0:8188',
  'http://[::]:8188', 'http://[fc00::1]:8188',
])('a local-looking remote endpoint cannot bypass consent: %s', async endpoint => {
  await expect(isComfyUIReachable(endpoint)).rejects.toThrow(/Online/);
  noRequests();
});

function respondWith(data: unknown, statusCode = 200): any {
  const response: any = {
    statusCode, resume: jest.fn(),
    on: jest.fn((event, callback) => {
      if (event === 'data') callback(Buffer.from(JSON.stringify(data)));
      if (event === 'end') callback();
      return response;
    }),
  };
  return response;
}

test.each([
  ['http://127.0.0.1:8188', '127.0.0.1'], ['http://127.0.0.2:8188', '127.0.0.2'],
  ['http://localhost:8188', '127.0.0.1'], ['http://[::1]:8188', '::1'],
])('an actual loopback destination remains usable with Online off: %s', async (endpoint, hostname) => {
  (http.request as jest.Mock).mockImplementation((_options, callback) => {
    callback(respondWith({}));
    return { on: jest.fn(), end: jest.fn() };
  });
  expect(await isComfyUIReachable(endpoint)).toBe(true);
  expect(http.request).toHaveBeenCalledWith(expect.objectContaining({ hostname, path: '/system_stats' }), expect.any(Function));
  expect(mockGetSettings).not.toHaveBeenCalled();
});

test('an approved HTTPS endpoint uses TLS and the HTTPS port', async () => {
  settings = { useCustomLLM: true };
  (https.request as jest.Mock).mockImplementation((_options, callback) => {
    callback(respondWith({}));
    return { on: jest.fn(), end: jest.fn() };
  });
  expect(await isComfyUIReachable('https://render.example.invalid')).toBe(true);
  expect(https.request).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'https:', port: 443, hostname: 'render.example.invalid' }), expect.any(Function));
  expect(http.request).not.toHaveBeenCalled();
});

test.each(['file:///private', 'http://user:secret@127.0.0.1:8188', 'not-a-url'])(
  'an unsupported endpoint is rejected without dispatch: %s', async endpoint => {
    await expect(isComfyUIReachable(endpoint)).rejects.toThrow('valid HTTP or HTTPS endpoint');
    noRequests();
  },
);

test.each(['/object_info', '/prompt', '/history'])(
  'ComfyUI rechecks consent after %s before the next request', async revokeAfter => {
    settings = { useCustomLLM: true };
    const paths: string[] = [];
    (http.request as jest.Mock).mockImplementation((options, callback) => {
      paths.push(options.path);
      if (options.path.startsWith(revokeAfter)) settings = { useCustomLLM: false };
      const response = options.path.startsWith('/object_info')
        ? { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['fixture']] } } } }
        : options.path === '/prompt'
          ? { prompt_id: 'job' }
          : { job: { outputs: { '9': { images: [{ filename: 'fixture.png' }] } } } };
      callback(respondWith(response));
      return { on: jest.fn(), end: jest.fn(), write: jest.fn() };
    });
    jest.useFakeTimers();
    try {
      const result = generateComfyUI('private fixture', 512, 512);
      const rejected = expect(result).rejects.toThrow(/Online/);
      await jest.advanceTimersByTimeAsync(1500);
      await rejected;
      const expectedCount = revokeAfter === '/object_info' ? 1 : revokeAfter === '/prompt' ? 2 : 3;
      expect(paths).toHaveLength(expectedCount);
      expect(paths.at(-1)).toContain(revokeAfter);
    } finally {
      jest.useRealTimers();
    }
  },
);

test.each([{ useCustomLLM: true }, { customLLM: { enabled: true } }])('allowed current and legacy choices reach the existing cloud adapter: %j', async choice => {
  settings = choice;
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ image: 'a'.repeat(128), mimeType: 'png' }) });
  expect(await generatePollinations('permitted fixture', 512, 512)).toMatchObject({ base64: 'a'.repeat(128), mimeType: 'png' });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('a fallback rechecks Online after an earlier provider fails', async () => {
  settings = { useCustomLLM: true };
  const router = new GenerationRouter().register({
    id: 'local-fixture', kind: 'image',
    probe: async () => ({ canGenerate: true, costMicroUsd: 0, maxWidth: 512, maxHeight: 512,
      maxDurationSec: 0, imageToVideo: false, referenceImages: 'none', watermark: 'none', availability: 'ready', deferred: false }),
    generate: async () => {
      settings = { useCustomLLM: false };
      return { status: 'failed', provider: 'local-fixture', error: 'fixture failure' };
    },
  }).register(pollinationsProvider);
  const { decision, result } = await router.generate(shot());
  expect(decision.chosen?.providerId).toBe('local-fixture');
  expect(decision.fallbacks.map(provider => provider.providerId)).toEqual(['pollinations']);
  expect(result).toMatchObject({ status: 'failed', error: expect.stringMatching(/Online/) });
  noRequests();
});

test('the actual movie tool and standard router persist failure without dispatching remote work', async () => {
  const projectDir = path.join(fixtureDir, 'project');
  MovieProjectRunner.createProject(projectDir, {
    projectId: 'privacy-fixture', name: 'Privacy fixture', createdAt: '2026-09-09', updatedAt: '2026-09-09',
    freeOnly: true, defaultResolution: [512, 512], defaultDurationSec: 4,
  });
  MovieProjectRunner.addScene(projectDir, {
    sceneId: 'scene_01', title: 'One scene', description: '', order: 1, shots: ['shot_01'],
  }, [{
    shotId: 'shot_01', scene: 'scene_01', characters: [], action: 'Private scene',
    camera: { framing: 'wide', lens: '24mm', movement: 'static' }, lighting: 'day', durationSec: 4,
    visualReferences: [], generationMethod: 'still', status: ShotStatus.PLANNED,
  }]);
  const result = await mediaProduceMovieHandler({ projectDir, allowDeferred: true, allowWatermark: true, allowCloud: true, useCustomLLM: true }, { executionId: 'privacy-test' });
  expect(result.success).toBe(false);
  expect(result.result.report).toMatchObject({ completedShots: 0, deferredShots: 0, failedShots: 1 });
  const shotDir = path.join(projectDir, 'scenes', 'scene_01', 'shot_01');
  expect(JSON.parse(fs.readFileSync(path.join(shotDir, 'status.json'), 'utf8'))).toMatchObject({
    status: ShotStatus.FAILED, lastError: expect.stringMatching(/Online/),
  });
  expect(fs.existsSync(path.join(shotDir, 'ticket.json'))).toBe(false);
  noRequests();
});
