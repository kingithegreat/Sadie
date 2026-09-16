import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// A stand-in Codex CLI: a real executable HomeBot spawns, which records what it
// was given and then behaves like the real one (events on stdout, image written
// under CODEX_HOME/generated_images). The real CLI cannot run in CI.
jest.mock('electron', () => ({
  app: { getAppPath: () => 'fake-app-root', getPath: () => require('os').tmpdir() },
  nativeImage: require('./helpers/movie-image').movieNativeImageStub,
}));
let mockSettings: Record<string, any> = {};
jest.mock('../config-manager', () => ({
  getSettings: () => mockSettings,
  saveSettings: (next: Record<string, any>) => { mockSettings = next; },
}));

import { movieImageFixture } from './helpers/movie-image';
import { mediaCreateStoryboardHandler, mediaGenerateStoryboardFrameHandler, setStoryboardFrameProvider } from '../tools/media-storyboard';
import { describeStoryboardFrameProviders } from '../movie/storyboard-frame-providers';
import { CODEX_NOT_INSTALLED, CODEX_SIGNED_OUT, codexImagePrompt, describeCodexFailure } from '../movie/codex-image-adapter';
import { STORYBOARD_FRAME_PROVIDERS } from '../../shared/storyboard-frame-providers';

jest.setTimeout(60_000);
const ctx = { executionId: 'codex-image-test' };
const saved = { projects: process.env.HOMEBOT_MOVIE_PROJECTS_DIR, bin: process.env.HOMEBOT_CODEX_BIN, home: process.env.CODEX_HOME, mode: process.env.FAKE_CODEX_MODE };
let root: string;
let codexHome: string;
let record: string;

const FAKE = `
const fs = require('fs'); const path = require('path');
let stdin = ''; process.stdin.on('data', d => stdin += d); process.stdin.on('end', () => {
  fs.writeFileSync(process.env.FAKE_CODEX_RECORD, JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }));
  const say = e => process.stdout.write(JSON.stringify(e) + '\\n');
  say({ type: 'thread.started' });
  say({ type: 'item.completed', item: { type: 'error', message: 'Skill descriptions were shortened to fit the skills context budget.' } });
  const mode = process.env.FAKE_CODEX_MODE;
  if (mode === 'image') {
    const dir = path.join(process.env.CODEX_HOME, 'generated_images', 'session-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ig_1.png'), Buffer.from(process.env.FAKE_CODEX_PNG, 'base64'));
    say({ type: 'turn.completed' });
  } else if (mode === 'limit') {
    const m = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 19th, 2026 10:59 PM.";
    say({ type: 'error', message: m }); say({ type: 'turn.failed', error: { message: m } }); process.exitCode = 1;
  } else { say({ type: 'turn.completed' }); }
});`;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-codex-image-'));
  codexHome = path.join(root, 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'auth.json'), '{}');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'fake-codex.js'), FAKE);
  const launcher = process.platform === 'win32' ? path.join(bin, 'codex.cmd') : path.join(bin, 'codex');
  fs.writeFileSync(launcher, process.platform === 'win32' ? '@node "%~dp0fake-codex.js" %*\r\n' : `#!/bin/sh\nexec node "${path.join(bin, 'fake-codex.js')}" "$@"\n`);
  if (process.platform !== 'win32') fs.chmodSync(launcher, 0o755);
  record = path.join(root, 'record.json');
  Object.assign(process.env, {
    HOMEBOT_MOVIE_PROJECTS_DIR: path.join(root, 'projects'), HOMEBOT_CODEX_BIN: launcher, CODEX_HOME: codexHome,
    FAKE_CODEX_RECORD: record, FAKE_CODEX_PNG: movieImageFixture.toString('base64'), FAKE_CODEX_MODE: 'image',
  });
  mockSettings = { useCustomLLM: true };
  const created = await mediaCreateStoryboardHandler({ projectId: 'harbour', title: 'Harbour', shots: [{ prompt: 'Old harbour at dawn & boats | "quoted"', durationSec: 4 }] }, ctx);
  expect(created.success).toBe(true);
  expect((await setStoryboardFrameProvider({ projectId: 'harbour', frameProvider: 'chatgpt-plan' })).success).toBe(true);
});

