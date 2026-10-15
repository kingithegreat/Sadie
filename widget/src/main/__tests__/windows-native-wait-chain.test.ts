import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { collectWindowsNativeWaitChain, windowsNativeWaitChainSource } from '../../renderer/e2e/helpers/windowsNativeWaitChain';
import { buildWaitChainControl, controlIdentity, type WaitChainControl } from './windows-native-wait-chain.controls';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('fs', () => ({ __esModule: true, default: { mkdirSync: jest.fn(), writeFileSync: jest.fn() } }));
const run = execFile as unknown as jest.Mock;
const actualPlatform = process.platform;
const previousSystemRoot = process.env.SystemRoot;
const identity = { ...controlIdentity };
const artifacts = path.resolve('test-artifacts-wait-chain');
const row = { threadId: 1001, state: 'Wait', waitReason: 'UserRequest', wctError: 0, reportedNodeCount: 1,
  nodes: [{ objectType: 8, objectStatus: 3, processId: 1234, threadId: 1001 }], cycleObserved: false };
const complete = { ...controlIdentity, heldCreation: '639269363416749717', status: 'complete', identityVerified: true, stillAlive: true, totalThreadCount: 1, threads: [row] };
beforeEach(() => { jest.clearAllMocks(); Object.defineProperty(process, 'platform', { value: 'win32' }); process.env.SystemRoot = 'C:\\Windows'; });
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: actualPlatform });
  if (previousSystemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = previousSystemRoot;
});
function reply(data: unknown, error: Error | null = null) {
  run.mockImplementation((_file, _args, _options, callback) => callback(error, `WCT:${JSON.stringify(data)}\n`, ''));
}

