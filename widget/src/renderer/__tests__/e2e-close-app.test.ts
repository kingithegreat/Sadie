import { EventEmitter } from 'events';
import fs from 'fs';
import { closeElectronApp, prepareElectronShutdown, CLOSE_BUDGET_MS } from '../e2e/helpers/closeApp';
import { monitorNativeApp, type NativeAppExit } from '../e2e/helpers/nativeAppProcess';

jest.mock('../e2e/helpers/nativeAppProcess', () => ({ monitorNativeApp: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), mkdirSync: jest.fn(), writeFileSync: jest.fn() }));

/** These fixture controls exercise the helper contract, not native Electron. */
describe('closeElectronApp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  function fixture() {
    let finish!: (result: NativeAppExit) => void;
    const exit = new Promise<NativeAppExit>(resolve => { finish = resolve; });
    const child = Object.assign(new EventEmitter(), {
      pid: 200, kill: jest.fn(), stderr: new EventEmitter(), stdout: new EventEmitter(),
    });
    const tree = [{ pid: 100, parent: 200, creation: '639269214771582930' }];
    const monitor = {
      info: { pid: 100, ppid: 200, execPath: 'electron.exe' }, creation: tree[0].creation, exit,
      snapshot: jest.fn(async () => tree), verify: jest.fn(async () => true),
      cleanup: jest.fn(async () => { finish({ code: 1 }); return { stopped: true, receipt: tree }; }),
      dispose: jest.fn(),
    };
    (monitorNativeApp as jest.Mock).mockResolvedValue(monitor);
    const app = Object.assign(new EventEmitter(), {
      process: () => child,
      evaluate: jest.fn().mockResolvedValueOnce(monitor.info).mockResolvedValue({ helpers: [], refusals: [] }),
      close: jest.fn(async () => {}),
    }) as unknown as Parameters<typeof closeElectronApp>[0];
    return { app, child, monitor, tree, finish };
  }

  function finalReceipt(): Record<string, unknown> {
    return JSON.parse((fs.writeFileSync as jest.Mock).mock.calls.at(-1)[1]);
  }

  it('waits for prepared actual-main exit, verifies identities, then closes transport without force cleanup', async () => {
    const f = fixture();
    await prepareElectronShutdown(f.app, '/owned/index.js');
    const closing = closeElectronApp(f.app);
    await Promise.resolve(); await Promise.resolve();
    expect(f.app.close).not.toHaveBeenCalled();
    f.finish({ code: 0 });
    const elapsed = await closing;
    expect(elapsed).toBeLessThan(CLOSE_BUDGET_MS);
    expect(f.monitor.verify).toHaveBeenCalledTimes(1);
    expect(f.monitor.cleanup).not.toHaveBeenCalled();
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.app.close).toHaveBeenCalledTimes(1);
    expect(f.monitor.dispose).toHaveBeenCalledTimes(1);
    expect(finalReceipt()).toMatchObject({ graceful: true, native: { pid: 100 }, launcherPid: 200, nativeExit: { code: 0 } });
  });

  it('rejects an actual-main timeout even when owned cleanup succeeds, without killing the launcher', async () => {
    jest.useFakeTimers();
    const f = fixture();
    await prepareElectronShutdown(f.app, '/owned/index.js');
    const rejected = expect(closeElectronApp(f.app, 'stuck app')).rejects.toThrow(/graceful shutdown failed.*did not exit within close budget/);
    await jest.advanceTimersByTimeAsync(CLOSE_BUDGET_MS);
    await rejected;
    expect(f.monitor.cleanup).toHaveBeenCalledWith(f.tree);
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.monitor.dispose).toHaveBeenCalledTimes(1);
    expect(finalReceipt()).toMatchObject({ graceful: false, forcedOwnedCleanup: { stopped: true }, cleanupExit: { code: 1 } });
  });

  it('rejects missing launch authority and requests only normal quit and transport close', async () => {
    const f = fixture();
    await expect(closeElectronApp(f.app, 'unprepared app')).rejects.toThrow(/identity was not prepared at launch/);
    expect(monitorNativeApp).not.toHaveBeenCalled();
    expect(f.monitor.cleanup).not.toHaveBeenCalled();
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.app.evaluate).toHaveBeenCalledTimes(1);
    expect(f.app.close).toHaveBeenCalledTimes(1);
    expect(finalReceipt()).toMatchObject({ graceful: false, failure: 'Electron shutdown identity was not prepared at launch.' });
  });
});
