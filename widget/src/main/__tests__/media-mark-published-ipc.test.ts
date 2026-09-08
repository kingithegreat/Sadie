/**
 * The panel's route to `published` must record the platform's id — and must
 * not be a way around the publishing kill switch.
 *
 * `markPublished` existed, was exported, and was covered by media-studio.test.ts
 * in detail. It also had zero production callers. The only route a user could
 * reach was `homebot:media:advance(id, 'published')` — a plain transition that
 * set the state, set no id, and sent nothing anywhere. So the app could show a
 * video as published that had never been uploaded, and the double-publish guard
 * (which keys on `videoId`) could never fire, because no id was ever written.
 *
 * A new channel into a publishing state is exactly where a kill switch gets
 * bypassed by accident, so the fail-closed case is pinned first and hardest:
 * a caller that never heard of the switch must not be able to publish.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-mediapub-'));
const JOBS = path.join(userData, 'media-jobs.json');
const ASSETS_ROOT = path.join(userData, 'media-assets');
const JOB_ASSETS = path.join(ASSETS_ROOT, 'j1');
const ASSET = path.join(JOB_ASSETS, 'frame.png');

const handlers: Record<string, Function> = {};
const mockMainFrame = {};
const mockMainSender = { mainFrame: mockMainFrame, send: jest.fn() };
const mockMainWindow = {
  isDestroyed: jest.fn(() => false),
  webContents: mockMainSender,
};
const mockRequestConfirmationFrom = jest.fn<Promise<boolean>, any[]>();

jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Function) => { handlers[channel] = fn; },
    on: jest.fn(),
  },
  BrowserWindow: Object.assign(jest.fn(), { getAllWindows: () => [] }),
  app: { isPackaged: false, getPath: () => userData, getAppPath: () => userData },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
}));

jest.mock('../window-manager', () => ({
  getMainWindow: () => mockMainWindow,
  toggleWidgetMode: jest.fn(),
  getWidgetMode: jest.fn(() => false),
}));

jest.mock('../message-router', () => ({
  ...jest.requireActual('../message-router'),
  requestConfirmationFrom: (...args: any[]) => mockRequestConfirmationFrom(...args),
}));

/** The kill switch, driven per-test. Everything else stays real. */
let publishingEnabled = false;
jest.mock('../config-manager', () => ({
  ...jest.requireActual('../config-manager'),
  getSettings: () => ({
    ...jest.requireActual('../config-manager').getSettings(),
    mediaPublishingEnabled: publishingEnabled,
  }),
}));

import { registerIpcHandlers } from '../ipc-handlers';
import { bundledModuleHost } from '../modules/bundled';
import { STUDIO_MODULE_ID } from '../modules/bundled/studio';
import { getAllToolDefinitions, getToolOwner } from '../tools/registry';

const APPROVED = {
  id: 'j1',
  title: 'Recap: Why Attention Matters',
  format: 'short',
  state: 'approved',
  createdAt: '2026-08-18T00:00:00Z',
  updatedAt: '2026-08-18T00:00:00Z',
  history: [],
};

const seed = (jobs: any[]) => fs.writeFileSync(JOBS, JSON.stringify(jobs), 'utf8');
const readBack = () => JSON.parse(fs.readFileSync(JOBS, 'utf8'));
const diskSnapshot = () => fs.readFileSync(JOBS, 'utf8');
const trustedEvent = () => ({ sender: mockMainSender, senderFrame: mockMainFrame });
const markPublished = (id: string, videoId: string) =>
  handlers['homebot:media:mark-published'](trustedEvent(), id, videoId);
const studioToolNames = () => getAllToolDefinitions()
  .filter(definition => getToolOwner(definition.name)?.moduleId === STUDIO_MODULE_ID)
  .map(definition => definition.name)
  .sort();
const seedAsset = () => {
  fs.mkdirSync(JOB_ASSETS, { recursive: true });
  fs.writeFileSync(ASSET, 'real image bytes', 'utf8');
};
const ensureStudioEnabled = () => {
  const studio = bundledModuleHost.list().find(item => item.manifest.id === STUDIO_MODULE_ID);
  if (studio?.state !== 'enabled') bundledModuleHost.enable(STUDIO_MODULE_ID);
};

beforeAll(() => { registerIpcHandlers(); });
beforeEach(() => {
  ensureStudioEnabled();
  publishingEnabled = false;
  mockRequestConfirmationFrom.mockReset();
  fs.rmSync(ASSETS_ROOT, { recursive: true, force: true });
  seed([APPROVED]);
});
afterEach(() => { ensureStudioEnabled(); });

test('the channel exists — the panel has something to call', () => {
  expect(typeof handlers['homebot:media:mark-published']).toBe('function');
  expect(typeof handlers['homebot:media:delete']).toBe('function');
});

test('fail-closed: publishing off refuses, and writes nothing', async () => {
  const res = await markPublished('j1', 'https://youtu.be/abc123');

  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/switched off/i);
  // The refusal has to be a refusal on disk too, not just in the reply.
  expect(readBack()[0].state).toBe('approved');
  expect(readBack()[0].videoId).toBeUndefined();
});

test('with publishing on, the id is recorded and the state moves', async () => {
  publishingEnabled = true;
  const res = await markPublished('j1', 'https://youtu.be/abc123');

  expect(res.ok).toBe(true);
  const saved = readBack()[0];
  expect(saved.state).toBe('published');
  expect(saved.videoId).toBe('https://youtu.be/abc123');
  // publishedAt is what separates "went out" from "state says published".
  expect(saved.publishedAt).toBeTruthy();
});

test('an empty id is refused — a published job without one is the bug', async () => {
  publishingEnabled = true;
  const res = await markPublished('j1', '   ');

  expect(res.ok).toBe(false);
  expect(readBack()[0].state).toBe('approved');
});

