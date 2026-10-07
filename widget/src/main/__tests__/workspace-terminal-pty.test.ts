jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFile: jest.fn((_file, _args, _options, done) => done(null)) }));
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { WorkspacePtySessions } from '../workspace-terminal-pty';
import { ownedWindowsPty } from '../workspace-pty-native-adapter';
import { setWorkspaceRuntimeClosing } from '../workspace-runtime-admission';
import type { WorkspacePtyStopResult } from '../workspace-pty-force-stop';
import type { WorkspacePtyIdentity } from '../workspace-pty-identity';
const windowsTest = process.platform === 'win32' ? test : test.skip;
jest.setTimeout(15_000);
let folder: string;
beforeEach(() => { folder = fs.mkdtempSync(path.join(os.homedir(), 'homebot-pty-')); });
afterEach(() => { setWorkspaceRuntimeClosing(false); jest.useRealTimers(); fs.rmSync(folder, { recursive: true, force: true }); });
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function setup(autoExit = true, confirmed = true, captured?: { original: WorkspacePtyIdentity | null | undefined }) {
  let data!: (text: string) => void; let exit!: (event: { exitCode: number }) => void;
  const disposeData = jest.fn(); const disposeExit = jest.fn();
  let hasExited = false;
  const pty = { pid: 12345, write: jest.fn(), resize: jest.fn(), kill: jest.fn(() => { if (autoExit && !hasExited) exit({ exitCode: 0 }); }), onData: jest.fn(fn => { data = fn; return { dispose: disposeData }; }), onExit: jest.fn(fn => { exit = event => { hasExited = true; fn(event); }; return { dispose: disposeExit }; }) };
  const spawn = jest.fn((_file: string, _args: string[], _options: any) => pty).mockImplementationOnce(() => pty);
  spawn.mockImplementation(() => {
    let ownedExit!: (event: { exitCode: number }) => void;
    return { ...pty, kill: jest.fn(() => ownedExit({ exitCode: 0 })), onExit: jest.fn(fn => { ownedExit = fn; return { dispose: jest.fn() }; }) };
  });
  const stopped = jest.fn(async () => confirmed);
  const force = jest.fn(async (_pid: number, _identity: unknown, _receipt?: unknown): Promise<WorkspacePtyStopResult> => ({ stopped: true, attempted: true, receipt: [{ pid: 12345, creation: '638953000000000000', parent: process.pid }] }));
  const capture = jest.fn(async () => captured ? captured.original : { creation: '638953000000000000', parent: process.pid });
  const manager = new WorkspacePtySessions(spawn, () => [{ id: 'cmd', label: 'Command Prompt', executable: 'cmd.exe' }], { capture, stopped }, force);
  const events = jest.fn(); const session = await manager.create(7, { projectDir: folder, profileId: 'cmd' }, events);
  return { pty, spawn, manager, session, events, data, exit, disposeData, disposeExit, stopped, force, capture };
}
test('stdin, resize and interrupt route only to the owned real PTY interface', async () => {
  const app = await setup();
  expect(app.spawn).toHaveBeenCalledWith('cmd.exe', ['/D'], expect.objectContaining({ cwd: folder, cols: 100, rows: 30 }));
  expect(app.spawn.mock.calls[0][2]).toMatchObject({ useConptyDll: false });
  app.manager.write(7, app.session.sessionId, 'answer\r'); app.manager.interrupt(7, app.session.sessionId); app.manager.resize(7, app.session.sessionId, 120, 40);
  expect(app.pty.write.mock.calls).toEqual([['answer\r'], ['\x03']]); expect(app.pty.resize).toHaveBeenCalledWith(120, 40);
  expect(() => app.manager.write(8, app.session.sessionId, 'bad')).toThrow(/different window/);
  expect(() => app.manager.resize(7, app.session.sessionId, 10000, 0)).toThrow(/Terminal size/);
  await app.manager.close(7, app.session.sessionId);
});

test('a delayed exit callback cannot claim Close succeeded or trigger a raw PID kill', async () => {
  jest.useFakeTimers();
  const app = await setup(false, false);
  const refusal = expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/retained/);
  await jest.advanceTimersByTimeAsync(5500); await refusal;
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
  expect(require('child_process').execFile).not.toHaveBeenCalledWith('taskkill.exe', expect.anything(), expect.anything(), expect.anything());
  expect(app.disposeExit).not.toHaveBeenCalled();
  app.stopped.mockResolvedValue(true); app.exit({ exitCode: 0 }); await app.manager.close(7, app.session.sessionId);
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test('an exit notification without native identity disappearance refuses Close and can be retried', async () => {
  const app = await setup(true, false);
  await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/could not be confirmed/);
  app.stopped.mockResolvedValue(true);
  await app.manager.close(7, app.session.sessionId);
  expect(app.stopped).toHaveBeenCalledWith(12345, { creation: '638953000000000000', parent: process.pid });
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
});