test('complete positive control persists metadata with bounded fixed-system collector and private stores', async () => {
  reply(complete);
  const result = await collectWindowsNativeWaitChain(identity, artifacts);
  expect(result).toMatchObject({ status: 'complete', pid: 1234, threads: [row], identityVerified: true });
  const [file, args, options] = run.mock.calls[0];
  expect(file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  expect(args).toContain('-EncodedCommand'); expect(options).toMatchObject({ timeout: 4000, maxBuffer: 65536, windowsHide: true });
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR']) expect(options.env[key]).toContain(artifacts);
  expect(options.env.HOME).toBe(options.env.USERPROFILE); expect(options.cwd).toBe(options.env.HOME);
  expect(fs.writeFileSync).toHaveBeenCalledWith(result.artifact, expect.stringContaining('read-only-wait-chain-and-thread-metadata'), 'utf8');
});
test.each([
  { ...identity, pid: 0 }, { ...identity, creation: '' }, { ...identity, creation: "1';exit" },
])('missing authority never launches a collector: %j', async input => {
  expect((await collectWindowsNativeWaitChain(input, artifacts)).status).toBe('refused');
  expect(run).not.toHaveBeenCalled(); expect(fs.mkdirSync).not.toHaveBeenCalled();
});
test('a reused identity or unverified complete payload is refused', async () => {
  reply({ ...complete, creation: '639269363416749720' });
  expect((await collectWindowsNativeWaitChain(identity, artifacts)).status).toBe('refused');
  reply({ ...complete, identityVerified: false });
  expect((await collectWindowsNativeWaitChain(identity, artifacts)).status).toBe('refused');
});
test('metadata failures stay partial and transport failure cannot promote a receipt to complete', async () => {
  reply({ ...complete, status: 'partial', threads: [{ ...row, wctError: 5, nodes: [] }] });
  expect((await collectWindowsNativeWaitChain(identity, artifacts)).status).toBe('partial');
  reply(complete, new Error('collector timed out'));
  expect(await collectWindowsNativeWaitChain(identity, artifacts)).toMatchObject({ status: 'partial', error: expect.stringContaining('timed out') });
});
test('identity refusal survives an exec error and retains the original refusal reason', async () => {
  reply({ ...complete, status: 'refused', identityVerified: false, stillAlive: false, threads: [], error: 'Captured birth mismatch' }, new Error('collector failed'));
  expect(await collectWindowsNativeWaitChain(identity, artifacts)).toMatchObject({ status: 'refused', error: expect.stringMatching(/Captured birth mismatch.*collector failed/) });
});
test.each([
  { objectType: 0, objectStatus: 3 }, { objectType: 13, objectStatus: 3 },
  { objectType: 8, objectStatus: 0 }, { objectType: 8, objectStatus: 11 },
  { objectType: 8 }, { objectStatus: 3 }, { objectType: 10, objectStatus: 3 },
])('malformed or unknown enum nodes cannot be classified complete: %j', async node => {
  reply({ ...complete, threads: [{ ...row, nodes: [node] }] });
  expect((await collectWindowsNativeWaitChain(identity, artifacts)).status).toBe('refused');
});
test('oversized or multiple receipt output fails closed', async () => {
  run.mockImplementation((_file, _args, _options, callback) => callback(null, 'x'.repeat(65537), ''));
  expect((await collectWindowsNativeWaitChain(identity, artifacts)).status).toBe('refused');
  run.mockImplementation((_file, _args, _options, callback) => callback(null, `WCT:${JSON.stringify(complete)}\nWCT:${JSON.stringify(complete)}\n`, ''));
  expect((await collectWindowsNativeWaitChain(identity, artifacts)).status).toBe('refused');
});
test('chain/thread caps and inaccessible nodes cannot be called complete', async () => {
  reply({ ...complete, threads: Array(129).fill(row) });
  expect((await collectWindowsNativeWaitChain(identity, artifacts)).status).toBe('refused');
  reply({ ...complete, threads: [{ ...row, nodes: Array(17).fill(row.nodes[0]) }] });
  expect((await collectWindowsNativeWaitChain(identity, artifacts)).status).toBe('refused');
  reply({ ...complete, threads: [{ ...row, nodes: [{ ...row.nodes[0], objectStatus: 1 }] }] });
  expect((await collectWindowsNativeWaitChain(identity, artifacts)).status).toBe('refused');
});
test('generated collector imports only read/query APIs and has no application effects', () => {
  const source = windowsNativeWaitChainSource(1234, identity.creation);
  for (const name of ['TerminateProcess', 'SuspendThread', 'WriteProcessMemory', 'MiniDumpWriteDump', 'DebugActiveProcess', 'Get-CimInstance', 'app.quit']) expect(source).not.toContain(name);
  expect(source).toContain('OpenProcess(0x101000'); expect(source).toContain('OpenThread(0x800');
  expect(source).toContain('NodeBytes=280, MaxNodes=16, MaxThreads=128');
});

const windowsControl = actualPlatform === 'win32' ? test : test.skip;
windowsControl.each<WaitChainControl>(['complete', 'denied', 'reused', 'wrong-thread-owner', 'root-exits', 'more-data', 'invalid-type', 'invalid-status', 'unknown-type'])('generated actual WCT pipeline %s has every native API mocked', mode => {
  const source = buildWaitChainControl(mode);
  expect(source).not.toContain('DllImport'); expect(source).not.toContain('Process.GetProcessById');
  const output = jest.requireActual('child_process').execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 8000, maxBuffer: 65536, encoding: 'utf8' }) as string;
  const lines = output.trim().split(/\r?\n/);
  const report = JSON.parse(lines.find(value => value.startsWith('WCT:'))!.slice(4));
  const control = JSON.parse(lines.find(value => value.startsWith('CONTROL:'))!.slice(8));
  expect(report.status).toBe(mode === 'complete' ? 'complete' : mode === 'reused' || mode === 'root-exits' ? 'refused' : 'partial');
  if (mode === 'complete') {
    expect(report.threads).toHaveLength(2); expect(report.threads[0].nodes[0]).toMatchObject({ objectType: 8, objectStatus: 3, processId: 1234, threadId: 1001, waitTime: 7, contextSwitches: 11 });
    expect(control).toEqual({ nativeClosed: 3, sessionClosed: 1, wctCalls: 2 });
  } else if (mode === 'reused') expect(control).toEqual({ nativeClosed: 1, sessionClosed: 0, wctCalls: 0 });
  else if (mode === 'wrong-thread-owner') expect(control.wctCalls).toBe(0);
  else if (mode === 'root-exits') expect(report.stillAlive).toBe(false);
  else if (mode === 'denied') expect(report.threads[0].cycleObserved).toBeUndefined();
  else if (mode === 'more-data') expect(report.threads[0].nodes).toHaveLength(16);
}, 12_000);
