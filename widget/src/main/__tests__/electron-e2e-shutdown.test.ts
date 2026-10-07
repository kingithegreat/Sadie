import { EventEmitter } from 'events';
import fs from 'fs';
import { prepareElectronShutdown, closeElectronApp, closeRemainingElectronApps, CLOSE_BUDGET_MS } from '../../renderer/e2e/helpers/closeApp';
import { monitorNativeApp } from '../../renderer/e2e/helpers/nativeAppProcess';
jest.mock('../../renderer/e2e/helpers/nativeAppProcess', () => ({ monitorNativeApp: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), mkdirSync: jest.fn(), writeFileSync: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
function fixture() {
  let finish!: (result: { code: number }) => void;
  const nativeExit = new Promise<{ code: number }>(resolve => { finish = resolve; });
  const child = Object.assign(new EventEmitter(), { pid: 200, kill: jest.fn(), stderr: new EventEmitter(), stdout: new EventEmitter() });
  const tree = [{ pid: 100, parent: 200, creation: '639269214771582930' }, { pid: 300, parent: 100, creation: '639269214771583030' }];
  const monitor = { info: { pid: 100, ppid: 200, execPath: 'electron.exe' }, creation: tree[0].creation, exit: nativeExit, snapshot: jest.fn(async () => tree), verify: jest.fn(async () => true), cleanup: jest.fn(async () => { finish({ code: 1 }); return { stopped: true, attempted: true, receipt: tree }; }), dispose: jest.fn() };
  (monitorNativeApp as jest.Mock).mockResolvedValue(monitor);
  const production = { helpers: [{ purpose: 'identity', error: { killed: true, signal: 'SIGTERM' }, duration: 1800, stdout: '' }], refusals: [{ message: 'A running IDE program could not be stopped.' }] };
  const app = Object.assign(new EventEmitter(), { process: () => child, evaluate: jest.fn().mockResolvedValueOnce(monitor.info).mockImplementation(async (run: Function) => String(run).includes('setImmediate') ? undefined : production), close: jest.fn(async () => {}) }) as any;
  return { app, child, monitor, tree, finish, production };
}
test('actual native exit precedes transport close; wrapper disappearance is not the oracle', async () => {
  const f = fixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  const closing = closeElectronApp(f.app);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(f.app.close).not.toHaveBeenCalled();
  f.finish({ code: 0 }); await closing;
  expect(f.app.close).toHaveBeenCalledTimes(1); expect(f.monitor.cleanup).not.toHaveBeenCalled(); expect(f.child.kill).not.toHaveBeenCalled();
  expect(f.monitor.dispose).toHaveBeenCalledTimes(1);
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]);
  expect(receipt).toMatchObject({ graceful: true, native: { pid: 100 }, launcherPid: 200, nativeExit: { code: 0 } });
});
test('native timeout preserves exact refusal/capture diagnostics and owned cleanup remains a test failure', async () => {
  jest.useFakeTimers(); const f = fixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  f.child.stderr.emit('data', '[HomeBot-CATCH] actual shutdown reason');
  const failed = expect(closeElectronApp(f.app, 'refused')).rejects.toThrow(/graceful shutdown failed.*did not exit within close budget/);
  await jest.advanceTimersByTimeAsync(CLOSE_BUDGET_MS); await failed;
  expect(f.monitor.cleanup).toHaveBeenCalledWith(f.tree); expect(f.child.kill).not.toHaveBeenCalled();
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]);
  expect(receipt).toMatchObject({ graceful: false, production: f.production, stderr: '[HomeBot-CATCH] actual shutdown reason', cleanupExit: { code: 1 }, forcedOwnedCleanup: { stopped: true } });
});
test('a nonzero actual OS exit cannot pass even when the launcher and transport close', async () => {
  const f = fixture(); await prepareElectronShutdown(f.app, '/owned/index.js'); f.finish({ code: 1 });
  await expect(closeElectronApp(f.app)).rejects.toThrow(/nonzero OS code/);
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]); expect(receipt.graceful).toBe(false);
});
test('cleanup uncertainty is retained and never downgraded to a successful teardown', async () => {
  jest.useFakeTimers(); const f = fixture(); f.monitor.cleanup.mockRejectedValue(new Error('captured descendant still alive'));
  await prepareElectronShutdown(f.app, '/owned/index.js');
  const failed = expect(closeElectronApp(f.app)).rejects.toThrow(/graceful shutdown failed/);
  await jest.advanceTimersByTimeAsync(CLOSE_BUDGET_MS); await failed;
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]); expect(receipt.cleanupError).toContain('captured descendant still alive'); expect(receipt.graceful).toBe(false);
  expect(f.child.kill).not.toHaveBeenCalled();
});
test('afterEach closes apps left by an assertion or skip and repeated explicit close is idempotent', async () => {
  const f = fixture(); await prepareElectronShutdown(f.app, '/owned/index.js'); f.finish({ code: 0 });
  await closeRemainingElectronApps(); await closeElectronApp(f.app);
  expect(f.app.close).toHaveBeenCalledTimes(1); expect(f.monitor.cleanup).not.toHaveBeenCalled();
});
test('native main exit zero cannot hide an owned descendant that remains alive', async () => {
  jest.useFakeTimers();
  const f = fixture(); f.monitor.verify.mockResolvedValue(false);
  await prepareElectronShutdown(f.app, '/owned/index.js'); f.finish({ code: 0 });
  const failed = expect(closeElectronApp(f.app)).rejects.toThrow(/owned processes remain alive/);
  await jest.advanceTimersByTimeAsync(CLOSE_BUDGET_MS); await failed;
  expect(f.monitor.cleanup).toHaveBeenCalled();
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]); expect(receipt.graceful).toBe(false);
});
test('asynchronous captured child exit settles within the unchanged close budget without force cleanup', async () => {
  jest.useFakeTimers(); const f = fixture(); f.monitor.verify.mockResolvedValueOnce(false).mockResolvedValue(true);
  await prepareElectronShutdown(f.app, '/owned/index.js'); f.finish({ code: 0 });
  const closed = closeElectronApp(f.app); await jest.advanceTimersByTimeAsync(200); await closed;
  expect(f.monitor.verify).toHaveBeenCalledTimes(2); expect(f.monitor.cleanup).not.toHaveBeenCalled();
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]); expect(receipt.graceful).toBe(true); expect(receipt.elapsed).toBeLessThan(CLOSE_BUDGET_MS);
});
test('apps using direct close leave no pending cleanup after both actual exit and transport close', async () => {
  const f = fixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  f.finish({ code: 0 }); await Promise.resolve(); f.app.emit('close');
  await closeRemainingElectronApps(); expect(f.app.close).not.toHaveBeenCalled();
  await closeElectronApp(f.app); // The cached OS oracle remains available.
  expect(f.monitor.cleanup).not.toHaveBeenCalled();
});
test('direct close with nonzero native exit stays pending so afterEach rejects it', async () => {
  const f = fixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  f.finish({ code: 1 }); await Promise.resolve(); f.app.emit('close');
  await expect(closeRemainingElectronApps()).rejects.toThrow(/nonzero OS code/);
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]); expect(receipt.graceful).toBe(false);
});
test('snapshot disappearance waits for the original held OS exit receipt, never a guessed PID', async () => {
  const f = fixture(); f.monitor.snapshot.mockImplementation(async () => { f.finish({ code: 0 }); throw new Error('main disappeared before snapshot'); });
  await prepareElectronShutdown(f.app, '/owned/index.js'); await closeElectronApp(f.app);
  expect(f.monitor.cleanup).not.toHaveBeenCalled(); expect(f.child.kill).not.toHaveBeenCalled();
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]);
  expect(receipt).toMatchObject({ graceful: true, verificationScope: 'native-main', nativeExit: { code: 0 } }); expect(receipt.snapshotFailure).toContain('main disappeared');
});
test('native exit diagnostics survive main teardown without relying on a disposed evaluate transport', async () => {
  const f = fixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  const diagnostic = { helpers: [{ purpose: 'identity', duration: 1800, error: { killed: true }, stdout: '' }], refusals: [] };
  f.child.stdout.emit('data', '[E2E-SHUTDOWN-DIAGNOSTIC] ' + JSON.stringify(diagnostic) + '\n'); f.finish({ code: 0 });
  await closeElectronApp(f.app);
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]); expect(receipt.productionAtExit).toEqual(diagnostic);
});

