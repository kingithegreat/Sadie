import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { monitorNativeApp, NATIVE_STARTUP_BUDGET_MS } from '../../renderer/e2e/helpers/nativeAppProcess';
import { stopWorkspacePtyTree } from '../workspace-pty-force-stop';

jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: jest.fn(), execFile: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), mkdirSync: jest.fn(), writeFileSync: jest.fn() }));
jest.mock('../workspace-pty-force-stop', () => ({ stopWorkspacePtyTree: jest.fn() }));

const actualPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers();
  Object.defineProperty(process, 'platform', { ...actualPlatform, value: 'win32' });
});
afterEach(() => { Object.defineProperty(process, 'platform', actualPlatform); jest.useRealTimers(); });

function fixture() {
  const native = Object.assign(new EventEmitter(), { pid: 200, kill: jest.fn() }) as unknown as ChildProcess;
  const watcher = Object.assign(new EventEmitter(), {
    pid: 300, exitCode: null as number | null, signalCode: null as string | null,
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: jest.fn(() => true),
  });
  (spawn as jest.Mock).mockReturnValue(watcher);
  const info = { pid: 100, ppid: 200, execPath: 'C:/fixture/electron.exe' };
  const entry = path.resolve('fixture/index.js');
  const birth = '639269214771582930';
  const receipt = { ...info, entry, creation: birth, heldCreation: birth };
  const ready = (value: unknown = receipt) => watcher.stdout.emit('data', 'ready:' + JSON.stringify(value) + '\n');
  const artifact = () => JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]);
  return { native, watcher, info, entry, birth, receipt, ready, artifact };
}

test('one valid held identity arriving at nine seconds succeeds without a retry or native signal', async () => {
  const f = fixture(); let settled = false;
  const startup = monitorNativeApp(f.info, f.native, f.entry).then(value => { settled = true; return value; });
  f.watcher.stdout.emit('data', 'stage:query-main\n');
  f.watcher.stderr.emit('data', 'read-only watcher diagnostic');
  await jest.advanceTimersByTimeAsync(8000);
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(1000);
  f.ready(); const monitor = await startup;
  expect(monitor.creation).toBe(f.birth);
  expect(monitor.startup).toMatchObject({ status: 'ready', budgetMs: 15000, durationMs: 9000, watcherPid: 300 });
  expect(f.artifact()).toMatchObject({ creation: f.birth, expected: { ...f.info, entry: f.entry }, stdoutTail: expect.stringContaining('stage:query-main'), stderrTail: 'read-only watcher diagnostic' });
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(f.watcher.kill).not.toHaveBeenCalled(); expect(f.native.kill).not.toHaveBeenCalled();
  f.watcher.stdout.emit('data', 'exit:' + JSON.stringify({ creation: f.birth, code: 0 }) + '\n');
  await expect(monitor.exit).resolves.toEqual({ creation: f.birth, code: 0 });
  expect(stopWorkspacePtyTree).not.toHaveBeenCalled();
  monitor.dispose(); expect(f.watcher.kill).toHaveBeenCalledTimes(1); expect(f.native.kill).not.toHaveBeenCalled();
});

test('startup timeout retains bounded phase diagnostics and only requests its own watcher cleanup', async () => {
  const f = fixture();
  const failed = expect(monitorNativeApp(f.info, f.native, f.entry)).rejects.toThrow(/exceeded 15 seconds.*Startup diagnostics/);
  f.watcher.stdout.emit('data', 'stage:query-main\n');
  f.watcher.stderr.emit('data', 'x'.repeat(5000) + 'CIM query still pending');
  await jest.advanceTimersByTimeAsync(NATIVE_STARTUP_BUDGET_MS); await failed;
  const artifact = f.artifact();
  expect(artifact).toMatchObject({ status: 'failed', durationMs: 15000, budgetMs: 15000, watcherCleanupRequested: true, expected: { ...f.info, entry: f.entry } });
  expect(artifact.stdoutTail).toBe('stage:query-main\n');
  expect(artifact.stderrTail).toHaveLength(4096); expect(artifact.stderrTail).toMatch(/CIM query still pending$/);
  expect(artifact.creation).toBeUndefined();
  expect(spawn).toHaveBeenCalledTimes(1); expect(f.watcher.kill).toHaveBeenCalledTimes(1);
  expect(f.native.kill).not.toHaveBeenCalled(); expect(stopWorkspacePtyTree).not.toHaveBeenCalled();
});

test.each([
  ['missing identity', { pid: 100 }],
  ['wrong PID', { pid: 101 }],
  ['wrong parent', { ppid: 201 }],
  ['wrong executable', { execPath: 'C:/other/electron.exe' }],
  ['wrong entry', { entry: 'C:/other/index.js' }],
  ['missing creation', { creation: undefined }],
  ['missing held creation', { heldCreation: undefined }],
  ['different held creation', { heldCreation: '639269214771582940' }],
  ['zero creation', { creation: '0', heldCreation: '0' }],
  ['zero held creation with positive CIM creation', { creation: '1', heldCreation: '0' }],
] as const)('rejects %s without native ownership or cleanup authority', async (name, changes) => {
  const f = fixture();
  const failed = expect(monitorNativeApp(f.info, f.native, f.entry)).rejects.toThrow(/Invalid native/);
  f.ready(name === 'missing identity' ? changes : { ...f.receipt, ...changes }); await failed;
  expect(f.artifact()).toMatchObject({ status: 'failed', watcherCleanupRequested: true });
  expect(f.artifact().creation).toBeUndefined();
  expect(f.watcher.kill).toHaveBeenCalledTimes(1); expect(f.native.kill).not.toHaveBeenCalled();
  expect(stopWorkspacePtyTree).not.toHaveBeenCalled();
});

test('corrupt startup JSON fails closed and retains the malformed output', async () => {
  const f = fixture(); const failed = expect(monitorNativeApp(f.info, f.native, f.entry)).rejects.toThrow(/Startup diagnostics/);
  f.watcher.stdout.emit('data', 'ready:{broken-json}\n'); await failed;
  expect(f.artifact().stdoutTail).toBe('ready:{broken-json}\n');
  expect(f.watcher.kill).toHaveBeenCalledTimes(1); expect(f.native.kill).not.toHaveBeenCalled();
});

test('split ready output preserves native creation precision and an unrelated exit cannot report success', async () => {
  const f = fixture(); const startup = monitorNativeApp(f.info, f.native, f.entry);
  const line = 'ready:' + JSON.stringify({ ...f.receipt, heldCreation: '639269214771582939' }) + '\n';
  f.watcher.stdout.emit('data', line.slice(0, 40)); f.watcher.stdout.emit('data', line.slice(40));
  const monitor = await startup;
  const failed = expect(monitor.exit).rejects.toThrow(/Invalid native exit receipt/);
  f.watcher.stdout.emit('data', 'exit:' + JSON.stringify({ creation: '639269214771582940', code: 0 }) + '\n'); await failed;
  expect(f.native.kill).not.toHaveBeenCalled(); expect(stopWorkspacePtyTree).not.toHaveBeenCalled();
  monitor.dispose();
});
