import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
let mockProfile: string, mockHome: string;
const mockPaths = new Map<number, string>();
jest.mock('electron', () => ({ app: { getPath: () => mockProfile } }));
jest.mock('../user-paths', () => ({ homeDir: () => mockHome }));
jest.mock('../window-manager', () => ({ getMainWindow: () => null }));
jest.mock('../opened-file-paths', () => ({ queryOpenedFilePaths: jest.fn(async (fds: number[]) => fds.map(fd => mockPaths.get(fd))) }));
import { runWorkspaceRequest, currentWorkspace } from '../workspace-context';
import { diffFilesHandler, DIFF_LIMITS } from '../tools/diff';
import { queryOpenedFilePaths } from '../opened-file-paths';
import { diffReadOpenFlags } from '../bounded-diff-files';
jest.setTimeout(15_000);
let directory: string, root: string, outside: string;
const handles: fs.promises.FileHandle[] = [], readers: jest.SpyInstance[] = [];
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.homedir(), 'hbi-diff-')); mockHome = directory;
  root = path.join(directory, 'project'); outside = path.join(directory, 'outside'); mockProfile = path.join(directory, 'profile');
  for (const item of [root, outside, mockProfile, path.join(root, 'nested')]) fs.mkdirSync(item);
  fs.writeFileSync(path.join(root, 'a'), 'original\n'); fs.writeFileSync(path.join(root, 'b'), 'changed\n');
  fs.writeFileSync(path.join(root, 'nested', 'a'), 'nested original\n'); fs.writeFileSync(path.join(outside, 'a'), 'outside secret\n');
  mockPaths.clear(); handles.length = 0; readers.length = 0;
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof open>) => {
    const handle = await open(...args); handles.push(handle); readers.push(jest.spyOn(handle, 'read'));
    mockPaths.set(handle.fd, fs.realpathSync(String(args[0]))); return handle;
  });
  jest.mocked(queryOpenedFilePaths).mockClear().mockImplementation(async fds => fds.map(fd => mockPaths.get(fd)!) as [string, string]);
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
const invoke = (a = 'a', b = 'b') => runWorkspaceRequest({ workspace: { root }, streamId: 'opened-diff' }, 1, () => diffFilesHandler({ file_a: a, file_b: b }, {} as any));
const noReads = () => { for (const read of readers) expect(read).not.toHaveBeenCalled(); };

test('normal opened objects produce a diff and every held handle is closed', async () => {
  expect(await invoke()).toMatchObject({ success: true, result: { added_lines: 1 } });
  expect(queryOpenedFilePaths).toHaveBeenCalledTimes(2);
  for (const handle of handles) expect(handle.fd).toBe(-1);
});
test('POSIX read-only opens include NONBLOCK while Windows retains supported flags', () => {
  expect(diffReadOpenFlags('linux', { O_RDONLY: 0, O_NONBLOCK: 2048 })).toBe(2048);
  expect(diffReadOpenFlags('win32', { O_RDONLY: 0, O_NONBLOCK: 2048 })).toBe(0);
  expect(() => diffReadOpenFlags('linux', { O_RDONLY: 0 })).toThrow(/nonblocking/);
});
test('an opened nonregular object is rejected before allocation, path querying or reading', async () => {
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args: Parameters<typeof open>) => {
    const handle = await open(...args), stat = await handle.stat({ bigint: true });
    jest.spyOn(handle, 'stat').mockResolvedValueOnce(Object.assign(stat, { isFile: () => false })); return handle;
  });
  expect(await invoke()).toMatchObject({ success: false, error: expect.stringContaining('regular files') });
  expect(queryOpenedFilePaths).not.toHaveBeenCalled(); noReads();
});
test('a replaced file opened outside rejects both sides before any read', async () => {
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementationOnce(async () => open(path.join(outside, 'a'), fs.constants.O_RDONLY));
  expect(await invoke()).toMatchObject({ success: false, error: expect.stringContaining('outside the original IDE project') });
  noReads(); expect(fs.readFileSync(path.join(outside, 'a'), 'utf8')).toBe('outside secret\n');
});
test('parent replacement with a real outside junction rejects before contents read', async () => {
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args: Parameters<typeof open>) => {
    fs.renameSync(path.join(root, 'nested'), path.join(root, 'old-nested'));
    fs.symlinkSync(outside, path.join(root, 'nested'), process.platform === 'win32' ? 'junction' : 'dir');
    return open(...args);
  });
  expect(await invoke('nested/a')).toMatchObject({ success: false, error: expect.stringContaining('outside the original IDE project') });
  noReads();
});
test('held descriptor bytes cannot be redirected by replacing the original pathname after open', async () => {
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args: Parameters<typeof open>) => {
    const handle = await open(...args);
    fs.renameSync(path.join(root, 'a'), path.join(root, 'held-original'));
    fs.copyFileSync(path.join(outside, 'a'), path.join(root, 'a'));
    return handle;
  });
  const result = await invoke(); expect(result.success).toBe(true);
  expect(result.result.unified_diff).toContain('-original'); expect(result.result.unified_diff).not.toContain('outside secret');
});
test('changed actual opened path after read rejects returned contents', async () => {
  jest.mocked(queryOpenedFilePaths).mockImplementationOnce(async fds => fds.map(fd => mockPaths.get(fd)!) as [string, string]);
  jest.mocked(queryOpenedFilePaths).mockImplementationOnce(async () => [path.join(outside, 'a'), path.join(root, 'b')]);
  expect(await invoke()).toMatchObject({ success: false, error: expect.stringContaining('outside the original IDE project') });
});
test('oversized actual file rejects before buffer allocation, querying or reading', async () => {
  fs.truncateSync(path.join(root, 'a'), DIFF_LIMITS.bytes + 1);
  const allocate = jest.spyOn(Buffer, 'alloc');
  const result = await invoke(); const allocations = allocate.mock.calls.length;
  expect(result).toMatchObject({ success: false, error: expect.stringContaining('byte limit') });
  expect(allocations).toBe(0); expect(queryOpenedFilePaths).not.toHaveBeenCalled(); noReads();
});
test('file growth during read refuses and never expands its original bounded read buffer', async () => {
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args: Parameters<typeof open>) => {
    const handle = await open(...args), read = handle.read.bind(handle);
    jest.spyOn(handle, 'read').mockImplementationOnce(async (...readArgs: Parameters<typeof read>) => {
      fs.appendFileSync(path.join(root, 'a'), 'x'.repeat(DIFF_LIMITS.bytes + 1));
      return read(...readArgs);
    });
    return handle;
  });
  expect(await invoke()).toMatchObject({ success: false, error: expect.stringContaining('changed while it was read') });
  for (const call of readers[0].mock.calls) expect(call[0].length).toBe(10); // original 9 bytes + growth sentinel
});
test('stopped request while helper awaits rejects before any file read', async () => {
  jest.mocked(queryOpenedFilePaths).mockImplementationOnce(async fds => { currentWorkspace()!.cancelled = true; return fds.map(fd => mockPaths.get(fd)!) as [string, string]; });
  expect(await invoke()).toMatchObject({ success: false, error: expect.stringContaining('was stopped') }); noReads();
});
test('root replacement by another trusted project cannot broaden captured authority', async () => {
  const open = fs.promises.open.bind(fs.promises);
  jest.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args: Parameters<typeof open>) => {
    fs.renameSync(root, path.join(directory, 'previous-project'));
    fs.symlinkSync(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
    return open(...args);
  });
  expect(await invoke()).toMatchObject({ success: false, error: expect.stringContaining('IDE project changed') }); noReads();
});