test('recovery retains failed Close evidence and transcript, scoped to owner and original project', async () => {
  const app = await setup(true, false);
  app.data('important terminal output\r\n');
  const other = fs.mkdtempSync(path.join(os.homedir(), 'homebot-pty-other-'));
  try {
    await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/could not be confirmed/);
    expect(await app.manager.list(8, folder)).toEqual([]);
    expect(await app.manager.list(7, other)).toEqual([]);
    const [retained] = await app.manager.list(7, folder);
    expect(retained).toMatchObject({ sessionId: app.session.sessionId, output: 'important terminal output\r\n', exited: true, exitCode: 0, closeError: expect.stringMatching(/could not be confirmed/) });
    retained.output = 'renderer changed clone';
    expect((await app.manager.list(7, folder))[0].output).toBe('important terminal output\r\n');
    app.stopped.mockResolvedValue(true); await app.manager.close(7, app.session.sessionId);
    expect(await app.manager.list(7, folder)).toEqual([]);
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
});

test('recovery waits for an in-flight Close before deciding whether a session was retained', async () => {
  const app = await setup();
  let complete!: (value: boolean) => void;
  app.stopped.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const close = app.manager.close(7, app.session.sessionId);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(complete).toBeDefined();
  let recovered = false;
  const listing = app.manager.list(7, folder).then(result => { recovered = true; return result; });
  await Promise.resolve(); expect(recovered).toBe(false);
  complete(true); await close;
  expect(await listing).toEqual([]);
});

test.each(['owner', 'all'])('%s cleanup joins every terminal even when the first Close refuses', async action => {
  const app = await setup();
  const second = await app.manager.create(7, { projectDir: folder, profileId: 'cmd' }, jest.fn());
  let complete!: () => void;
  const close = jest.spyOn(app.manager, 'close').mockImplementation(async (_owner, id) => {
    if (id === app.session.sessionId) throw new Error('First terminal remains retained');
    await new Promise<void>(resolve => { complete = resolve; });
  });
  let settled = false;
  const cleanup = (action === 'owner' ? app.manager.closeOwner(7) : app.manager.closeAll()).finally(() => { settled = true; });
  const refusal = expect(cleanup).rejects.toThrow('First terminal remains retained');
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(close).toHaveBeenCalledWith(7, app.session.sessionId); expect(close).toHaveBeenCalledWith(7, second.sessionId);
  expect(settled).toBe(false); complete(); await refusal;
  expect(settled).toBe(true); close.mockRestore(); await app.manager.closeAll();
});

test('unproven force Stop keeps the live session and never reports successful Close', async () => {
  const app = await setup(true, false); app.force.mockResolvedValue({ stopped: false, attempted: false });
  await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/process-tree exit/);
  expect(app.pty.kill).not.toHaveBeenCalled();
  app.manager.write(7, app.session.sessionId, 'still available');
  expect(app.pty.write).toHaveBeenCalledWith('still available');
  app.force.mockResolvedValue({ stopped: true, attempted: false }); app.stopped.mockResolvedValue(true); await app.manager.close(7, app.session.sessionId);
});

windowsTest('unknown startup identity guides manual exit, stays writable and never recaptures a PID on Retry', async () => {
  const app = await setup(false, false, { original: undefined });
  app.force.mockResolvedValue({ stopped: false, attempted: false });
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/identity could not be verified at startup.*Nothing was stopped.*type exit/i);
  }
  expect(app.capture).toHaveBeenCalledTimes(1);
  expect(app.force).toHaveBeenLastCalledWith(12345, undefined, undefined);
  expect(app.pty.kill).not.toHaveBeenCalled();
  app.manager.write(7, app.session.sessionId, 'exit\r');
  expect(app.pty.write).toHaveBeenCalledWith('exit\r');
  app.exit({ exitCode: 0 }); app.stopped.mockResolvedValue(true);
  const forceCalls = app.force.mock.calls.length;
  await app.manager.close(7, app.session.sessionId);
  expect(app.force).toHaveBeenCalledTimes(forceCalls);
  expect(app.capture).toHaveBeenCalledTimes(1);
  expect(app.pty.kill).toHaveBeenCalledTimes(1); // Release only the exited PTY/worker.
  expect(() => app.manager.write(7, app.session.sessionId, 'after close')).toThrow(/has closed/);
});

