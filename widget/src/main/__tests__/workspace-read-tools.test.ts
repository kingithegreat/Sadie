/** Real registry/ALS/trust/filesystem; no external command or owner-profile writes. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
let mockProfile: string, mockHome: string;
jest.mock('electron', () => ({ app: { getPath: () => mockProfile } }));
jest.mock('../user-paths', () => ({ homeDir: () => mockHome }));
jest.mock('../window-manager', () => ({ getMainWindow: () => null }));
jest.mock('child_process', () => ({ exec: jest.fn(() => { throw new Error('External search is forbidden in this fixture'); }) }));
import { currentWorkspace, runWorkspaceRequest } from '../workspace-context';
import { registerTool, getTool, getAllToolDefinitions } from '../tools/registry';
import { diffTextDef, diffFilesDef, diffTextHandler, diffFilesHandler } from '../tools/diff';
import { searchFilesDef, searchFilesHandler } from '../tools/search';

jest.setTimeout(15_000);
let directory: string, a: string, b: string;
const disposers: (() => void)[] = [];
beforeEach(() => {
  // A unique owned folder under home also exercises normal chat's existing
  // home boundary when the runner's TEMP is independently redirected.
  directory = fs.mkdtempSync(path.join(os.homedir(), 'hbi-read-')); mockHome = directory;
  a = path.join(directory, 'a'); b = path.join(directory, 'b'); mockProfile = path.join(directory, 'profile');
  for (const folder of [a, b, mockProfile, path.join(a, 'nested')]) fs.mkdirSync(folder);
  fs.writeFileSync(path.join(a, 'first.ts'), 'first\n'); fs.writeFileSync(path.join(a, 'second.ts'), 'second\n');
  fs.writeFileSync(path.join(a, 'nested', 'child.ts'), 'child\n'); fs.writeFileSync(path.join(b, 'outside.ts'), 'outside secret\n');
  disposers.push(registerTool(diffTextDef.name, diffTextDef, diffTextHandler), registerTool(diffFilesDef.name, diffFilesDef, diffFilesHandler), registerTool(searchFilesDef.name, searchFilesDef, searchFilesHandler));
});
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
const invoke = (name: string, args: any) => getTool(name)!.handler(args, { executionId: 'workspace-read-fixture' });
const inProject = <T,>(root: string, run: () => T, mode?: 'inline-draft') => runWorkspaceRequest({ workspace: { root, ...(mode ? { mode } : {}) }, streamId: `read-${root}` }, 1, run);

test('advertised text/file diffs run without plan approval and preserve both real files', async () => {
  expect(getAllToolDefinitions().map(def => def.name)).toEqual(expect.arrayContaining(['diff_text', 'diff_files', 'find_files']));
  await inProject(a, async () => {
    expect(await invoke('diff_text', { original: 'before', modified: 'after' })).toMatchObject({ success: true, result: { added_lines: 1 } });
    const result = await invoke('diff_files', { file_a: 'first.ts', file_b: 'second.ts' });
    expect(result.success).toBe(true); expect(result.result.unified_diff).toContain('+second');
    expect(currentWorkspace()?.approved).toBe(false);
  });
  expect(fs.readFileSync(path.join(a, 'first.ts'), 'utf8')).toBe('first\n');
  expect(fs.readFileSync(path.join(a, 'second.ts'), 'utf8')).toBe('second\n');
});
test('mixed or traversing diff paths reject before either file read', async () => {
  const read = jest.spyOn(fs.promises, 'readFile');
  await inProject(a, async () => {
    for (const outside of [path.join(b, 'outside.ts'), '../b/outside.ts']) {
      expect(await invoke('diff_files', { file_a: 'first.ts', file_b: outside })).toMatchObject({ success: false, error: expect.stringContaining('outside') });
    }
  });
  expect(read).not.toHaveBeenCalled(); expect(fs.readFileSync(path.join(b, 'outside.ts'), 'utf8')).toBe('outside secret\n');
});
test('explicitly trusted projects outside the configured home boundary retain read-only tools', async () => {
  mockHome = b;
  fs.writeFileSync(path.join(mockProfile, 'ide-trusted-folders.json'), JSON.stringify({ roots: [fs.realpathSync(a)] }));
  await inProject(a, async () => {
    expect(await invoke('diff_files', { file_a: 'first.ts', file_b: 'second.ts' })).toMatchObject({ success: true });
    expect(await invoke('find_files', { query: 'first.ts' })).toMatchObject({ success: true, result: { count: 1, engine: 'workspace' } });
  });
});
test('filename search defaults to each authoritative project and supports scoped relative folders', async () => {
  const [first, second] = await Promise.all([inProject(a, () => invoke('find_files', { query: '*.ts' })), inProject(b, () => invoke('find_files', { query: '*.ts' }))]);
  expect(first.success).toBe(true); expect(first.result.results.map((item: any) => item.name).sort()).toEqual(['child.ts', 'first.ts', 'second.ts']);
  expect(second.result.results.map((item: any) => item.name)).toEqual(['outside.ts']);
  const nested = await inProject(a, () => invoke('find_files', { query: 'child', path: 'nested', type: 'file' }));
  expect(nested.result.results).toEqual([{ name: 'child.ts', path: path.join(a, 'nested', 'child.ts'), type: 'file' }]);
  expect(require('child_process').exec).not.toHaveBeenCalled();
});
test('filename search rejects outside roots without enumeration or external fallback', async () => {
  const open = jest.spyOn(fs.promises, 'opendir');
  for (const target of [b, '../b']) expect(await inProject(a, () => invoke('find_files', { query: '*', path: target }))).toMatchObject({ success: false });
  expect(open).not.toHaveBeenCalled(); expect(require('child_process').exec).not.toHaveBeenCalled();
});
test('junction escape is never searched or read, even through registered diff tools', async () => {
  const link = path.join(a, 'escape'); fs.symlinkSync(b, link, process.platform === 'win32' ? 'junction' : 'dir');
  const read = jest.spyOn(fs.promises, 'readFile'), open = jest.spyOn(fs.promises, 'opendir');
  await inProject(a, async () => {
    expect(await invoke('diff_files', { file_a: 'first.ts', file_b: 'escape/outside.ts' })).toMatchObject({ success: false });
    expect(await invoke('find_files', { query: '*', path: 'escape' })).toMatchObject({ success: false });
    const result = await invoke('find_files', { query: '*.ts' });
    expect(result.success).toBe(true); expect(result.result.skippedLinks).toBe(1);
    expect(result.result.results.some((item: any) => item.name === 'outside.ts')).toBe(false);
  });
  expect(read).not.toHaveBeenCalled(); expect(open.mock.calls.some(call => String(call[0]).startsWith(b))).toBe(false);
  expect(fs.readFileSync(path.join(b, 'outside.ts'), 'utf8')).toBe('outside secret\n');
});
test('cancellation after asynchronous directory open freezes traversal and never falls back', async () => {
  const original = fs.promises.opendir.bind(fs.promises);
  jest.spyOn(fs.promises, 'opendir').mockImplementation(async (...args: Parameters<typeof original>) => {
    const handle = await original(...args); currentWorkspace()!.cancelled = true; return handle;
  });
  expect(await inProject(a, () => invoke('find_files', { query: '*' }))).toMatchObject({ success: false, error: expect.stringContaining('stopped') });
  expect(require('child_process').exec).not.toHaveBeenCalled();
});
test('result/time budgets return honest truncation rather than unbounded scanning', async () => {
  const limited = await inProject(a, () => invoke('find_files', { query: '*', limit: 1 }));
  expect(limited.result.count).toBe(1); expect(limited.result.truncated).toBe(true); expect(limited.result.warning).toMatch(/budget/);
  let clock = 0; jest.spyOn(Date, 'now').mockImplementation(() => (clock += 2100));
  const timed = await inProject(a, () => invoke('find_files', { query: '*' }));
  expect(timed.success).toBe(true); expect(timed.result.truncated).toBe(true); expect(timed.result.scanned).toBe(0);
});
test('inline drafts still reject all three tools and normal chat text diffs remain available', async () => {
  await inProject(a, async () => {
    for (const name of ['diff_text', 'diff_files', 'find_files']) expect(await invoke(name, {})).toMatchObject({ success: false, error: expect.stringContaining('cannot call tools') });
  }, 'inline-draft');
  expect(await invoke('diff_text', { original: 'before', modified: 'after' })).toMatchObject({ success: true });
});
test('normal chat retains home file comparison and the existing external filename search fallback', async () => {
  expect(await invoke('diff_files', { file_a: path.join(a, 'first.ts'), file_b: path.join(a, 'second.ts') })).toMatchObject({ success: true });
  const execute = require('child_process').exec;
  execute.mockImplementationOnce((_command: string, _options: any, callback: Function) => { callback(new Error('Everything unavailable')); return {}; });
  execute.mockImplementationOnce((_command: string, _options: any, callback: Function) => {
    callback(null, { stdout: JSON.stringify({ Name: 'first.ts', FullName: path.join(a, 'first.ts'), PSIsContainer: false }), stderr: '' }); return {};
  });
  const result = await invoke('find_files', { query: '*.ts', path: a });
  expect(result).toMatchObject({ success: true, result: { engine: 'powershell', count: 1 } });
  expect(execute).toHaveBeenCalledTimes(2);
});