test.each([0, 1])('destroyed evaluation context waits for the same held native exit code %i', async code => {
  const f = fixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  f.app.evaluate.mockImplementationOnce(async () => {
    setTimeout(() => f.finish({ code }), 5);
    throw new Error('electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.');
  });
  const closed = closeElectronApp(f.app);
  if (code === 0) {
    await closed;
    expect(f.monitor.cleanup).not.toHaveBeenCalled();
    expect(f.monitor.verify).toHaveBeenCalledWith(f.tree);
  } else await expect(closed).rejects.toThrow(/nonzero OS code/);
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]);
  expect(receipt.nativeExit).toMatchObject({ code });
  expect(receipt.driverTeardownErrors).toEqual([expect.stringContaining('Execution context was destroyed')]);
  expect(receipt.graceful).toBe(code === 0);
});

test('destroyed context without qualified exit remains a timeout and never passes through cleanup', async () => {
  jest.useFakeTimers(); const f = fixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  f.app.evaluate.mockRejectedValue(new Error('Execution context was destroyed'));
  const failed = expect(closeElectronApp(f.app)).rejects.toThrow(/Native evaluation exceeded close budget/);
  await jest.advanceTimersByTimeAsync(CLOSE_BUDGET_MS); await failed;
  expect(f.monitor.cleanup).toHaveBeenCalledWith(f.tree);
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]);
  expect(receipt.graceful).toBe(false); expect(receipt.cleanupExit).toMatchObject({ code: 1 });
});

