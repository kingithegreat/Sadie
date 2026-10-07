import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const mockSpawn = jest.fn(); let mockProfile: string;
jest.mock('child_process', () => ({ spawn: (...args: unknown[]) => mockSpawn(...args) }));
jest.mock('electron', () => ({ app: { getPath: () => mockProfile } }));
import { queryOpenedFilePaths, parseOpenedFilePaths, openedFileQuerySource, OPENED_PATH_QUERY_MS } from '../opened-file-paths';
let helper: EventEmitter & { stderr: PassThrough; kill: jest.Mock };
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const metadata = (a = String.raw`\\?\C:\project\a`, b = String.raw`\\?\C:\project\b`) => Buffer.from(`HBI_OPENED_1\n${Buffer.from(a).toString('base64')}\n${Buffer.from(b).toString('base64')}\n`);
beforeEach(() => {
  mockProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'hbi-query-'));
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
  jest.replaceProperty(process, 'env', { SystemRoot: String.raw`C:\Windows`, NODE_OPTIONS: '--require forbidden', HOMEBOT_E2E: '1' });
  helper = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: jest.fn() });
  mockSpawn.mockReset().mockReturnValue(helper);
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); Object.defineProperty(process, 'platform', originalPlatform); fs.rmSync(mockProfile, { recursive: true, force: true }); });

test('only owned numeric descriptors reach fixed helper and actual paths decode exactly', async () => {
  const pending = queryOpenedFilePaths([41, 42]);
  const [exe, args, options] = mockSpawn.mock.calls[0];
  expect(exe).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`);
  expect(options.stdio).toEqual([41, 42, 'pipe']); expect(options.cwd).toBe(path.join(mockProfile, 'ide-file-verification'));
  expect(options.env.NODE_OPTIONS).toBeUndefined(); expect(options.env.HOMEBOT_E2E).toBeUndefined();
  expect(options.env.TEMP).toBe(options.cwd); expect(options.env.USERPROFILE).toBe(options.cwd);
  expect(Buffer.from(args.at(-1), 'base64').toString('utf16le')).toBe(openedFileQuerySource());
  helper.stderr.write(metadata()); helper.emit('close', 0, null);
  expect(await pending).toEqual([String.raw`C:\project\a`, String.raw`C:\project\b`]);
});
test('helper metadata is accepted only after actual successful close', async () => {
  const pending = queryOpenedFilePaths([41, 42]); let settled = false;
  void pending.then(() => { settled = true; }); helper.stderr.write(metadata());
  await Promise.resolve(); expect(settled).toBe(false);
  helper.emit('close', 0, null); await pending; expect(settled).toBe(true);
});
test('malformed, unknown namespace and oversized metadata fail without echoing outside paths', () => {
  for (const output of [Buffer.from('outside secret'), metadata(String.raw`\\?\Volume{unknown}\secret`), metadata('C:\\secret\\a\0'), Buffer.alloc(192 * 1024 + 1)]) {
    expect(() => parseOpenedFilePaths(output)).toThrow(/verification/);
    try { parseOpenedFilePaths(output); } catch (error) { expect((error as Error).message).not.toContain('secret'); }
  }
});
test('timeout kills only exact owned helper and waits for its close before rejecting', async () => {
  jest.useFakeTimers(); const pending = queryOpenedFilePaths([41, 42]); let settled = false;
  const outcome = pending.catch(error => { settled = true; return error; });
  await jest.advanceTimersByTimeAsync(OPENED_PATH_QUERY_MS);
  expect(helper.kill).toHaveBeenCalledTimes(1); expect(settled).toBe(false);
  helper.emit('close', 1, null); expect(await outcome).toHaveProperty('message', expect.stringContaining('timed out'));
});
test('helper failure or output overflow refuses without returning metadata', async () => {
  const pending = queryOpenedFilePaths([41, 42]), outcome = pending.catch(error => error);
  helper.stderr.write(Buffer.alloc(192 * 1024 + 1)); expect(helper.kill).toHaveBeenCalledTimes(1);
  helper.emit('close', 0, null); expect(await outcome).toHaveProperty('message', expect.stringContaining('metadata budget'));
});
test('generated query contains only two handle-query imports and no file read or caller path channel', () => {
  const source = openedFileQuerySource();
  expect(source.match(/DllImport/g)).toHaveLength(2); expect(source).toContain('GetFinalPathNameByHandleW');
  expect(source).not.toMatch(/CreateFile|ReadFile|FileStream|ReadLine|ReadAll|Get-Content|Invoke-Expression/);
  expect(source).toContain('Query(-10),second=Query(-11)');
});
test('existing compiler-directory junction refuses before helper launch or outside writes', async () => {
  const outside = fs.mkdtempSync(path.join(path.dirname(mockProfile), 'hbi-query-outside-'));
  try {
    fs.symlinkSync(outside, path.join(mockProfile, 'ide-file-verification'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(queryOpenedFilePaths([41, 42])).rejects.toThrow(/private directory.*redirected/);
    expect(mockSpawn).not.toHaveBeenCalled(); expect(fs.readdirSync(outside)).toEqual([]);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});
