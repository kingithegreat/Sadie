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
  const app = { process: () => child, evaluate: jest.fn().mockResolvedValueOnce(monitor.info).mockImplementation(async (run: Function) => String(run).includes('setImmediate') ? undefined : production), close: jest.fn(async () => {}) } as any;
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
  const f = fixture(); f.monitor.verify.mockResolvedValue(false);
  await prepareElectronShutdown(f.app, '/owned/index.js'); f.finish({ code: 0 });
  await expect(closeElectronApp(f.app)).rejects.toThrow(/owned processes remain alive/);
  expect(f.monitor.cleanup).toHaveBeenCalled();
  const receipt = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]); expect(receipt.graceful).toBe(false);
});
