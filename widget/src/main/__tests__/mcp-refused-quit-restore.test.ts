/** Actual MCP lifecycle with controlled SDK/config only; no native launches. */
import type { McpServerConfig, McpStdioConfig } from '../mcp-client';
jest.mock('electron', () => ({ app: { getPath: () => 'private-mocked-mcp' } }));
jest.mock('fs', () => ({ existsSync: jest.fn(() => true), readFileSync: jest.fn() }));
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: jest.fn() }));
jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: jest.fn() }));
jest.mock('../mcp-stdio-owned', () => ({ createOwnedMcpStdioTransport: jest.fn() }));

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const config = (name: string): McpStdioConfig => ({ type: 'stdio', name, command: name, enabled: true });
const tool = { name: 'read', inputSchema: { type: 'object' } };
type MockClient = { connect: jest.Mock; listTools: jest.Mock; close: jest.Mock; callTool: jest.Mock };
let mcp: typeof import('../mcp-client'), clients: MockClient[], launches: any[], saved: McpServerConfig[], refused: Set<string>, advertised: Map<string, object>, register: jest.Mock;
let transportClosers: Array<{ command: string; close: jest.Mock }>;
const discovery: Promise<{ tools: typeof tool[] }>[] = [];
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
beforeEach(() => {
  jest.resetModules(); clients = []; launches = []; transportClosers = []; saved = []; refused = new Set(); advertised = new Map(); discovery.length = 0;
  require('fs').readFileSync.mockImplementation(() => JSON.stringify({ servers: saved }));
  require('@modelcontextprotocol/sdk/client/index.js').Client.mockImplementation(() => {
    const client: MockClient = { connect: jest.fn().mockResolvedValue(undefined), listTools: jest.fn().mockReturnValue(discovery.shift() || Promise.resolve({ tools: [tool] })), close: jest.fn().mockResolvedValue(undefined), callTool: jest.fn() };
    clients.push(client); return client;
  });
  require('../mcp-stdio-owned').createOwnedMcpStdioTransport.mockImplementation((parameters: any) => {
    launches.push(parameters);
    const close = jest.fn(async () => { if (refused.has(parameters.command)) throw new Error(`cleanup refused: ${parameters.command}`); });
    transportClosers.push({ command: parameters.command, close });
    return { transport: { stderr: { on() {} } }, close, cleanupScope: 'windows-job' };
  });
  register = jest.fn((name: string) => { const entry = {}; advertised.set(name, entry); return () => { if (advertised.get(name) === entry) advertised.delete(name); }; });
  mcp = require('../mcp-client');
});
afterEach(async () => { refused.clear(); await mcp.shutdownMcpServers(); });
async function connected(name: string) { const entry = config(name); saved.push(entry); expect((await mcp.connectSingleServer(entry, register)).connected).toBe(true); }
async function refusedQuit() { refused.add('failed'); await expect(mcp.shutdownMcpServers()).rejects.toThrow(/cleanup refused/); mcp.resumeMcpServersAfterRefusedQuit(); }