test('initially missing process can close after disappearance without unknown-capture guidance', async () => {
  const app = await setup(true, true, { original: null });
  app.force.mockResolvedValue({ stopped: false, attempted: false });
  await app.manager.close(7, app.session.sessionId);
  expect(app.capture).toHaveBeenCalledTimes(1);
  expect(() => app.manager.write(7, app.session.sessionId, 'after close')).toThrow(/has closed/);
});

test('captured descendants remain recoverable after root exits during a partial Stop', async () => {
  const app = await setup();
  const receipt = [{ pid: 12345, creation: '638953000000000000', parent: process.pid }, { pid: 23456, creation: '638953000000000100', parent: 12345 }];
  app.force.mockImplementationOnce(async () => { app.exit({ exitCode: 1 }); return { stopped: false, attempted: true, receipt }; });
  await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/captured identities/);
  app.force.mockResolvedValue({ stopped: true, attempted: true, receipt });
  await app.manager.close(7, app.session.sessionId);
  expect(app.force).toHaveBeenLastCalledWith(12345, { creation: '638953000000000000', parent: process.pid }, receipt);
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
});

test('natural root exit before any force effect does not create a permanent Close refusal', async () => {
  const app = await setup();
  app.force.mockImplementationOnce(async () => { app.exit({ exitCode: 0 }); return { stopped: false, attempted: false }; });
  await app.manager.close(7, app.session.sessionId);
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
});

test('corrupted force evidence cannot forget uncertainty after a later root exit', async () => {
  const app = await setup(); app.force.mockResolvedValue({ stopped: false, attempted: true });
  await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/Stop evidence was corrupted or lost/);
  app.exit({ exitCode: 1 });
  await expect(app.manager.close(7, app.session.sessionId)).rejects.toThrow(/evidence was corrupted or lost/);
});
test('natural exit releases listeners/ConPTY exactly once; Close does not kill a reused PID', async () => {
  const app = await setup(); app.data('ready'); app.exit({ exitCode: 0 });
  expect(app.events).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'exit', exitCode: 0 }));
  expect(app.disposeData).toHaveBeenCalledTimes(1); expect(app.disposeExit).toHaveBeenCalledTimes(1);
  const kills = app.pty.kill.mock.calls.length;
  expect(kills).toBe(process.platform === 'win32' ? 1 : 0);
  expect(() => app.manager.write(7, app.session.sessionId, 'x')).toThrow(/exited/);
  await app.manager.close(7, app.session.sessionId);
  expect(app.pty.kill).toHaveBeenCalledTimes(kills); expect(app.disposeData).toHaveBeenCalledTimes(1);
});
test('profile selection and session/input/output bounds reject invalid requests', async () => {
  const app = await setup();
  expect(() => app.manager.create(7, { projectDir: folder, profileId: 'renderer-supplied-command' }, jest.fn())).toThrow(/profile/);
  expect(() => app.manager.write(7, app.session.sessionId, 'x'.repeat(65537))).toThrow(/too large/);
  app.data('x'.repeat(50000));
  expect(app.events.mock.calls.filter(c => c[0].type === 'data')).toHaveLength(4);
  for (let i = 0; i < 3; i++) await app.manager.create(7, { projectDir: folder }, jest.fn());
  expect(() => app.manager.create(7, { projectDir: folder }, jest.fn())).toThrow(/maximum four/);
  await app.manager.closeOwner(7);
});

function startup() {
  const ready = deferred(); const workerExit = deferred(); const killed = deferred();
  const exitListeners = new Set<(event: { exitCode: number }) => void>();
  const pty = { pid: 0, ready: ready.promise, write: jest.fn(), resize: jest.fn(),
    kill: jest.fn(() => { for (const emitExit of [...exitListeners]) emitExit({ exitCode: 0 }); killed.resolve(); return workerExit.promise; }),
    onData: jest.fn(() => ({ dispose: jest.fn() })),
    onExit: jest.fn(fn => { exitListeners.add(fn); return { dispose: jest.fn(() => exitListeners.delete(fn)) }; }),
  };
  const capture = jest.fn(async () => ({ creation: '638953000000000000', parent: process.pid }));
  const stopped = jest.fn(async () => true);
  const force = jest.fn(async (): Promise<WorkspacePtyStopResult> => ({ stopped: true, attempted: false }));
  const manager = new WorkspacePtySessions(() => pty, () => [{ id: 'cmd', label: 'Command Prompt', executable: 'cmd.exe' }], { capture, stopped }, force);
  const create = () => manager.create(7, { projectDir: folder }, jest.fn());
  const connected = () => { pty.pid = 12345; ready.resolve(); };
  return { manager, create, connected, pty, ready, killed, workerExit, capture, stopped, force };
}

