/**
 * workspace-ipc.test.ts — Explorer + editor filesystem surface.
 *
 * The load-bearing assertions are the sandbox ones: this surface is reachable
 * from the renderer, so a path-escape here is a real security boundary, not a
 * UX detail. It shares validatePath with the LLM-facing filesystem tools
 * precisely so the two cannot drift apart.
 */

jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: any) => { (global as any).__handlers.set(channel, fn); },
    removeHandler: (channel: string) => { (global as any).__handlers.delete(channel); },
  },
  app: { getPath: () => '/mock' },
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerWorkspaceIpc, WORKSPACE_CHANNELS, languageForPath } from '../workspace-ipc';

(global as any).__handlers = new Map<string, any>();
const invoke = (channel: string, ...args: unknown[]) => (global as any).__handlers.get(channel)({}, ...args);

const HOME = os.homedir();
let tmpDir: string;

beforeAll(() => {
  // Inside HOME so it is inside the sandbox, like a real project folder.
  tmpDir = fs.mkdtempSync(path.join(HOME, 'hb-ws-test-'));
  fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'export const x = 1;\n', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'notes.md'), '# hi\n', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'binary.bin'), Buffer.from([0x41, 0x00, 0x42]));
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.mkdirSync(path.join(tmpDir, 'node_modules'));
  fs.writeFileSync(path.join(tmpDir, 'node_modules', 'junk.js'), 'x', 'utf8');
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

beforeEach(() => { (global as any).__handlers.clear(); registerWorkspaceIpc(() => tmpDir); });

describe('sandbox', () => {
  test.each([
    ['C:\\Windows\\System32'],
    ['/etc'],
    ['C:\\Windows\\..\\Windows\\System32'],
  ])('refuses to list outside the home directory: %s', async (bad) => {
    const r = await invoke(WORKSPACE_CHANNELS.LIST, bad);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/home directory/i);
  });

  test('refuses to read outside the home directory', async () => {
    const r = await invoke(WORKSPACE_CHANNELS.READ, 'C:\\Windows\\System32\\drivers\\etc\\hosts');
    expect(r.success).toBe(false);
  });

  test('refuses to save outside the home directory', async () => {
    const r = await invoke(WORKSPACE_CHANNELS.SAVE, 'C:\\Windows\\pwned.txt', 'x');
    expect(r.success).toBe(false);
    expect(fs.existsSync('C:\\Windows\\pwned.txt')).toBe(false);
  });

  test('traversal out of an allowed root is refused', async () => {
    const escape = path.join(tmpDir, '..', '..', '..', '..', 'Windows');
    const r = await invoke(WORKSPACE_CHANNELS.LIST, escape);
    expect(r.success).toBe(false);
  });
});

describe('listing', () => {
  test('lists entries with folders first, then alphabetical', async () => {
    const r = await invoke(WORKSPACE_CHANNELS.LIST, tmpDir);
    expect(r.success).toBe(true);
    const names = r.entries.map((e: any) => e.name);
    expect(names[0]).toBe('src');            // only surviving directory
    expect(names).toEqual(['src', 'binary.bin', 'hello.ts', 'notes.md']);
  });

  test('skips node_modules so the tree stays usable', async () => {
    const r = await invoke(WORKSPACE_CHANNELS.LIST, tmpDir);
    expect(r.entries.map((e: any) => e.name)).not.toContain('node_modules');
  });

  test('a missing directory fails cleanly instead of throwing', async () => {
    const r = await invoke(WORKSPACE_CHANNELS.LIST, path.join(tmpDir, 'nope'));
    expect(r.success).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});

describe('read', () => {
  test('reads a text file and detects its language', async () => {
    const r = await invoke(WORKSPACE_CHANNELS.READ, path.join(tmpDir, 'hello.ts'));
    expect(r.success).toBe(true);
    expect(r.content).toContain('export const x');
    expect(r.language).toBe('typescript');
  });

  test('refuses a binary file rather than filling the editor with NULs', async () => {
    const r = await invoke(WORKSPACE_CHANNELS.READ, path.join(tmpDir, 'binary.bin'));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/binary/i);
  });

  test('refuses a directory', async () => {
    const r = await invoke(WORKSPACE_CHANNELS.READ, path.join(tmpDir, 'src'));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/folder/i);
  });
});

describe('save', () => {
  test('writes content back to disk', async () => {
    const target = path.join(tmpDir, 'hello.ts');
    const r = await invoke(WORKSPACE_CHANNELS.SAVE, target, 'export const x = 2;\n');
    expect(r.success).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('export const x = 2;\n');
  });

  test('will not create new files — only overwrite what was opened', async () => {
    const target = path.join(tmpDir, 'brand-new.ts');
    const r = await invoke(WORKSPACE_CHANNELS.SAVE, target, 'x');
    expect(r.success).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });

  test('rejects a non-string body instead of writing "undefined"', async () => {
    const r = await invoke(WORKSPACE_CHANNELS.SAVE, path.join(tmpDir, 'hello.ts'), undefined);
    expect(r.success).toBe(false);
  });
});

describe('root', () => {
  test('uses the configured project path when it is valid', async () => {
    const r = await invoke(WORKSPACE_CHANNELS.ROOT);
    expect(r.path.toLowerCase()).toBe(tmpDir.toLowerCase());
  });

  test('falls back to home when the configured path is outside the sandbox', async () => {
    (global as any).__handlers.clear();
    registerWorkspaceIpc(() => 'C:\\Windows');
    const r = await invoke(WORKSPACE_CHANNELS.ROOT);
    expect(r.path).toBe(HOME);
  });
});

describe('languageForPath', () => {
  test.each([
    ['a.tsx', 'typescript'], ['a.mjs', 'javascript'], ['a.py', 'python'],
    ['a.yml', 'yaml'], ['Dockerfile', 'dockerfile'], ['.env.local', 'ini'],
    ['a.unknownext', 'plaintext'],
  ])('%s -> %s', (file, lang) => {
    expect(languageForPath(file)).toBe(lang);
  });
});
