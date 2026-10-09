// Real filesystem fixtures use the repository's explicit I/O budget.
jest.setTimeout(15_000);

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { performWorkspaceTests, stopWorkspaceTestRuns } from '../workspace-tests';
import { createPendingWorkspaceWindowsJob } from '../workspace-windows-job';
import { workspacePtyLifecycle } from '../workspace-pty-identity';
import { stopWorkspaceChild } from '../workspace-owned-process';
import { assertWorkspaceRuntimeOpen } from '../workspace-runtime-admission';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../workspace-trust', () => ({ validateTrustedWorkspaceRoot: (root: string) => root, checkedTrustedWorkspacePath: (_root: string, file: string) => file, checkedAnyTrustedWorkspacePath: (file: string) => file, workspacePathWithin: (root: string, file: string) => file === root || file.startsWith(root + jest.requireActual('path').sep) }));
jest.mock('../workspace-owned-process', () => ({ rememberWorkspaceChild: jest.fn(), stopWorkspaceChild: jest.fn(async (child: any) => { child.exitCode = 0; child.emit('close', 0); }) }));
jest.mock('../workspace-windows-job', () => ({ createPendingWorkspaceWindowsJob: jest.fn() }));
jest.mock('../workspace-process-gate', () => ({ createWorkspaceProcessGate: (env: any) => ({ executable: 'fixed-core.exe', args: ['-e', 'fixed-bootstrap'], env, pipeName: 'private', capability: 'private' }), snapshotWorkspaceLaunch: (executable: string, args: string[], env: any, options: any) => ({ executable, args: [...args], env: { ...env }, cwd: options.cwd }) }));
jest.mock('../workspace-pty-identity', () => ({ workspacePtyLifecycle: { capture: jest.fn() } }));
jest.mock('../workspace-runtime-admission', () => ({ assertWorkspaceRuntimeOpen: jest.fn() }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
const originalPlatform = process.platform;
let root: string, file: string, job: any, child: any, attached: ReturnType<typeof deferred>;
const call = (action: 'run' | 'state' | 'stop') => performWorkspaceTests({ root, action, file });
beforeEach(() => {
  jest.clearAllMocks(); Object.defineProperty(process, 'platform', { value: 'win32' });
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-test-job-')); file = path.join(root, 'unit.test.js'); fs.writeFileSync(file, 'const {test}=require("node:test");test("passes",()=>{});');
  child = Object.assign(new EventEmitter(), { pid: 1234, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
  (spawn as jest.Mock).mockReturnValue(child); (workspacePtyLifecycle.capture as jest.Mock).mockResolvedValue({ creation: '639269400760538180', parent: process.pid });
  (assertWorkspaceRuntimeOpen as jest.Mock).mockImplementation(() => {});
  attached = deferred();
  job = { listening: Promise.resolve(), ready: Promise.resolve(), attach: jest.fn(async () => { attached.resolve(); }),
    authorize: jest.fn(async (_launch: unknown, validate: () => void) => { validate(); return 2345; }),
    stop: jest.fn(async () => { child.exitCode = 0; child.emit('close', 0); }) };
  (createPendingWorkspaceWindowsJob as jest.Mock).mockReturnValue(job);
});
afterEach(async () => { job.stop.mockImplementation(async () => { child.exitCode = 0; child.emit('close', 0); }); await stopWorkspaceTestRuns(); Object.defineProperty(process, 'platform', { value: originalPlatform }); fs.rmSync(root, { recursive: true, force: true }); });

test('test runner code is released only by retained Job readiness and final sender validation', async () => {
  const validate = jest.fn(); expect((await performWorkspaceTests({ root, action: 'run', file }, validate)).success).toBe(true);
  expect((spawn as jest.Mock).mock.calls[0][0]).toBe('fixed-core.exe');
  expect(job.attach).toHaveBeenCalledWith(1234, { creation: '639269400760538180', parent: process.pid });
  expect(job.authorize.mock.calls[0][0].kind).toBe('task'); expect(validate).toHaveBeenCalled();
});
test('a finite runner completed during admission retains its output and cleanup authority', async () => {
  job.authorize.mockImplementation(async (launch: { kind?: string }, validate: () => void) => {
    expect(launch.kind).toBe('task'); validate();
    child.stdout.emit('data', Buffer.from('# pass 1\n# fail 0\n'));
    child.exitCode = 0; child.emit('close', 0);
    return 2345;
  });
  expect(await call('run')).toMatchObject({ success: true, running: false, exitCode: 0, summary: { passed: 1 }, cleanupPending: true });
  expect(job.stop).not.toHaveBeenCalled();
  expect(await call('stop')).toMatchObject({ success: true, cleanupPending: false });
});
test('natural leader close preserves Job authority and Stop failure remains visible/retryable', async () => {
  await call('run'); child.stdout.emit('data', Buffer.from('# pass 1\n# fail 0\n')); child.exitCode = 0; child.emit('close', 0);
  expect(await call('state')).toMatchObject({ running: false, cleanupPending: true, exitCode: 0, summary: { passed: 1 } });
  job.stop.mockRejectedValueOnce(new Error('Remaining Job members unconfirmed'));
  expect(await call('stop')).toMatchObject({ success: false, running: false, cleanupPending: true, error: expect.stringContaining('unconfirmed') });
  expect(await call('stop')).toMatchObject({ success: true, cleanupPending: false }); expect(job.stop).toHaveBeenCalledTimes(2);
});
test('Stop during pending Job ready forbids project execution', async () => {
  const ready = deferred(); job.ready = ready.promise;
  const starting = call('run'); await attached.promise; expect((await call('state')).running).toBe(true);
  const stopped = await call('stop'); ready.resolve(); expect((await starting).success).toBe(false);
  expect(stopped.success).toBe(true); expect(job.authorize).not.toHaveBeenCalled();
});
test('pending listener reserves the live cap and global cleanup prevents a later spawn', async () => {
  const listening = deferred(); job.listening = listening.promise;
  const starting = call('run'); expect((await call('run')).error).toMatch(/current test/);
  await stopWorkspaceTestRuns(); listening.resolve(); expect((await starting).success).toBe(false);
  expect(spawn).not.toHaveBeenCalled(); expect(job.authorize).not.toHaveBeenCalled();
});
test('sender/root/runtime validation is checked after pending readiness before GO', async () => {
  const ready = deferred(); job.ready = ready.promise; let current = true;
  const starting = performWorkspaceTests({ root, action: 'run', file }, () => { if (!current) throw new Error('closed frame'); });
  await attached.promise; current = false; ready.resolve(); expect((await starting).error).toMatch(/closed frame/); expect(job.authorize).not.toHaveBeenCalled();
});
test('final GO validation blocks a sender change during asynchronous membership verification', async () => {
  const checking = deferred(), membership = deferred(); let current = true, executed = false;
  job.authorize.mockImplementation(async (_launch: unknown, validate: () => void) => { checking.resolve(); await membership.promise; validate(); executed = true; return 2345; });
  const starting = performWorkspaceTests({ root, action: 'run', file }, () => { if (!current) throw new Error('closed frame'); });
  await checking.promise; current = false; membership.resolve(); expect((await starting).success).toBe(false); expect(executed).toBe(false);
});
test('removed canonical test file during readiness cannot be executed', async () => {
  const ready = deferred(); job.ready = ready.promise;
  const starting = call('run'); await attached.promise; fs.unlinkSync(file); ready.resolve(); expect((await starting).success).toBe(false);
  expect(job.authorize).not.toHaveBeenCalled();
});
test('unknown startup identity blocks execution and independently cleans held core even if Job Stop refuses', async () => {
  (workspacePtyLifecycle.capture as jest.Mock).mockResolvedValue(undefined); job.stop.mockRejectedValueOnce(new Error('Job unavailable'));
  expect(await call('run')).toMatchObject({ success: false, cleanupPending: true });
  expect(job.authorize).not.toHaveBeenCalled(); expect(stopWorkspaceChild).toHaveBeenCalledWith(child);
  expect((await call('stop')).cleanupPending).toBe(false);
});
test('same-root replacement cannot discard a failed pending Job without a core child', async () => {
  job.listening = Promise.reject(new Error('listener unavailable')); job.stop.mockRejectedValue(new Error('Job still retained'));
  expect((await call('run')).cleanupPending).toBe(true);
  expect((await call('run')).success).toBe(false); expect(createPendingWorkspaceWindowsJob).toHaveBeenCalledTimes(1); expect(spawn).not.toHaveBeenCalled();
});
