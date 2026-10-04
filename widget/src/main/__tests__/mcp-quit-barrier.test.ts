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

function harness() {
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
    closeAllWorkspaceTasks: jest.fn(), stopAssistantBridge: jest.fn(), destroyBrowserPanel: jest.fn(), closeAllServiceWindows: jest.fn(),
    globalShortcut: { unregisterAll: jest.fn() }, supervisorHandle: { stop: jest.fn() },
  };
  const shutdownMcpServers = jest.fn(() => cleanup);
  const safeCatch = jest.fn();
  vm.runInNewContext(compiled, { app, ...otherCleanup, shutdownMcpServers, safeCatch, process: { platform: 'win32' } });
  return { app, handlers, otherCleanup, shutdownMcpServers, safeCatch, resolve, reject, nativeQuits: () => nativeQuits };
}
async function settle() { for (let n = 0; n < 10; n++) await Promise.resolve(); }

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