test('unrelated evaluation errors remain failures even if native cleanup succeeds', async () => {
  const f = fixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  f.app.evaluate.mockRejectedValueOnce(new Error('application diagnostic failed'));
  await expect(closeElectronApp(f.app)).rejects.toThrow(/application diagnostic failed/);
  expect(f.monitor.cleanup).toHaveBeenCalledWith(f.tree);
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]);
  expect(receipt.graceful).toBe(false); expect(receipt.driverTeardownErrors).toBeUndefined();
});

function inspectorFixture() {
  const f = fixture();
  const socket = { readyState: 1, terminate: jest.fn(() => { socket.readyState = 3; f.finish({ code: 0 }); }) };
  const connection = { _closed: false, rootSession: {}, close: jest.fn(), _transport: { _ws: socket } };
  const impl = { process: () => f.child, _nodeConnection: connection, _nodeSession: connection.rootSession };
  f.app._connection = { toImpl: () => impl };
  const exiting = (qualified = true, stderrWait = true) => {
    const nonce = f.app.evaluate.mock.calls[0][1];
    f.child.stdout.emit('data', '[E2E-SHUTDOWN-DIAGNOSTIC] ' + JSON.stringify({ pid: f.monitor.info.pid, nonce: qualified ? nonce : 'another-app', helpers: [], refusals: [] }) + '\n');
    if (stderrWait) f.child.stderr.emit('data', 'Waiting for the debugger to disconnect...\r\n');
  };
  return { ...f, socket, connection, impl, exiting };
}
test.each([false, true])('qualified irreversible exit (stderr wait=%s) releases the held socket before public close can reenter quit', async stderrWait => {
  const f = inspectorFixture(); let nativeExited = false;
  f.socket.terminate.mockImplementation(() => { f.socket.readyState = 3; nativeExited = true; f.finish({ code: 0 }); });
  f.app.close.mockImplementation(async () => { expect(nativeExited).toBe(true); expect(f.monitor.verify).toHaveBeenCalled(); });
  await prepareElectronShutdown(f.app, '/owned/index.js'); f.exiting(true, stderrWait);
  f.app.evaluate.mockImplementation(() => { throw new Error('Evaluation cannot run after irreversible exit'); });
  await closeElectronApp(f.app);
  expect(f.app.close).toHaveBeenCalledTimes(1); expect(f.socket.terminate).toHaveBeenCalledTimes(1); expect(f.monitor.cleanup).not.toHaveBeenCalled();
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]);
  expect(receipt).toMatchObject({ graceful: true, nativeExit: { code: 0 }, inspectorQualification: { mainPid: 100, matchingExitNonce: true, stderrWaitObserved: stderrWait }, capturedIdentitiesGone: true });
});

