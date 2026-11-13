/**
 * PROV-4 — the generated shot-clip request path. Real handlers and the real
 * Veo adapter; settings, the key, the registry and the network are doubles.
 * The live Veo request itself is paid and belongs to the owner; these tests
 * pin the endpoint/body against Google's documented REST shape
 * (https://ai.google.dev/gemini-api/docs/veo, checked 2026-09-22), the
 * per-second cost quote, the confirmation gate, and the Online kill-switch.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
jest.mock('../provider-capability-registry', () => ({
  getMediaCapabilityRegistry: async () => ({
    accounts: [],
    imageModels: [],
    videoModels: [{
      ref: 'google-ai-studio:video:veo-3.1-generate-preview',
      provider: 'google-ai-studio', accountId: 'account:google-ai-studio', accountLabel: 'Google AI Studio',
      modelId: 'veo-3.1-generate-preview', displayName: 'Veo 3.1', kind: 'video',
      costClass: 'paid', costLabel: 'Paid per generated second through your Google API project.',
      watermark: 'invisible', watermarkLabel: 'Google applies SynthID provenance to generated video.',
      source: 'live', usableIn: ['shot-video'], methods: ['predictLongRunning'],
    }],
    refreshedAt: new Date(0).toISOString(),
  }),
}));

import { mediaCreateStoryboardHandler } from '../tools/media-storyboard';
import { generateStoryboardShotClip, prepareStoryboardShotClip, recordPaidShotVideoConfirmation } from '../movie/storyboard-video-providers';
const acceptAnyVideo = { validate: async () => {} };
import { generateVeoVideoShot, probeVeoVideo, veoDurationFor, veoPerSecondMicroUsd, describeVeoVideoError } from '../movie/veo-video-adapter';

jest.setTimeout(15_000);

const originalFetch = globalThis.fetch;
const originalProjects = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
let root: string;

const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
const MP4_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
function mp4Response(): Response {
  return { ok: true, status: 200, arrayBuffer: async () => MP4_BYTES.buffer.slice(MP4_BYTES.byteOffset, MP4_BYTES.byteOffset + MP4_BYTES.byteLength) } as unknown as Response;
}

function scriptFetch(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-clip-test-'));
  process.env.HOMEBOT_MOVIE_PROJECTS_DIR = root;
});
afterAll(() => {
  process.env.HOMEBOT_MOVIE_PROJECTS_DIR = originalProjects;
  globalThis.fetch = originalFetch;
  fs.rmSync(root, { recursive: true, force: true });
});
beforeEach(() => {
  fetchCalls.length = 0;
  mockSettings = { useCustomLLM: true, allowCloud: true };
  mockGeminiKey = 'test-key';
});

async function createProject(projectId: string, durationSec = 5) {
  const res = await mediaCreateStoryboardHandler({
    projectId, title: 'Veo clip test',
    shots: [{ prompt: 'A slow dolly through a lantern-lit alley', durationSec }],
  }, {} as any);
  expect(res.success).toBe(true);
  const metaPath = path.join(root, projectId, 'project.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.videoModelRef = 'google-ai-studio:video:veo-3.1-generate-preview';
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

const OK_OPERATION = { name: 'models/veo-3.1-generate-preview/operations/op-1' };
const DONE_OPERATION = { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/dl' } }] } } };

describe('veo-video-adapter request shape', () => {
  test('endpoint and body follow Google\u2019s documented Veo REST shape', async () => {
    scriptFetch((url) => {
      if (url.includes(':predictLongRunning')) return jsonResponse(OK_OPERATION);
      if (url.endsWith('/operations/op-1')) return jsonResponse(DONE_OPERATION);
      return mp4Response();
    });
    const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-shot-'));
    const result = await generateVeoVideoShot({
      kind: 'video', prompt: 'A slow dolly', modelId: 'veo-3.1-generate-preview',
      width: 1280, height: 720, durationSec: 4, shotId: 'shot_001', shotDir,
      freeOnly: false, allowWatermark: true, allowDeferred: false,
    } as any);

    expect(result.status).toBe('done');
    expect(fetchCalls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning');
    const body = JSON.parse(String(fetchCalls[0]!.init?.body));
    expect(body.instances[0].prompt).toBe('A slow dolly');
    expect(body.parameters.durationSeconds).toBe(4);
    expect(body.parameters.resolution).toBe('720p');
    expect((fetchCalls[0]!.init as any).headers['x-goog-api-key']).toBe('test-key');
    expect(fetchCalls[1]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview/operations/op-1');
    const saved = (result as any).files[0] as string;
    expect(fs.existsSync(saved)).toBe(true);
    expect(path.dirname(saved).endsWith('video')).toBe(true);
  });

  test('image-to-video sends the frame as a base64 instance', async () => {
    const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-frame-'));
    const frame = path.join(frameDir, 'frame.png');
    fs.writeFileSync(frame, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32)]));
    scriptFetch((url) => {
      if (url.includes(':predictLongRunning')) return jsonResponse({ ...OK_OPERATION, name: 'models/veo-3.1-generate-preview/operations/op-2' });
      if (url.endsWith('/operations/op-2')) return jsonResponse(DONE_OPERATION);
      return mp4Response();
    });
    const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-shot-'));
    const result = await generateVeoVideoShot({
      kind: 'video', prompt: 'animate', modelId: 'veo-3.1-generate-preview',
      width: 1280, height: 720, durationSec: 6, initImage: frame,
      shotId: 'shot_002', shotDir, freeOnly: false, allowWatermark: true, allowDeferred: false,
    } as any);
    expect(result.status).toBe('done');
    const body = JSON.parse(String(fetchCalls[0]!.init?.body));
    expect(body.instances[0].image.mimeType).toBe('image/png');
    expect(body.parameters.durationSeconds).toBe(6);
  });
});

describe('the per-second cost model', () => {
  test('prices come from Google\u2019s verified Veo pricing table', () => {
    expect(veoPerSecondMicroUsd('veo-3.1-generate-preview')).toBe(400_000);
    expect(veoPerSecondMicroUsd('veo-3.1-fast-generate-preview')).toBe(100_000);
    expect(veoPerSecondMicroUsd('veo-3.1-lite-generate-preview')).toBe(50_000);
  });
  test('clip duration snaps up to an accepted Veo length and refuses longer shots', () => {
    expect(veoDurationFor(2)).toBe(4);
    expect(veoDurationFor(5)).toBe(6);
    expect(veoDurationFor(8)).toBe(8);
    expect(veoDurationFor(10)).toBeNull();
  });
  test('the probe prices exactly the requested seconds', async () => {
    const cap = await probeVeoVideo({ kind: 'video', durationSec: 6, modelId: 'veo-3.1-generate-preview' } as any);
    expect(cap.costMicroUsd).toBe(2_400_000);
    expect(cap.maxDurationSec).toBe(8);
    expect(cap.imageToVideo).toBe(true);
  });
  test('quota and billing errors are named plainly', () => {
    expect(describeVeoVideoError(429, JSON.stringify({ error: { message: 'Quota exceeded for billing', status: 'RESOURCE_EXHAUSTED' } })))
      .toContain('no Veo quota');
    expect(describeVeoVideoError(401, JSON.stringify({ error: { message: 'API key not valid' } })))
      .toContain('rejected the Gemini API key');
  });
});

describe('the confirmation and privacy gates', () => {
  test('nothing is sent online while Online is off', async () => {
    mockSettings = { useCustomLLM: false, allowCloud: false };
    await expect(probeVeoVideo({ kind: 'video', durationSec: 4 } as any)).rejects.toThrow('Online');
    scriptFetch(() => { throw new Error('no request may run while Online is off'); });
    const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-offline-'));
    const result = await generateVeoVideoShot({
      kind: 'video', prompt: 'x', durationSec: 4, shotId: 'shot_003', shotDir,
      freeOnly: false, allowWatermark: true, allowDeferred: false,
    } as any);
    expect(result.status).toBe('failed');
    expect((result as any).error).toContain('Online');
  });

  test('the clip is refused, and no request made, before paid use is confirmed', async () => {
    await createProject('confirm-gate');
    scriptFetch(() => { throw new Error('no request may leave before confirmation'); });
    const res = await generateStoryboardShotClip({ projectId: 'confirm-gate', shotId: 'shot_001' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Confirm paid use');
    expect(res.error).toContain('$2.40');
    expect(res.error).toContain('per second');
    expect(fetchCalls.length).toBe(0);
  });

  test('after confirmation the real request path runs and the shot records the clip', async () => {
    await createProject('confirmed-path');
    recordPaidShotVideoConfirmation('google-ai-studio:video:veo-3.1-generate-preview');
    scriptFetch((url) => {
      if (url.includes(':predictLongRunning')) return jsonResponse({ ...OK_OPERATION, name: 'models/veo-3.1-generate-preview/operations/op-2' });
      if (url.endsWith('/operations/op-2')) return jsonResponse(DONE_OPERATION);
      return mp4Response();
    });
    const res = await generateStoryboardShotClip({ projectId: 'confirmed-path', shotId: 'shot_001' }, acceptAnyVideo);
    expect(res.ok).toBe(true);
    const statusPath = path.join(root, 'confirmed-path', 'scenes', 'scene_01', 'shot_001', 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    expect(status.status).toBe('VIDEO_GENERATED');
    expect(status.clipDurationSec).toBe(6);
    expect(status.clipCostUsd).toBeCloseTo(2.4, 5);
    expect(status.videoModelRef).toBe('google-ai-studio:video:veo-3.1-generate-preview');
  });

  test('the quote the confirm dialog shows carries price, duration and confirmed state', async () => {
    await createProject('quote-check');
    const before = await prepareStoryboardShotClip({ projectId: 'quote-check', shotId: 'shot_001' });
    expect(before.ok).toBe(true);
    if (before.ok) {
      expect(before.quote.clipDurationSec).toBe(6);
      expect(before.quote.pricePerSecondUsd).toBe(0.4);
      expect(before.quote.estimatedUsd).toBe(2.4);
      expect(before.confirmed).toBe(false);
    }
    recordPaidShotVideoConfirmation('google-ai-studio:video:veo-3.1-generate-preview');
    const after = await prepareStoryboardShotClip({ projectId: 'quote-check', shotId: 'shot_001' });
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.confirmed).toBe(true);
  });

  test('a shot longer than Veo\u2019s maximum refuses with the numbers', async () => {
    await createProject('too-long', 12);
    const res = await generateStoryboardShotClip({ projectId: 'too-long', shotId: 'shot_001' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('12 seconds');
    expect(res.error).toContain('8');
  });
});