test('explicit Keep open restores multiple cleaned healthy servers, never the failed retained owner', async () => {
  await connected('first'); await connected('second'); await connected('failed');
  await refusedQuit(); expect(advertised.size).toBe(0); expect(clients).toHaveLength(3);
  const failedClose = transportClosers.find(owner => owner.command === 'failed')!.close; expect(failedClose).toHaveBeenCalledTimes(1);
  await mcp.restoreMcpServersAfterRefusedQuit();
  expect(mcp.getMcpStatus().map(server => server.name).sort()).toEqual(['first', 'second']);
  expect([...advertised.keys()].sort()).toEqual(['mcp_first_read', 'mcp_second_read']); expect(clients).toHaveLength(5);
  expect(failedClose).toHaveBeenCalledTimes(1);
  await mcp.restoreMcpServersAfterRefusedQuit(); expect(clients).toHaveLength(5);
});
test('Try closing again then another refusal retains healthy candidates for explicit Keep open', async () => {
  await connected('first'); await connected('second'); await connected('failed');
  await refusedQuit();
  // The actual dialog reopens admission after each refusal, but Try closing
  // again invokes shutdown without calling the Keep open restoration.
  await refusedQuit();
  expect(mcp.getMcpStatus()).toEqual([]); expect(advertised.size).toBe(0); expect(clients).toHaveLength(3);
  const failedClose = transportClosers.find(owner => owner.command === 'failed')!.close;
  expect(failedClose).toHaveBeenCalledTimes(2);
  await mcp.restoreMcpServersAfterRefusedQuit();
  expect(mcp.getMcpStatus().map(server => server.name).sort()).toEqual(['first', 'second']);
  expect([...advertised.keys()].sort()).toEqual(['mcp_first_read', 'mcp_second_read']);
  expect(clients).toHaveLength(5); expect(failedClose).toHaveBeenCalledTimes(2);
  await mcp.restoreMcpServersAfterRefusedQuit(); expect(clients).toHaveLength(5);
});
test('quit retries retain only current healthy generations and obey fresh disabled settings', async () => {
  await connected('replace'); await connected('removed'); await connected('disabled'); await connected('failed');
  await refusedQuit();
  expect((await mcp.connectSingleServer({ ...config('replace'), command: 'manual-generation' }, register)).connected).toBe(true);
  await mcp.disconnectMcpServer('removed');
  saved = [{ ...config('replace'), command: 'current-approved-command' }, { ...config('disabled'), enabled: false }, config('failed')];
  await refusedQuit(); await mcp.restoreMcpServersAfterRefusedQuit();
  expect(mcp.getMcpStatus().map(server => server.name)).toEqual(['replace']);
  expect([...advertised.keys()]).toEqual(['mcp_replace_read']); expect(clients).toHaveLength(6);
  expect(launches[5]).toMatchObject({ command: 'current-approved-command' });
  expect(register.mock.calls.filter(call => call[0] === 'mcp_removed_read')).toHaveLength(1);
});
test('a successful quit retry never reconnects the preserved healthy snapshot', async () => {
  await connected('first'); await connected('failed'); await refusedQuit();
  refused.clear(); await mcp.shutdownMcpServers(); mcp.resumeMcpServersAfterRefusedQuit();
  await mcp.restoreMcpServersAfterRefusedQuit();
  expect(mcp.getMcpStatus()).toEqual([]); expect(advertised.size).toBe(0); expect(clients).toHaveLength(2);
});
test('resume alone does not reconnect; pending or successful quit cannot restore', async () => {
  await connected('first'); const pending = deferred<void>(); clients[0].close.mockReturnValue(pending.promise);
  const quitting = mcp.shutdownMcpServers(); await settle();
  await mcp.restoreMcpServersAfterRefusedQuit(); expect(clients).toHaveLength(1);
  pending.resolve(); await quitting; mcp.resumeMcpServersAfterRefusedQuit();
  await mcp.restoreMcpServersAfterRefusedQuit(); expect(clients).toHaveLength(1); expect(advertised.size).toBe(0);
});
test('restoration obeys current saved disabled/removed settings and uses current changed launch configuration', async () => {
  await connected('disabled'); await connected('removed'); await connected('changed'); await connected('failed'); await refusedQuit();
  saved = [{ ...config('disabled'), enabled: false }, { ...config('changed'), command: 'new-approved-command', args: ['fresh'] } as McpServerConfig, config('failed')];
  await mcp.restoreMcpServersAfterRefusedQuit();
  expect(mcp.getMcpStatus().map(server => server.name)).toEqual(['changed']); expect(clients).toHaveLength(5);
  expect(launches[4]).toMatchObject({ command: 'new-approved-command', args: ['fresh'] });
});
test('manual same-name replacement and disconnect invalidate their old restoration generations', async () => {
  await connected('replace'); await connected('removed'); await connected('failed'); await refusedQuit();
  expect((await mcp.connectSingleServer({ ...config('replace'), command: 'manual-generation' }, register)).connected).toBe(true);
  const replacement = advertised.get('mcp_replace_read'); await mcp.disconnectMcpServer('removed');
  await mcp.restoreMcpServersAfterRefusedQuit();
  expect(clients).toHaveLength(4); expect(advertised.get('mcp_replace_read')).toBe(replacement); expect(advertised.has('mcp_removed_read')).toBe(false);
});
test('concurrent Keep open requests join one restoration operation', async () => {
  await connected('first'); await connected('failed'); await refusedQuit();
  const waiting = deferred<{ tools: typeof tool[] }>(); discovery.push(waiting.promise);
  const first = mcp.restoreMcpServersAfterRefusedQuit(), second = mcp.restoreMcpServersAfterRefusedQuit(); expect(second).toBe(first);
  await settle(); expect(clients).toHaveLength(3); waiting.resolve({ tools: [tool] }); await first;
  expect(register.mock.calls.filter(call => call[0] === 'mcp_first_read')).toHaveLength(2);
});
test('a second quit cancels pending restoration; late discovery cannot resurrect tools or reuse its snapshot', async () => {
  await connected('first'); await connected('failed'); await refusedQuit();
  const waiting = deferred<{ tools: typeof tool[] }>(); discovery.push(waiting.promise);
  const restoration = mcp.restoreMcpServersAfterRefusedQuit(); const cancelled = expect(restoration).rejects.toThrow(/shutting down/); await settle();
  await expect(mcp.shutdownMcpServers()).rejects.toThrow(/cleanup refused/); await cancelled;
  mcp.resumeMcpServersAfterRefusedQuit(); waiting.resolve({ tools: [tool] }); await settle(); await mcp.restoreMcpServersAfterRefusedQuit();
  expect(clients).toHaveLength(3); expect(advertised.size).toBe(0); expect(mcp.getMcpStatus()).toEqual([]);
});
test('a later refused quit takes a fresh connected snapshot and restores each healthy generation once', async () => {
  await connected('first'); await connected('failed'); await refusedQuit(); await mcp.restoreMcpServersAfterRefusedQuit(); expect(clients).toHaveLength(3);
  await refusedQuit(); await mcp.restoreMcpServersAfterRefusedQuit();
  expect(clients).toHaveLength(4); expect(mcp.getMcpStatus().map(server => server.name)).toEqual(['first']);
  expect(register.mock.calls.filter(call => call[0] === 'mcp_first_read')).toHaveLength(3);
});
