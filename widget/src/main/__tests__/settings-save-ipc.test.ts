import { readFileSync } from 'fs';
import { join } from 'path';
import { transpileModule, ScriptTarget } from 'typescript';

// Execute the production registration, without booting unrelated integrations.
const source = readFileSync(join(__dirname, '..', 'ipc-handlers.ts'), 'utf8');
const start = source.indexOf("  ipcMain.handle('homebot:save-settings'");
const end = source.indexOf("\n  /**", start);
if (start < 0 || end < start) throw new Error('Settings IPC registration not found');
const code = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
const register = new Function('ipcMain', 'getSettings', 'saveSettings', 'logTelemetryEvent', 'setSearxngUrl', 'setTavilyApiKey', 'setSerperApiKey', 'setStableHordeApiKey', 'console', code);

function fixture(failWrite = false, failRefresh = false) {
  let persisted: any = { useCustomLLM: true, chatModel: 'existing' };
  const refresh = jest.fn(() => { if (failRefresh) throw new Error('refresh failed'); });
  const save = jest.fn(next => {
    if (failWrite) throw new Error('disk read-only');
    persisted = { ...next, telemetryConsentVersion: 'persisted-by-config' };
  });
  let handler!: (event: any, settings: any) => Promise<any>;
  register({ handle: (_channel: string, fn: typeof handler) => { handler = fn; } }, () => ({ ...persisted }), save, jest.fn(), refresh, jest.fn(), jest.fn(), jest.fn(), { error: jest.fn() });
  return { handler, refresh, save, read: () => persisted };
}

test('a failed write returns failure and never refreshes active settings', async () => {
  const f = fixture(true);
  expect(await f.handler({}, { useCustomLLM: false })).toEqual({ success: false, error: 'disk read-only' });
  expect(f.read().useCustomLLM).toBe(true);
  expect(f.refresh).not.toHaveBeenCalled();
});

test('success returns persisted readback including config normalization', async () => {
  const f = fixture();
  expect(await f.handler({}, { useCustomLLM: false })).toEqual({ success: true, data: { useCustomLLM: false, chatModel: 'existing', telemetryConsentVersion: 'persisted-by-config' } });
  expect(f.refresh).toHaveBeenCalledTimes(1);
});

test('post-commit refresh failure still acknowledges the settings actually saved', async () => {
  const f = fixture(false, true);
  expect(await f.handler({}, { useCustomLLM: false })).toEqual({ success: true, data: f.read() });
  expect(f.read().useCustomLLM).toBe(false);
});
