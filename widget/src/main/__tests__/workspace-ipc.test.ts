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
  app: { getPath: () => (global as any).__workspaceProfile },
  dialog: { showOpenDialog: jest.fn() },
  shell: { trashItem: jest.fn(), showItemInFolder: jest.fn() },
}));
jest.mock('../window-manager', () => ({ getMainWindow: () => ({ isDestroyed: () => false, webContents: (global as any).__workspaceContents }) }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerWorkspaceIpc, WORKSPACE_CHANNELS, languageForPath } from '../workspace-ipc';
import { dialog, shell } from 'electron';

(global as any).__handlers = new Map<string, any>();
(global as any).__workspaceContents = { mainFrame: {} };
const invoke = (channel: string, ...args: unknown[]) => (global as any).__handlers.get(channel)({ sender: (global as any).__workspaceContents, senderFrame: (global as any).__workspaceContents.mainFrame }, ...args);

const HOME = os.homedir();
let tmpDir: string;

beforeAll(() => {
  // Inside HOME so it is inside the sandbox, like a real project folder.
  tmpDir = fs.mkdtempSync(path.join(HOME, 'hb-ws-test-'));
  (global as any).__workspaceProfile = path.join(tmpDir, 'profile');
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
    expect(r.error).toMatch(/home|protected|project/i);
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
    const opened = await invoke(WORKSPACE_CHANNELS.READ, target);
    const r = await invoke(WORKSPACE_CHANNELS.SAVE, target, 'export const x = 2;\n', { expectedVersion: opened.version });
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
    expect(r.path).toBe(fs.realpathSync(HOME));
  });
  test('an aliased default home returns the same canonical root as its tree and file reads', async () => {
    const alias = path.join(tmpDir, 'home-alias');
    fs.symlinkSync(tmpDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const home = jest.spyOn(require('os') as typeof os, 'homedir').mockReturnValue(alias);
    try {
      registerWorkspaceIpc(() => undefined);
      const root = await invoke(WORKSPACE_CHANNELS.ROOT);
      const list = await invoke(WORKSPACE_CHANNELS.LIST, alias);
      const file = await invoke(WORKSPACE_CHANNELS.READ, path.join(alias, 'hello.ts'));
      expect(root).toEqual({ success: true, path: fs.realpathSync(tmpDir) });
      expect(list).toMatchObject({ success: true, path: root.path });
      expect(file).toMatchObject({ success: true, path: path.join(root.path, 'hello.ts') });
      expect(path.relative(root.path, file.path)).toBe('hello.ts');
    } finally {
      home.mockRestore();
      if (process.platform === 'win32') fs.rmdirSync(alias);
      else fs.unlinkSync(alias);
    }
  });
  test('default home validation preserves protected-root and trusted-sender refusal', async () => {
    const profile = (global as any).__workspaceProfile;
    fs.mkdirSync(profile, { recursive: true });
    const home = jest.spyOn(require('os') as typeof os, 'homedir').mockReturnValue(profile);
    try {
      registerWorkspaceIpc(() => undefined);
      expect(await invoke(WORKSPACE_CHANNELS.ROOT)).toMatchObject({ success: false });
      const handler = (global as any).__handlers.get(WORKSPACE_CHANNELS.ROOT);
      expect(await handler({ sender: {}, senderFrame: {} })).toMatchObject({ success: false });
    } finally { home.mockRestore(); }
  });
});

test('native-approved outside-home projects support safe file, search, recovery and task paths', async () => {
  const outside = fs.mkdtempSync(path.join(path.dirname(HOME), 'hb-approved-workspace-'));
  const file = path.join(outside, 'source.txt');
  fs.writeFileSync(file, '\uFEFFhello\r\n');
  try {
    expect(await invoke(WORKSPACE_CHANNELS.READ, file)).toMatchObject({ success: false });
    (dialog.showOpenDialog as jest.Mock).mockResolvedValueOnce({ canceled: false, filePaths: [outside] });
    expect(await invoke(WORKSPACE_CHANNELS.CHOOSE_PROJECT)).toMatchObject({ success: true, path: fs.realpathSync(outside) });
    const opened = await invoke(WORKSPACE_CHANNELS.READ, file);
    expect(opened).toMatchObject({ success: true, content: 'hello\n', bom: true, eol: 'crlf' });
    expect(await invoke(WORKSPACE_CHANNELS.SAVE, file, 'updated\n', { expectedVersion: opened.version })).toMatchObject({ success: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('\uFEFFupdated\r\n');
    const searched = await invoke(WORKSPACE_CHANNELS.SEARCH, { directory: outside, pattern: 'updated' });
    expect(searched).toMatchObject({ success: true, matches: [expect.objectContaining({ path: file })] });
    const draft = { files: [{ path: file, content: 'draft', original: 'updated\n' }], activePath: file };
    expect(await invoke(WORKSPACE_CHANNELS.RECOVERY_SAVE, outside, draft)).toMatchObject({ success: true });
    expect(await invoke(WORKSPACE_CHANNELS.RECOVERY_LOAD, outside)).toMatchObject({ success: true, state: draft });
    fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ scripts: { check: 'node --check source.js' } }));
    expect(require('../workspace-tasks').listWorkspacePackageTasks(outside)).toMatchObject({ success: true, tasks: [{ name: 'check' }] });
    expect(await invoke(WORKSPACE_CHANNELS.FILE_ACTION, { root: outside, path: path.join(outside, '..', 'outside.txt'), action: 'create-file', content: 'bad' })).toMatchObject({ success: false });
    const grantFile = path.join((global as any).__workspaceProfile, 'ide-trusted-folders.json');
    fs.writeFileSync(grantFile, JSON.stringify({ roots: [] }));
    expect(await invoke(WORKSPACE_CHANNELS.READ, file)).toMatchObject({ success: false });
    expect(await invoke(WORKSPACE_CHANNELS.SAVE, file, 'erase', { expectedVersion: opened.version })).toMatchObject({ success: false });
    expect(fs.readFileSync(file, 'utf8')).toBe('\uFEFFupdated\r\n');
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});