test.each(['diagnostics', 'quit'])('qualified exit during pending %s evaluation releases inspector without waiting for that evaluation', async stage => {
  const f = inspectorFixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  const callsBeforeClose = f.app.evaluate.mock.calls.length;
  f.app.evaluate.mockImplementation((fn: unknown) => {
    if (stage === 'quit' && !String(fn).includes('setImmediate')) return Promise.resolve({ helpers: [], refusals: [] });
    f.exiting(true, false);
    return new Promise(() => {});
  });
  await closeElectronApp(f.app);
  expect(f.app.evaluate).toHaveBeenCalledTimes(callsBeforeClose + (stage === 'quit' ? 2 : 1));
  expect(f.socket.terminate).toHaveBeenCalledTimes(1); expect(f.monitor.cleanup).not.toHaveBeenCalled();
  expect(f.monitor.verify).toHaveBeenCalled();
});
test.each([false, true])('qualified exit (stderr wait=%s) releases only the held inspector websocket and still requires actual OS0', async stderrWait => {
  const f = inspectorFixture(); await prepareElectronShutdown(f.app, '/owned/index.js'); f.exiting(true, stderrWait);
  await closeElectronApp(f.app);
  expect(f.socket.terminate).toHaveBeenCalledTimes(1); expect(f.child.kill).not.toHaveBeenCalled(); expect(f.monitor.cleanup).not.toHaveBeenCalled();
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]); expect(receipt).toMatchObject({ graceful: true, nativeExit: { code: 0 }, ownedInspectorSocketTerminated: true, inspectorQualification: { stderrWaitObserved: stderrWait }, capturedIdentitiesGone: true });
});
test.each(['missing', 'foreign-nonce', 'foreign-pid'].flatMap(kind => [false, true].map(stderrWait => ({ kind, stderrWait }))))('invalid $kind exit marker (stderr wait=$stderrWait) cannot detach or close the driver early', async ({ kind, stderrWait }) => {
  const f = inspectorFixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  if (kind === 'foreign-nonce') f.exiting(false, stderrWait);
  else {
    if (kind === 'foreign-pid') f.child.stdout.emit('data', '[E2E-SHUTDOWN-DIAGNOSTIC] ' + JSON.stringify({ pid: 101, nonce: f.app.evaluate.mock.calls[0][1], helpers: [], refusals: [] }) + '\n');
    if (stderrWait) f.child.stderr.emit('data', 'Waiting for the debugger to disconnect...\r\n');
  }
  const closing = closeElectronApp(f.app); await new Promise<void>(resolve => setImmediate(resolve));
  expect(f.socket.terminate).not.toHaveBeenCalled(); expect(f.app.close).not.toHaveBeenCalled();
  f.finish({ code: 0 }); await closing; expect(f.socket.terminate).not.toHaveBeenCalled();
});
test('an unaudited driver version cannot enable qualified inspector detachment', async () => {
  const packageInfo = require('playwright-core/package.json'), version = packageInfo.version;
  try {
    packageInfo.version = '999.0.0';
    const f = inspectorFixture(); await prepareElectronShutdown(f.app, '/owned/index.js'); f.exiting(true, false);
    await expect(closeElectronApp(f.app)).rejects.toThrow('owned transport could not be verified');
    expect(f.socket.terminate).not.toHaveBeenCalled();
  } finally { packageInfo.version = version; }
});
test('a changed inspector socket is rejected even when a qualified process exit marker arrives', async () => {
  const f = inspectorFixture(); await prepareElectronShutdown(f.app, '/owned/index.js');
  const otherSocket = { readyState: 1, terminate: jest.fn() }; f.connection._transport._ws = otherSocket;
  f.exiting(true, false); await expect(closeElectronApp(f.app)).rejects.toThrow('inspector identity changed');
  expect(f.socket.terminate).not.toHaveBeenCalled(); expect(otherSocket.terminate).not.toHaveBeenCalled();
});
test('inspector detachment never converts a nonzero native exit into a passing close', async () => {
  const f = inspectorFixture(); f.socket.terminate.mockImplementation(() => { f.finish({ code: 1 }); });
  await prepareElectronShutdown(f.app, '/owned/index.js'); f.exiting(true, false);
  await expect(closeElectronApp(f.app)).rejects.toThrow('nonzero OS code');
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]); expect(receipt.graceful).toBe(false);
});
