import type { ElectronApplication } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { monitorNativeApp, type NativeAppMonitor, type NativeAppExit } from './nativeAppProcess';
import type { WorkspacePtyStopReceipt } from '../../../main/workspace-pty-force-stop';

export const CLOSE_BUDGET_MS = 20_000;
interface State { monitor: NativeAppMonitor; stderr: string; stdout: string; entry: string; nativeExit?: NativeAppExit; transportClosed?: boolean }
const states = new WeakMap<ElectronApplication, Promise<State>>();
const pendingApps = new Set<ElectronApplication>();
const closings = new WeakMap<ElectronApplication, Promise<number>>();
function bounded<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), Math.max(1, milliseconds)); })]).finally(() => clearTimeout(timer));
}

/** Install passive diagnostics before UI actions can create a PTY. */
export async function prepareElectronShutdown(app: ElectronApplication, entry: string): Promise<void> {
  if (states.has(app)) { await states.get(app); return; }
  pendingApps.add(app);
  const pending = (async () => {
    const child = app.process(); const state = { stderr: '', stdout: '', entry } as State;
    const releaseCompleted = () => { if (state.transportClosed && state.nativeExit?.code === 0 && !state.nativeExit.signal) pendingApps.delete(app); };
    app.once?.('close', () => { state.transportClosed = true; releaseCompleted(); });
    child.stderr?.on('data', chunk => { state.stderr = (state.stderr + chunk).slice(-96 * 1024); });
    child.stdout?.on('data', chunk => { state.stdout = (state.stdout + chunk).slice(-96 * 1024); });
    const info = await app.evaluate(({ dialog }) => {
      const cp = (process as any).getBuiltinModule('child_process');
      const log = (global as any).__homebotE2eShutdown = { helpers: [] as unknown[], refusals: [] as unknown[] };
      const original = cp.execFile;
      const observer = function (this: unknown, ...args: any[]) {
        const argv = args[1]; let purpose = '', pid: number | undefined;
        if (Array.isArray(argv)) {
          const plain = argv.indexOf('-Command'), encoded = argv.indexOf('-EncodedCommand');
          const source = plain >= 0 ? argv[plain + 1] : encoded >= 0 ? Buffer.from(argv[encoded + 1], 'base64').toString('utf16le') : '';
          if (source.includes('$taskProcess = Get-CimInstance Win32_Process')) { purpose = 'identity'; pid = Number(/ProcessId=(\d+)/.exec(source)?.[1]); }
          else if (source.includes('class OwnedPtyStop')) purpose = 'stop';
        }
        const callback = args[args.length - 1];
        if (purpose && typeof callback === 'function') {
          const started = Date.now();
          args[args.length - 1] = function (this: unknown, error: any, stdout: unknown, stderr: unknown) {
            log.helpers.push({ purpose, pid, duration: Date.now() - started, error: error ? { message: error.message, code: error.code, signal: error.signal, killed: error.killed } : null, stdout: String(stdout).slice(0, 65536), stderr: String(stderr).slice(0, 4096) });
            if (log.helpers.length > 64) log.helpers.shift();
            return callback.apply(this, arguments);
          };
        }
        return original.apply(this, args);
      };
      Object.defineProperties(observer, Object.getOwnPropertyDescriptors(original)); cp.execFile = observer;
      const show = dialog.showMessageBox;
      dialog.showMessageBox = function (this: unknown, ...args: any[]) {
        const options = args.find(value => value && typeof value.message === 'string');
        if (options?.message === 'A running IDE program could not be stopped.') log.refusals.push({ at: Date.now(), message: options.message, detail: options.detail });
        return (show as any).apply(this, args);
      };
      return { pid: process.pid, ppid: process.ppid, execPath: process.execPath };
    });
    state.monitor = await monitorNativeApp(info, child, entry);
    void state.monitor.exit.then(exit => { state.nativeExit = exit; releaseCompleted(); }).catch(() => {});
    return state;
  })();
  states.set(app, pending); await pending;
}