test.each(Object.values(WORKSPACE_CHANNELS))('every workspace route rejects an untrusted frame: %s', async channel => {
  const handler = (global as any).__handlers.get(channel);
  expect(await handler({ sender: (global as any).__workspaceContents, senderFrame: {} }, tmpDir, 'draft')).toMatchObject({ success: false });
});

describe('human project and file actions', () => {
  test('hidden config is reachable while dependencies stay excluded', async () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'secret');
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });
    const hidden = await invoke(WORKSPACE_CHANNELS.LIST, tmpDir, { showHidden: true });
    expect(hidden.entries.map((e: any) => e.name)).toEqual(expect.arrayContaining(['.gitignore', '.github']));
    expect(hidden.entries.map((e: any) => e.name)).not.toContain('node_modules');
  });
  test('create and move are no-clobber and refuse root deletion and project escape', async () => {
    const file = path.join(tmpDir, 'created.txt');
    expect((await invoke(WORKSPACE_CHANNELS.FILE_ACTION, { root: tmpDir, action: 'create-file', path: file, content: 'keep' })).success).toBe(true);
    expect((await invoke(WORKSPACE_CHANNELS.FILE_ACTION, { root: tmpDir, action: 'create-file', path: file, content: 'erase' })).success).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('keep');
    const destination = path.join(tmpDir, 'moved.txt');
    expect((await invoke(WORKSPACE_CHANNELS.FILE_ACTION, { root: tmpDir, action: 'move', path: file, destination })).success).toBe(true);
    expect(fs.readFileSync(destination, 'utf8')).toBe('keep');
    expect((await invoke(WORKSPACE_CHANNELS.FILE_ACTION, { root: tmpDir, action: 'delete', path: tmpDir })).success).toBe(false);
    expect((await invoke(WORKSPACE_CHANNELS.FILE_ACTION, { root: tmpDir, action: 'create-file', path: path.join(tmpDir, '..', 'escape.txt'), content: 'bad' })).success).toBe(false);
  });
  test('folder picker records recents without changing global project settings', async () => {
    (dialog.showOpenDialog as jest.Mock).mockResolvedValueOnce({ canceled: false, filePaths: [tmpDir] });
    expect(await invoke(WORKSPACE_CHANNELS.CHOOSE_PROJECT)).toMatchObject({ success: true, path: tmpDir });
    expect(await invoke(WORKSPACE_CHANNELS.RECENT_PROJECTS)).toMatchObject({ success: true, paths: [tmpDir] });
  });
  test('untrusted renderer and child frames cannot mutate files, recovery, recents or open dialogs', async () => {
    const file = path.join(tmpDir, 'unauthorized.txt');
    const handler = (channel: string) => (global as any).__handlers.get(channel);
    for (const event of [{ sender: {}, senderFrame: {} }, { sender: (global as any).__workspaceContents, senderFrame: {} }]) {
      expect((await handler(WORKSPACE_CHANNELS.FILE_ACTION)(event, { root: tmpDir, action: 'create-file', path: file, content: 'bad' })).success).toBe(false);
      expect((await handler(WORKSPACE_CHANNELS.RECOVERY_SAVE)(event, tmpDir, { files: [] })).success).toBe(false);
      expect((await handler(WORKSPACE_CHANNELS.RECOVERY_LOAD)(event, tmpDir)).success).toBe(false);
      expect((await handler(WORKSPACE_CHANNELS.RECENT_PROJECTS)(event, tmpDir)).success).toBe(false);
      expect((await handler(WORKSPACE_CHANNELS.CHOOSE_PROJECT)(event)).success).toBe(false);
    }
    expect(fs.existsSync(file)).toBe(false);
  });
  test('deleting calls the OS recycle bin rather than recursive removal', async () => {
    const file = path.join(tmpDir, 'notes.md');
    (shell.trashItem as jest.Mock).mockResolvedValueOnce(undefined);
    expect((await invoke(WORKSPACE_CHANNELS.FILE_ACTION, { root: tmpDir, action: 'delete', path: file })).success).toBe(true);
    expect(shell.trashItem).toHaveBeenCalledWith(file);
    expect(fs.existsSync(file)).toBe(true); // mock deliberately does not remove anything
  });
});

describe('languageForPath', () => {
  test.each([
    ['a.tsx', 'typescript'], ['a.mjs', 'javascript'], ['a.py', 'python'],
    ['a.yml', 'yaml'], ['Dockerfile', 'dockerfile'], ['.env.local', 'ini'],
    ['game.lua', 'lua'], ['game.luau', 'luau'], ['project.toml', 'toml'],
    ['a.unknownext', 'plaintext'],
  ])('%s -> %s', (file, lang) => {
    expect(languageForPath(file)).toBe(lang);
  });
});