test('startup reserves all four slots, waits for positive PID and LIST waits for that same project creation', async () => {
  const app = startup();
  const creations = Array.from({ length: 4 }, () => app.create());
  expect(() => app.create()).toThrow(/maximum four/);
  expect(app.capture).not.toHaveBeenCalled();
  let listed = false;
  const listing = app.manager.list(7, folder).then(value => { listed = true; return value; });
  await Promise.resolve(); expect(listed).toBe(false);
  expect(await app.manager.list(8, folder)).toEqual([]);
  app.connected(); const sessions = await Promise.all(creations);
  expect((await listing).map(s => s.sessionId)).toEqual(sessions.map(s => s.sessionId));
  expect(app.capture).toHaveBeenCalledTimes(4);
  expect(app.capture).toHaveBeenCalledWith(12345);
  app.workerExit.resolve(); await app.manager.closeAll();
});

test.each(['owner', 'all'])('%s close joins pending startup and actual worker release, not just shell exit', async action => {
  const app = startup(); const creating = app.create();
  let closed = false;
  const closing = (action === 'owner' ? app.manager.closeOwner(7) : app.manager.closeAll()).then(() => { closed = true; });
  app.connected(); await creating; await app.killed.promise;
  expect(closed).toBe(false); expect(app.pty.kill).toHaveBeenCalledTimes(1);
  app.workerExit.resolve(); await closing;
  expect(await app.manager.list(7, folder)).toEqual([]);
});

test('quit admission closing during startup never publishes a ghost session or captures PID zero', async () => {
  const app = startup(); const creating = app.create();
  const refusal = expect(creating).rejects.toThrow(/closing/);
  setWorkspaceRuntimeClosing(true);
  expect(() => app.create()).toThrow(/closing/);
  const closing = app.manager.closeAll();
  app.connected(); await app.killed.promise;
  expect(app.capture).toHaveBeenCalledWith(12345);
  expect(app.capture).not.toHaveBeenCalledWith(0);
  if (process.platform === 'win32') expect(app.force).toHaveBeenCalledWith(12345, { creation: '638953000000000000', parent: process.pid }, undefined);
  app.workerExit.resolve(); await refusal; await closing;
  expect(await app.manager.list(7, folder)).toEqual([]);
});

test('failed startup retains its held worker until bounded release succeeds, without a PID stop sweep', async () => {
  jest.useFakeTimers();
  const app = startup(); const creating = app.create();
  const refusal = expect(creating).rejects.toThrow(/worker release could not be confirmed/);
  app.ready.reject(new Error('native readiness failed'));
  await jest.advanceTimersByTimeAsync(5500); await refusal;
  expect(app.capture).not.toHaveBeenCalled(); expect(app.force).not.toHaveBeenCalled();
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
  let closed = false;
  const closing = app.manager.closeAll().then(() => { closed = true; });
  await jest.advanceTimersByTimeAsync(0); expect(closed).toBe(false);
  app.workerExit.resolve(); await closing;
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
});

test('readiness without a positive shell PID rejects only after releasing the startup worker', async () => {
  const app = startup(); const creating = app.create();
  const refusal = expect(creating).rejects.toThrow(/valid shell process/);
  app.ready.resolve(); await app.killed.promise;
  expect(app.capture).not.toHaveBeenCalled(); expect(app.force).not.toHaveBeenCalled();
  app.workerExit.resolve(); await refusal;
});

test('active Close times out on a retained worker and Retry joins its original release', async () => {
  jest.useFakeTimers();
  const app = startup(); app.connected(); const session = await app.create();
  const refusal = expect(app.manager.close(7, session.sessionId)).rejects.toThrow(/worker release could not be confirmed/);
  await jest.advanceTimersByTimeAsync(5500); await refusal;
  expect((await app.manager.list(7, folder))[0]).toMatchObject({ sessionId: session.sessionId, closeError: expect.stringMatching(/worker release/) });
  const retry = app.manager.close(7, session.sessionId);
  app.workerExit.resolve(); await retry;
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
  expect(await app.manager.list(7, folder)).toEqual([]);
});