test('publishing twice is refused rather than overwriting the live id', async () => {
  publishingEnabled = true;
  await markPublished('j1', 'https://youtu.be/first');
  const second = await markPublished('j1', 'https://youtu.be/second');

  expect(second.ok).toBe(false);
  expect(second.error).toMatch(/already published/i);
  // The id of the copy actually online must survive the retry.
  expect(readBack()[0].videoId).toBe('https://youtu.be/first');
});

test('a job that has gone missing reports that, rather than throwing', async () => {
  publishingEnabled = true;
  const res = await markPublished('nope', 'https://youtu.be/abc123');

  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/no longer in the list/i);
});

test('a different renderer sender is denied before it can change the real store', async () => {
  publishingEnabled = true;
  const before = diskSnapshot();
  const foreignFrame = {};
  const foreignSender = { mainFrame: foreignFrame, send: jest.fn() };

  const res = await handlers['homebot:media:mark-published'](
    { sender: foreignSender, senderFrame: foreignFrame },
    'j1',
    'https://youtu.be/untrusted',
  );

  expect(res).toMatchObject({ ok: false, code: 'INVALID_SENDER' });
  expect(diskSnapshot()).toBe(before);
});

test('a subframe in the real window is denied before it can change the real store', async () => {
  publishingEnabled = true;
  const before = diskSnapshot();

  const res = await handlers['homebot:media:mark-published'](
    { sender: mockMainSender, senderFrame: {} },
    'j1',
    'https://youtu.be/subframe',
  );

  expect(res).toMatchObject({ ok: false, code: 'INVALID_SENDER' });
  expect(diskSnapshot()).toBe(before);
});

test('an invalid legacy IPC payload is denied before it can change the real store', async () => {
  publishingEnabled = true;
  const before = diskSnapshot();

  const res = await handlers['homebot:media:mark-published'](
    trustedEvent(),
    'j1',
    { unexpected: 'object' },
  );

  expect(res).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  expect(diskSnapshot()).toBe(before);
});

test('deleting from the panel removes the job and its files after one-use consent', async () => {
  seedAsset();
  mockRequestConfirmationFrom.mockResolvedValueOnce(true);

  const res = await handlers['homebot:media:delete'](trustedEvent(), 'j1');

  expect(res.ok).toBe(true);
  expect(readBack()).toEqual([]);
  expect(fs.existsSync(JOB_ASSETS)).toBe(false);
  expect(mockRequestConfirmationFrom).toHaveBeenCalledWith(
    mockMainSender,
    expect.stringMatching(/allow this studio action once/i),
  );
});

test('cancelling deletion leaves both the job and its files unchanged', async () => {
  seedAsset();
  const before = diskSnapshot();
  mockRequestConfirmationFrom.mockResolvedValueOnce(false);

  const res = await handlers['homebot:media:delete'](trustedEvent(), 'j1');

  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/cancelled/i);
  expect(diskSnapshot()).toBe(before);
  expect(fs.readFileSync(ASSET, 'utf8')).toBe('real image bytes');
  expect(mockRequestConfirmationFrom).toHaveBeenCalledTimes(1);
});

test('a captured legacy channel stays inert while Studio is disabled and re-enable restores one tool set', async () => {
  publishingEnabled = true;
  const legacyHandler = handlers['homebot:media:mark-published'];
  const beforeDisk = diskSnapshot();
  const beforeTools = studioToolNames();
  const declaredCount = bundledModuleHost.list()
    .find(item => item.manifest.id === STUDIO_MODULE_ID)!
    .manifest.contributions.commands.length;
  expect(beforeTools).toHaveLength(declaredCount);

  await bundledModuleHost.disable(STUDIO_MODULE_ID);
  try {
    expect(studioToolNames()).toEqual([]);
    const res = await legacyHandler(trustedEvent(), 'j1', 'https://youtu.be/disabled');
    expect(res).toMatchObject({ ok: false, code: 'MODULE_UNAVAILABLE' });
    expect(diskSnapshot()).toBe(beforeDisk);
  } finally {
    bundledModuleHost.enable(STUDIO_MODULE_ID);
  }

  const restoredTools = studioToolNames();
  expect(restoredTools).toEqual(beforeTools);
  expect(restoredTools).toHaveLength(declaredCount);
  expect(new Set(restoredTools).size).toBe(restoredTools.length);
});

test('storyboard breakdown retains the complete legacy result through Core tool dispatch', async () => {
  const previous = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
  const projects = path.join(userData, 'storyboards');
  fs.mkdirSync(projects, { recursive: true });
  process.env.HOMEBOT_MOVIE_PROJECTS_DIR = projects;
  try {
    const result = await handlers['homebot:media:storyboard:breakdown'](trustedEvent(), {
      script: 'An explorer opens the temple door. The carved map reveals a hidden passage. She follows it into the dawn.',
      title: 'Legacy shot fields', projectId: 'legacy-shots', shotCount: 3, autoGenerateFrames: false,
    });
    expect(result.ok).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['ok', 'projectId', 'title', 'genre', 'shots', 'totalDurationSec', 'projectDir'].sort());
    expect(result.shots).toHaveLength(3);
    expect(result.shots[0]).toMatchObject({
      order: expect.any(Number), title: expect.any(String), characters: expect.any(Array), beatType: 'establishing',
      shotId: expect.any(String), prompt: expect.any(String), narration: expect.any(String),
    });
    expect(result.projectId).toMatch(/^legacy-shots-/);
    expect(result.projectDir).toBe(path.join(projects, result.projectId));
    expect(fs.existsSync(path.join(result.projectDir, 'project.json'))).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
    else process.env.HOMEBOT_MOVIE_PROJECTS_DIR = previous;
  }
});
