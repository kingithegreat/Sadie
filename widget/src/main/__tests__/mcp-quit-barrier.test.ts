/** Execute the actual entry's quit wiring without loading unrelated app startup. */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as ts from 'typescript';

const source = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf8');
const handlerStart = source.indexOf("app.on('before-quit'");
const stateStart = source.indexOf('let mcpQuitPending');
const quitSource = source.slice(stateStart >= 0 ? stateStart : handlerStart);
if (handlerStart < 0 || !quitSource.includes("app.on('window-all-closed'")) throw new Error('Actual main quit wiring was not found');
const compiled = ts.transpileModule(quitSource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

function harness(keepExistingWindow = false) {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const cleanup = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  const handlers = new Map<string, (...args: any[]) => void>();
  let nativeQuits = 0;
  const app = {
    on: jest.fn((event: string, handler: (...args: any[]) => void) => handlers.set(event, handler)),
    quit: jest.fn(() => {
      const event = { preventDefault: jest.fn() };
      handlers.get('before-quit')!(event);
      if (!event.preventDefault.mock.calls.length) nativeQuits++;
    }),
  };
  const otherCleanup = {
    closeAllWorkspaceTasks: jest.fn(), stopCalendarHelpers: jest.fn(async () => {}), resumeCalendarHelpers: jest.fn(), stopAssistantBridge: jest.fn(), destroyBrowserPanel: jest.fn(), closeAllServiceWindows: jest.fn(),
    disposeWorkspaceLanguageServices: jest.fn(), stopWorkspaceDebuggers: jest.fn(async () => {}), stopWorkspaceTestRuns: jest.fn(async () => {}),
    workspacePtySessions: { closeAll: jest.fn(async () => {}) },
    globalShortcut: { unregisterAll: jest.fn() }, supervisorHandle: { stop: jest.fn() },
  };
  const shutdownMcpServers = jest.fn(() => cleanup);
  const safeCatch = jest.fn();
  const dialog = { showMessageBox: jest.fn(async () => ({ response: 1 })) };
  const windowHandlers = new Map<string, (...args: any[]) => void>();
  const ownedWindow = { isDestroyed: () => false, on: jest.fn((name: string, handler: any) => windowHandlers.set(name, handler)), removeListener: jest.fn() };
  const createMainWindow = jest.fn(() => ownedWindow);
  const context = { app, ...otherCleanup, shutdownMcpServers, safeCatch, dialog, mainWindow: keepExistingWindow ? ownedWindow : null, createOwnedMainWindow: createMainWindow, process: { platform: 'win32' } };
  vm.runInNewContext(compiled, context);
  vm.runInNewContext('createMainWindow()', context);
  createMainWindow.mockClear();
  return { app, handlers, windowHandlers, ownedWindow, otherCleanup, shutdownMcpServers, safeCatch, dialog, createMainWindow, resolve, reject, nativeQuits: () => nativeQuits };
}
// Flush the native and VM promise queues through a real event-loop turn.
// Cleanup phases may add microtasks without changing the quit contract.
async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); }