windowsTest('natural exit joins exactly one pending ConPTY release and preserves the transcript until worker exit', async () => {
  const app = await setup(); const workerExit = deferred();
  app.pty.kill.mockImplementation(() => workerExit.promise as any);
  app.data('completed output'); app.exit({ exitCode: 0 });
  expect((await app.manager.list(7, folder))[0]).toMatchObject({ exited: true, output: 'completed output' });
  let closed = false; const closing = app.manager.close(7, app.session.sessionId).then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false);
  expect(app.pty.kill).toHaveBeenCalledTimes(1);
  workerExit.resolve(); await closing;
  expect(app.pty.kill).toHaveBeenCalledTimes(1); expect(app.force).not.toHaveBeenCalled();
});

test('native adapter awaits the captured Worker exit and cancels only its held pending connection', async () => {
  const worker = Object.assign(new EventEmitter(), { threadId: 17 });
  const ready = new EventEmitter(); const native = new EventEmitter() as any;
  native.pid = 0; native._pty = 42;
  native.write = jest.fn(); native.resize = jest.fn(); native.onData = jest.fn(); native.onExit = jest.fn();
  const dispose = jest.fn(); const clearTimeout = jest.fn();
  native._agent = { innerPid: 0, onError: (callback: (error: Error) => void) => { native.on('agent-error', callback); return { dispose: () => native.off('agent-error', callback) }; }, _pendingPtyInfo: { pty: 42 }, _clearConnectionTimeout: clearTimeout,
    _inSocket: { destroy: jest.fn() }, _outSocket: { destroy: jest.fn() },
    _conoutSocketWorker: { _worker: worker, dispose, onReady: (callback: () => void) => { ready.on('ready', callback); return { dispose: () => ready.off('ready', callback) }; } },
  };
  const binding = { kill: jest.fn() }; const adapter = ownedWindowsPty(native, binding);
  native._agent.innerPid = 222; ready.emit('ready'); await adapter.ready;
  expect(native.pid).toBe(0); expect(adapter.pid).toBe(222);
  const replacement = new EventEmitter(); native._agent._conoutSocketWorker._worker = replacement;
  let released = false; const release = Promise.resolve(adapter.kill()).then(() => { released = true; });
  expect(binding.kill).toHaveBeenCalledWith(42, false); expect(dispose).toHaveBeenCalledTimes(1);
  expect(clearTimeout).toHaveBeenCalledTimes(1); expect(native._agent._pendingPtyInfo).toBeUndefined();
  replacement.emit('exit', 0); await Promise.resolve(); expect(released).toBe(false);
  worker.emit('exit', 0); await release; await adapter.kill();
  expect(binding.kill).toHaveBeenCalledTimes(1); expect(dispose).toHaveBeenCalledTimes(1);
});

test('native startup failure rejects readiness and still waits for that worker to exit', async () => {
  const worker = Object.assign(new EventEmitter(), { threadId: 17 }); const native = new EventEmitter() as any;
  native.pid = 0; native._pty = 42; native.write = jest.fn(); native.resize = jest.fn(); native.onData = jest.fn(); native.onExit = jest.fn();
  native._agent = { innerPid: 0, _pendingPtyInfo: { pty: 42 }, _clearConnectionTimeout: jest.fn(),
    onError: (callback: (error: Error) => void) => { native.on('agent-error', callback); return { dispose: () => native.off('agent-error', callback) }; },
    _inSocket: { destroy: jest.fn() }, _outSocket: { destroy: jest.fn() },
    _conoutSocketWorker: { _worker: worker, dispose: jest.fn(), onReady: () => ({ dispose: jest.fn() }) },
  };
  const binding = { kill: jest.fn() }; const adapter = ownedWindowsPty(native, binding);
  const refusal = expect(adapter.ready).rejects.toThrow('Worker startup failed');
  native.emit('agent-error', new Error('Worker startup failed')); await refusal;
  let released = false; const releasing = Promise.resolve(adapter.kill()).then(() => { released = true; });
  await Promise.resolve(); expect(released).toBe(false);
  expect(native._agent._inSocket.destroy).toHaveBeenCalledTimes(1); expect(native._agent._outSocket.destroy).toHaveBeenCalledTimes(1);
  worker.emit('exit', 0); await releasing;
  expect(binding.kill).toHaveBeenCalledWith(42, false);
});
