/** Opt-in: real inherited Windows FD queries, no model/network/project execution. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
let mockProfile: string, mockHome: string;
jest.mock('electron', () => ({ app: { getPath: () => mockProfile } }));
jest.mock('../user-paths', () => ({ homeDir: () => mockHome }));
jest.mock('../window-manager', () => ({ getMainWindow: () => null }));
import { diffFilesHandler } from '../tools/diff';
import { runWorkspaceRequest } from '../workspace-context';
import { queryOpenedFilePaths } from '../opened-file-paths';
const live = process.platform === 'win32' && process.env.HOMEBOT_LIVE_DIFF_HANDLES === '1';
let primary: unknown;
const native = (name: string, run: () => Promise<void>) => (live ? test : test.skip)(name, async () => {
  try { await run(); } catch (failure) { primary = failure; throw failure; }
});
jest.setTimeout(25_000); // Two independent bounded 5s read-only queries + real FS.
let directory: string, root: string, outside: string, expectedHome: string;
const handles: fs.promises.FileHandle[] = [], readers: jest.SpyInstance[] = [];
beforeEach(() => {
  if (!live) return;
  primary = undefined; expectedHome = path.resolve(os.homedir());
  directory = fs.mkdtempSync(path.join(expectedHome, 'hbi-fd-')); mockHome = directory;
  root = path.join(directory, 'project'); outside = path.join(directory, 'outside'); mockProfile = path.join(directory, 'profile');
  for (const folder of [root, outside, mockProfile, path.join(root, 'nested')]) fs.mkdirSync(folder);
  fs.writeFileSync(path.join(root, 'a'), 'original\n'); fs.writeFileSync(path.join(root, 'b'), 'changed\n');
  fs.writeFileSync(path.join(root, 'nested', 'a'), 'nested original\n'); fs.writeFileSync(path.join(outside, 'a'), 'outside secret\n');
  handles.length = 0; readers.length = 0;
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof open>) => {
    const handle = await open(...args); handles.push(handle); readers.push(jest.spyOn(handle, 'read')); return handle;
  });
});
afterEach(() => {
  jest.restoreAllMocks(); if (!live) return;
  try {
    if (!path.isAbsolute(directory) || path.dirname(directory) !== expectedHome || !path.basename(directory).startsWith('hbi-fd-') || fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== directory) throw new Error('Owned native fixture cleanup boundary changed.');
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (failure) { if (primary) console.error('Owned native fixture cleanup also refused; original failure retained.'); else throw failure; }
});
const invoke = (a = 'a') => runWorkspaceRequest({ workspace: { root }, streamId: 'native-opened-diff' }, 1, () => diffFilesHandler({ file_a: a, file_b: 'b' }, {} as any));
const allClosed = () => { expect(handles).toHaveLength(2); for (const handle of handles) expect(handle.fd).toBe(-1); };
const noReads = () => { expect(handles).toHaveLength(2); expect(readers).toHaveLength(2); for (const reader of readers) expect(reader).not.toHaveBeenCalled(); allClosed(); };

native('real Windows inherited readonly descriptors produce exact handle paths and a normal diff', async () => {
  const initial: fs.promises.FileHandle[] = []; let queryFailure: unknown;
  try {
    initial.push(await fs.promises.open(path.join(root, 'a'), 'r'));
    initial.push(await fs.promises.open(path.join(root, 'b'), 'r'));
    expect(await queryOpenedFilePaths(initial.map(handle => handle.fd))).toEqual([path.join(root, 'a'), path.join(root, 'b')]);
  } catch (failure) { queryFailure = failure; }
  const cleanup = await Promise.allSettled(initial.map(handle => handle.close()));
  if (queryFailure) { if (cleanup.some(result => result.status === 'rejected')) console.error('Opened-descriptor fixture cleanup also failed.'); throw queryFailure; }
  if (cleanup.some(result => result.status === 'rejected')) throw new Error('Opened-descriptor fixture cleanup failed.');
  expect(await invoke()).toMatchObject({ success: true, result: { added_lines: 1, removed_lines: 1 } });
  expect(handles).toHaveLength(4);
  for (const handle of handles) expect(handle.fd).toBe(-1);
  console.log(JSON.stringify({ openedDiffHandleProof: { inheritedReadonlyDescriptors: true, normalDiff: true, allHeldFilesClosed: true } }));
});

native('real file symlink replacement after validation rejects before either descriptor read', async () => {
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args: Parameters<typeof open>) => {
    fs.renameSync(path.join(root, 'a'), path.join(root, 'previous-a'));
    fs.symlinkSync(path.join(outside, 'a'), path.join(root, 'a'), 'file');
    return open(...args);
  });
  expect(await invoke()).toMatchObject({ success: false, error: expect.stringContaining('outside the original IDE project') });
  noReads(); expect(fs.readFileSync(path.join(outside, 'a'), 'utf8')).toBe('outside secret\n');
  console.log(JSON.stringify({ openedDiffHandleProof: { fileReplacementRejected: true, noDescriptorContentReads: true, outsideBytesUnchanged: true } }));
});

native('real parent junction replacement after validation rejects before either descriptor read', async () => {
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args: Parameters<typeof open>) => {
    fs.renameSync(path.join(root, 'nested'), path.join(root, 'previous-nested'));
    fs.symlinkSync(outside, path.join(root, 'nested'), 'junction');
    return open(...args);
  });
  expect(await invoke('nested/a')).toMatchObject({ success: false, error: expect.stringContaining('outside the original IDE project') });
  noReads(); expect(fs.readFileSync(path.join(outside, 'a'), 'utf8')).toBe('outside secret\n');
  console.log(JSON.stringify({ openedDiffHandleProof: { parentJunctionReplacementRejected: true, noDescriptorContentReads: true, outsideBytesUnchanged: true } }));
});

native('real held object query stays bound after its original pathname is replaced', async () => {
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args: Parameters<typeof open>) => {
    const handle = await open(...args);
    fs.renameSync(path.join(root, 'a'), path.join(root, 'held-a'));
    fs.copyFileSync(path.join(outside, 'a'), path.join(root, 'a'));
    return handle;
  });
  const result = await invoke(); expect(result.success).toBe(true);
  expect(result.result.unified_diff).toContain('-original'); expect(result.result.unified_diff).not.toContain('outside secret');
  allClosed();
  console.log(JSON.stringify({ openedDiffHandleProof: { pathnameReplacementCannotRedirectHeldBytes: true } }));
});
