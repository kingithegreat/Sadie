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

const handlers: Record<string, Function> = {};

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
const markPublished = (id: string, videoId: string) =>
  handlers['homebot:media:mark-published']({}, id, videoId);

beforeAll(() => { registerIpcHandlers(); });
beforeEach(() => { publishingEnabled = false; seed([APPROVED]); });

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

test('deleting from the panel removes the job', async () => {
  const res = await handlers['homebot:media:delete']({}, 'j1');

  expect(res.ok).toBe(true);
  expect(readBack()).toEqual([]);
});