/** Failed graceful shutdown stays a failure even if owned cleanup succeeds. */
export function closeElectronApp(app: ElectronApplication, label = 'app'): Promise<number> {
  const prior = closings.get(app); if (prior) return prior;
  const closing = closePreparedApp(app, label); closings.set(app, closing); return closing;
}
/** Assertion failures and skips still release each launched native process. */
export async function closeRemainingElectronApps(): Promise<void> {
  const results = await Promise.allSettled([...pendingApps].map(app => closeElectronApp(app, 'afterEach')));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
async function closePreparedApp(app: ElectronApplication, label: string): Promise<number> {
  const started = Date.now(), deadline = started + CLOSE_BUDGET_MS;
  const receipt: Record<string, unknown> = { label, started: new Date(started).toISOString() };
  const artifact = path.resolve('test-results', `electron-shutdown-${process.pid}-${started}.json`);
  let state: State | undefined, tree: WorkspacePtyStopReceipt | undefined;
  const persist = () => { fs.mkdirSync(path.dirname(artifact), { recursive: true }); fs.writeFileSync(artifact, JSON.stringify(receipt, null, 2)); };
  try {
    if (!states.has(app)) throw new Error('Electron shutdown identity was not prepared at launch.');
    state = await bounded(states.get(app)!, deadline - Date.now(), 'Native Electron launch identity unavailable');
    receipt.native = { ...state.monitor.info, creation: state.monitor.creation }; receipt.launcherPid = app.process().pid;
    if (!state.nativeExit) {
      try { tree = await bounded(state.monitor.snapshot(), Math.min(4000, deadline - Date.now()), 'Native owned-tree snapshot exceeded its bound'); receipt.ownedTree = tree; }
      catch (snapshotError) {
        // Native may have exited just before the snapshot while its observer's
        // stdout receipt is still queued. Require that same held OS exit proof.
        try { state.nativeExit = await bounded(state.monitor.exit, Math.min(1000, deadline - Date.now()), 'Native exit receipt not available after snapshot failure'); receipt.snapshotFailure = String(snapshotError); }
        catch { throw snapshotError; }
      }
      // app.close disposes transport before a production refusal can be diagnosed.
      if (!state.nativeExit) await bounded(app.evaluate(({ app }) => { setImmediate(() => app.quit()); }), deadline - Date.now(), 'Native quit request exceeded close budget');
    }
    receipt.nativeExit = await bounded(state.monitor.exit, deadline - Date.now(), 'Actual Electron main did not exit within close budget');
    const nativeExit = receipt.nativeExit as NativeAppExit;
    if (nativeExit.code !== 0 || nativeExit.signal) throw new Error('Actual Electron main exited with a nonzero OS code or termination signal.');
    receipt.capturedIdentitiesGone = await bounded(state.monitor.verify(tree), deadline - Date.now(), 'Native owned identity disappearance query exceeded close budget');
    receipt.verificationScope = tree ? 'captured-owned-tree' : 'native-main';
    if (!receipt.capturedIdentitiesGone) throw new Error('Captured owned processes remain alive after native main exit.');
    if (!state.transportClosed) await bounded(app.close(), deadline - Date.now(), 'Playwright transport did not close after actual native exit');
    receipt.elapsed = Date.now() - started; receipt.graceful = true; persist();
    console.log(`[E2E-CLOSE] ${JSON.stringify({ label, artifact, native: receipt.native, nativeExit: receipt.nativeExit, elapsed: receipt.elapsed, graceful: true })}`);
    return Date.now() - started;
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : String(error);
    if (state) {
      receipt.stderr = state.stderr; receipt.stdout = state.stdout;
      try { receipt.production = await bounded(app.evaluate(() => (global as any).__homebotE2eShutdown), 1000, 'Production shutdown diagnostics unavailable'); } catch (diagnosticError) { receipt.diagnosticError = String(diagnosticError); }
      persist();
      try { receipt.forcedOwnedCleanup = await bounded(state.monitor.cleanup(tree), 6500, 'Owned native cleanup unconfirmed'); receipt.cleanupExit = await bounded(state.monitor.exit, 3000, 'Owned native OS exit unconfirmed'); } catch (cleanupError) { receipt.cleanupError = String(cleanupError); }
      try { await bounded(app.close(), 3000, 'Failure cleanup transport did not close'); } catch (transportError) { receipt.transportError = String(transportError); }
    } else {
      // Missing OS authority forbids force termination; normal quit is still
      // requested through this exact owned application's connected transport.
      try { await bounded(app.evaluate(({ app }) => { setImmediate(() => app.quit()); }), 1000, 'Unverified launch normal quit unavailable'); await bounded(app.close(), 3000, 'Unverified launch transport close unavailable'); } catch (cleanupError) { receipt.cleanupError = String(cleanupError); }
    }
    receipt.elapsed = Date.now() - started; receipt.graceful = false; persist();
    console.error(`[E2E-CLOSE] ${JSON.stringify({ label, artifact, ...receipt })}`);
    throw new Error(`Electron graceful shutdown failed (${label}): ${receipt.failure}. Diagnostics: ${artifact}`);
  } finally { state?.monitor.dispose(); states.delete(app); pendingApps.delete(app); }
}