afterEach(() => {
  for (const [key, value] of Object.entries({ HOMEBOT_MOVIE_PROJECTS_DIR: saved.projects, HOMEBOT_CODEX_BIN: saved.bin, CODEX_HOME: saved.home, FAKE_CODEX_MODE: saved.mode })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const generate = () => mediaGenerateStoryboardFrameHandler({ projectId: 'harbour', shotId: 'shot_001' }, ctx);
const status = async () => Object.fromEntries((await describeStoryboardFrameProviders()).map(s => [s.id, s]));

test('the ChatGPT plan option is offered as no per-image charge, and never as paid', () => {
  const option = STORYBOARD_FRAME_PROVIDERS.find(o => o.id === 'chatgpt-plan')!;
  expect(option).toMatchObject({ routerProviderId: 'codex-image', paid: false });
  expect(option.label).toMatch(/uses your plan limits, no per-image charge/);
});

test('a frame is made through the signed-in Codex CLI, with the prompt on stdin and never on the command line', async () => {
  expect((await status())['chatgpt-plan']).toMatchObject({ ready: true, needs: null });
  const res = await generate();
  expect(res.success).toBe(true);
  const frame = (res.result as any).frameImagePath as string;
  expect(fs.readFileSync(frame).equals(movieImageFixture)).toBe(true);
  expect((res.result as any).provider).toBe('codex-image');

  const seen = JSON.parse(fs.readFileSync(record, 'utf8'));
  expect(seen.argv).toEqual(['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-']);
  expect(seen.argv.join(' ')).not.toContain('harbour');
  expect(seen.stdin).toContain('Old harbour at dawn & boats | "quoted"');
  expect(seen.stdin).toContain('wide landscape (16:9');
  expect(fs.existsSync(seen.cwd)).toBe(false); // the scratch folder is removed afterwards
});

test('a used-up plan limit says so plainly, with the time Codex gave', async () => {
  process.env.FAKE_CODEX_MODE = 'limit';
  const res = await generate();
  expect(res.success).toBe(false);
  expect(res.error).toMatch(/ChatGPT plan's Codex limit is used up until Sep 19th, 2026 10:59 PM/);
});

test('a turn that makes no image is a failure, not a silent success', async () => {
  process.env.FAKE_CODEX_MODE = 'nothing';
  const res = await generate();
  expect(res.success).toBe(false);
  expect(res.error).toMatch(/without making an image/);
});

test('status says what is missing: Online, the CLI, or the sign-in', async () => {
  mockSettings = { useCustomLLM: false };
  expect((await status())['chatgpt-plan']).toMatchObject({ ready: false, needs: 'online' });
  mockSettings = { useCustomLLM: true };
  fs.rmSync(path.join(codexHome, 'auth.json'));
  expect((await status())['chatgpt-plan']).toMatchObject({ ready: false, needs: 'codex', reason: CODEX_SIGNED_OUT });
  process.env.HOMEBOT_CODEX_BIN = path.join(root, 'bin', 'missing-codex.cmd');
  expect((await status())['chatgpt-plan']).toMatchObject({ ready: false, needs: 'codex', reason: CODEX_NOT_INSTALLED });
});

test('prompt shaping and failure wording', () => {
  expect(codexImagePrompt('a  tall\ntower', 576, 1024)).toContain('tall portrait (9:16, 576x1024)');
  expect(describeCodexFailure(['Skill descriptions were shortened to fit the skills context budget.'])).toBeNull();
  expect(describeCodexFailure(['401 Unauthorized'])).toBe(CODEX_SIGNED_OUT);
});