test('native window close retains its owning renderer through a refusal, then permits close after retry cleanup', async () => {
  const h = harness(true);
  h.otherCleanup.workspacePtySessions.closeAll.mockRejectedValueOnce(new Error('owned terminal identity unavailable'));
  const firstClose = { preventDefault: jest.fn() };
  h.windowHandlers.get('close')!(firstClose);
  expect(firstClose.preventDefault).toHaveBeenCalledTimes(1);
  h.resolve(); await settle();
  expect(h.nativeQuits()).toBe(0);
  expect(h.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  expect(h.createMainWindow).not.toHaveBeenCalled();
  const retryClose = { preventDefault: jest.fn() };
  h.windowHandlers.get('close')!(retryClose);
  expect(retryClose.preventDefault).toHaveBeenCalledTimes(1);
  await settle(); expect(h.nativeQuits()).toBe(1);
  const finalClose = { preventDefault: jest.fn() };
  h.windowHandlers.get('close')!(finalClose);
  expect(finalClose.preventDefault).not.toHaveBeenCalled();
});

test('native quit waits for owned MCP cleanup, repeats share the barrier, and other services still stop once', async () => {
  const h = harness();
  h.app.quit();
  h.handlers.get('window-all-closed')!();
  await settle();
  expect(h.nativeQuits()).toBe(0);
  expect(h.shutdownMcpServers).toHaveBeenCalledTimes(1);
  for (const cleanup of [h.otherCleanup.closeAllWorkspaceTasks, h.otherCleanup.stopAssistantBridge, h.otherCleanup.destroyBrowserPanel,
    h.otherCleanup.closeAllServiceWindows, h.otherCleanup.globalShortcut.unregisterAll, h.otherCleanup.supervisorHandle.stop]) {
    expect(cleanup).toHaveBeenCalledTimes(1);
  }
  h.resolve();
  await settle();
  expect(h.nativeQuits()).toBe(1);
  expect(h.shutdownMcpServers).toHaveBeenCalledTimes(1);
});

test('native quit waits for package task ownership and keeps the renderer available after an unconfirmed Stop', async () => {
  const h = harness(true);
  let failStop!: (error: Error) => void;
  const stopping = new Promise<void>((_resolve, reject) => { failStop = reject; });
  h.otherCleanup.closeAllWorkspaceTasks.mockReturnValueOnce(stopping);
  h.app.quit();
  h.resolve(); await settle();
  h.app.quit(); await settle();
  expect(h.otherCleanup.closeAllWorkspaceTasks).toHaveBeenCalledTimes(1);
  expect(h.nativeQuits()).toBe(0);
  expect(h.shutdownMcpServers).not.toHaveBeenCalled();
  expect(h.otherCleanup.stopAssistantBridge).not.toHaveBeenCalled();
  const error = new Error('owned package tree stop unconfirmed');
  failStop(error); await settle();
  expect(h.safeCatch).toHaveBeenCalledWith(error);
  expect(h.nativeQuits()).toBe(0);
  expect(h.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  expect(h.createMainWindow).not.toHaveBeenCalled();
  expect(h.shutdownMcpServers).not.toHaveBeenCalled();
  expect(h.otherCleanup.globalShortcut.unregisterAll).not.toHaveBeenCalled();
  h.app.quit(); await settle();
  expect(h.otherCleanup.closeAllWorkspaceTasks).toHaveBeenCalledTimes(2);
  expect(h.nativeQuits()).toBe(1);
  expect(h.shutdownMcpServers).toHaveBeenCalledTimes(1);
  expect(h.otherCleanup.stopAssistantBridge).toHaveBeenCalledTimes(1);
});

test.each(['debugger', 'test', 'terminal', 'task', 'calendar'])('refused %s cleanup preserves every unrelated service until successful retry', async kind => {
  const h = harness(true);
  const owned = {
    debugger: h.otherCleanup.stopWorkspaceDebuggers, test: h.otherCleanup.stopWorkspaceTestRuns,
    terminal: h.otherCleanup.workspacePtySessions.closeAll, task: h.otherCleanup.closeAllWorkspaceTasks,
    calendar: h.otherCleanup.stopCalendarHelpers,
  };
  owned[kind as keyof typeof owned].mockRejectedValueOnce(new Error('owned close remains unconfirmed'));
  h.app.quit(); await settle();
  expect(h.nativeQuits()).toBe(0); expect(h.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  const ordinary = [h.shutdownMcpServers, h.otherCleanup.disposeWorkspaceLanguageServices, h.otherCleanup.stopAssistantBridge,
    h.otherCleanup.destroyBrowserPanel, h.otherCleanup.globalShortcut.unregisterAll, h.otherCleanup.closeAllServiceWindows, h.otherCleanup.supervisorHandle.stop];
  for (const cleanup of ordinary) expect(cleanup).not.toHaveBeenCalled();
  expect(h.otherCleanup.resumeCalendarHelpers).toHaveBeenCalledTimes(1);
  h.resolve(); h.app.quit(); await settle();
  expect(h.nativeQuits()).toBe(1);
  for (const cleanup of ordinary) expect(cleanup).toHaveBeenCalledTimes(1);
});

test('unconfirmed calendar helper close blocks native quit and resumes admission only after refusal', async () => {
  const h = harness(true);
  const error = new Error('calendar child close unconfirmed');
  h.otherCleanup.stopCalendarHelpers.mockRejectedValueOnce(error);
  h.app.quit(); h.resolve(); await settle();
  expect(h.nativeQuits()).toBe(0);
  expect(h.safeCatch).toHaveBeenCalledWith(error);
  expect(h.otherCleanup.resumeCalendarHelpers).toHaveBeenCalledTimes(1);
  expect(h.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  h.app.quit(); await settle();
  expect(h.nativeQuits()).toBe(1);
  expect(h.otherCleanup.stopCalendarHelpers).toHaveBeenCalledTimes(2);
  expect(h.otherCleanup.resumeCalendarHelpers).toHaveBeenCalledTimes(1);
});

test('unconfirmed owned runtime cleanup runs every other cleanup and keeps the app available for retry', async () => {
  const h = harness();
  const error = new Error('controlled debugger cleanup failure');
  h.otherCleanup.stopWorkspaceDebuggers.mockImplementationOnce(() => { throw error; });
  h.app.quit();
  await settle();
  expect(h.otherCleanup.stopWorkspaceTestRuns).toHaveBeenCalledTimes(1);
  expect(h.otherCleanup.workspacePtySessions.closeAll).toHaveBeenCalledTimes(1);
  expect(h.nativeQuits()).toBe(0);
  h.resolve();
  await settle();
  expect(h.safeCatch).toHaveBeenCalledWith(error);
  expect(h.nativeQuits()).toBe(0);
  expect(h.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  expect(h.createMainWindow).toHaveBeenCalledTimes(1);
  h.app.quit();
  await settle();
  expect(h.nativeQuits()).toBe(1);
});

test('a cleanup rejection is reported and still resumes native quit', async () => {
  const h = harness();
  h.app.quit();
  expect(h.nativeQuits()).toBe(0);
  const error = new Error('controlled cleanup failure');
  h.reject(error);
  await settle();
  expect(h.safeCatch).toHaveBeenCalledWith(error);
  expect(h.nativeQuits()).toBe(1);
});

test('a synchronous MCP shutdown exception is reported and repeated quit still resumes native quit once', async () => {
  const h = harness();
  const error = new Error('controlled synchronous MCP shutdown failure');
  h.shutdownMcpServers.mockImplementationOnce(() => { throw error; });
  let escaped: unknown;
  try { h.app.quit(); } catch (caught) { escaped = caught; }
  // Exercise the real repeat path even if the first event handler threw.
  h.handlers.get('window-all-closed')!();
  expect(h.nativeQuits()).toBe(0);
  await settle();
  expect(h.shutdownMcpServers).toHaveBeenCalledTimes(1);
  expect(h.nativeQuits()).toBe(1);
  expect(escaped).toBeUndefined();
  expect(h.safeCatch).toHaveBeenCalledTimes(1);
  expect(h.safeCatch).toHaveBeenCalledWith(error);
  for (const cleanup of [h.otherCleanup.closeAllWorkspaceTasks, h.otherCleanup.stopAssistantBridge,
    h.otherCleanup.destroyBrowserPanel, h.otherCleanup.closeAllServiceWindows,
    h.otherCleanup.globalShortcut.unregisterAll, h.otherCleanup.supervisorHandle.stop]) {
    expect(cleanup).toHaveBeenCalledTimes(1);
  }
});

test('an unrelated service cleanup error cannot bypass or strand connector cleanup', async () => {
  const h = harness();
  const error = new Error('controlled service failure');
  h.otherCleanup.globalShortcut.unregisterAll.mockImplementationOnce(() => { throw error; });
  h.app.quit();
  await settle();
  expect(h.safeCatch).toHaveBeenCalledWith(error);
  expect(h.shutdownMcpServers).toHaveBeenCalledTimes(1);
  expect(h.otherCleanup.closeAllServiceWindows).toHaveBeenCalledTimes(1);
  expect(h.otherCleanup.supervisorHandle.stop).toHaveBeenCalledTimes(1);
  h.resolve();
  await settle();
  expect(h.nativeQuits()).toBe(1);
});
