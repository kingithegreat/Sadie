/** Actual registered MCP handlers, isolated from unrelated main startup. */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as ts from 'typescript';

const source = fs.readFileSync(path.join(__dirname, '../ipc-handlers.ts'), 'utf8');
const start = source.indexOf("ipcMain.handle('homebot:mcp-get-status'");
const end = source.indexOf("ipcMain.handle('homebot:search-conversations'", start);
if (start < 0 || end <= start) throw new Error('Actual MCP handlers not found');
const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  let config = { servers: [{ type: 'stdio', name: 'owned', command: 'never-spawn', enabled: true }] };
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  const save = jest.fn(value => { config = JSON.parse(JSON.stringify(value)); });
  const disconnect = jest.fn(async (_name: string) => {});
  const connect = jest.fn(async (_config: any, _register: any) => ({ connected: true, toolCount: 1, error: undefined as string | undefined }));
  vm.runInNewContext(compiled, {
    ipcMain: { handle: (name: string, callback: (...args: any[]) => Promise<any>) => handlers.set(name, callback) },
    loadMcpConfig: () => JSON.parse(JSON.stringify(config)), saveMcpConfig: save,
    getMcpStatus: () => [], disconnectMcpServer: disconnect, connectSingleServer: connect, registerTool: jest.fn(),
  });
  return { handlers, save, disconnect, connect, config: () => config };
}

test('Disconnect waits for live cleanup and reads fresh configuration before removing only its server', async () => {
  const h = harness(); let resolve!: () => void;
  h.disconnect.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
  const removal = h.handlers.get('homebot:mcp-remove-server')!({}, 'owned');
  expect(h.disconnect).toHaveBeenCalledWith('owned'); expect(h.save).not.toHaveBeenCalled();
  h.config().servers.push({ type: 'stdio', name: 'other', command: 'never-spawn', enabled: true });
  resolve(); expect(await removal).toMatchObject({ success: true });
  expect(h.config().servers.map(server => server.name)).toEqual(['other']);
});

test.each(['homebot:mcp-remove-server', 'homebot:mcp-toggle-server'])('%s refuses unknown cleanup without hiding its saved retry target', async handler => {
  const h = harness(); h.disconnect.mockRejectedValueOnce(new Error('Owned Job cleanup unconfirmed'));
  await expect(h.handlers.get(handler)!({}, 'owned', false)).rejects.toThrow(/unconfirmed/);
  expect(h.save).not.toHaveBeenCalled(); expect(h.config().servers[0].enabled).toBe(true);
});

test('Disable joins ownership and Enable starts the configured server before reporting success', async () => {
  const h = harness(); await h.handlers.get('homebot:mcp-toggle-server')!({}, 'owned', false);
  expect(h.disconnect).toHaveBeenCalledWith('owned'); expect(h.config().servers[0].enabled).toBe(false);
  await h.handlers.get('homebot:mcp-toggle-server')!({}, 'owned', true);
  expect(h.connect.mock.calls[0][0]).toMatchObject({ name: 'owned', enabled: true });
  expect(h.config().servers[0].enabled).toBe(true);
});

test('failed Enable preserves disabled configuration and reports the live connection error', async () => {
  const h = harness(); h.config().servers[0].enabled = false;
  h.connect.mockResolvedValueOnce({ connected: false, toolCount: 0, error: 'Service could not start' });
  await expect(h.handlers.get('homebot:mcp-toggle-server')!({}, 'owned', true)).rejects.toThrow(/could not start/);
  expect(h.save).not.toHaveBeenCalled(); expect(h.config().servers[0].enabled).toBe(false);
});

test('saving a disabled replacement still stops its existing live owner', async () => {
  const h = harness();
  expect(await h.handlers.get('homebot:mcp-add-server')!({}, { ...h.config().servers[0], enabled: false })).toMatchObject({ success: true, connected: false });
  expect(h.disconnect).toHaveBeenCalledWith('owned'); expect(h.connect).not.toHaveBeenCalled();
});
