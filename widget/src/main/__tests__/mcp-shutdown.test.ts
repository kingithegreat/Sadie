/** Controlled SDK promises only: no real process, user config or network. */
import type { McpServerConfig } from '../mcp-client';
import { PassThrough } from 'stream';

jest.mock('electron', () => ({ app: { getPath: () => 'mcp-shutdown-fixture' } }));
jest.mock('fs', () => ({ existsSync: jest.fn(() => true), readFileSync: jest.fn() }));
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: jest.fn() }));
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: jest.fn() }));
jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: jest.fn() }));
jest.mock('../mcp-stdio-owned', () => ({ createOwnedMcpStdioTransport: jest.fn() }));

const config: McpServerConfig = { type: 'stdio', name: 'owned', command: 'never-spawn', enabled: true };
const tool = { name: 'read', inputSchema: { type: 'object' } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { for (let n = 0; n < 15; n++) await Promise.resolve(); }
function initializeControlled() {
  const worker = process.env.JEST_WORKER_ID;
  delete process.env.JEST_WORKER_ID; // All SDK/config dependencies above are controlled.
  try { return mcp.initializeMcpServers(register); }
  finally {
    if (worker === undefined) delete process.env.JEST_WORKER_ID;
    else process.env.JEST_WORKER_ID = worker;
  }
}

let mcp: typeof import('../mcp-client');
let client: { connect: jest.Mock; listTools: jest.Mock; close: jest.Mock; callTool: jest.Mock };
let createClient: jest.Mock;
let register: jest.Mock;
let closeTransport: jest.Mock;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  client = {
    connect: jest.fn().mockResolvedValue(undefined),
    listTools: jest.fn().mockResolvedValue({ tools: [tool] }),
    close: jest.fn().mockResolvedValue(undefined), callTool: jest.fn(),
  };
  createClient = require('@modelcontextprotocol/sdk/client/index.js').Client;
  createClient.mockImplementation(() => ({ ...client }));
  closeTransport = jest.fn().mockResolvedValue(undefined);
  require('../mcp-stdio-owned').createOwnedMcpStdioTransport.mockImplementation((parameters: any) => ({
    transport: new (require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport)(parameters),
    close: closeTransport, cleanupScope: 'windows-job',
  }));
  require('fs').readFileSync.mockReturnValue(JSON.stringify({ servers: [config, { ...config, name: 'second' }] }));
  mcp = require('../mcp-client');
  register = jest.fn();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('control: completed connection registers tools and shutdown closes its client', async () => {
  expect(await mcp.connectSingleServer(config, register)).toMatchObject({ connected: true, toolCount: 1 });
  expect(register).toHaveBeenCalledTimes(1);
  expect(mcp.getMcpStatus()).toHaveLength(1);
  await mcp.shutdownMcpServers();
  expect(client.close).toHaveBeenCalledTimes(1);
  expect(mcp.getMcpStatus()).toEqual([]);
});

test('stdio stderr is consumed before handshake even when server output exceeds the stream buffer', async () => {
  jest.useRealTimers();
  const blocked = new PassThrough({ highWaterMark: 1024 });
  expect(blocked.write(Buffer.alloc(65536))).toBe(false);
  expect(blocked.readableLength).toBe(65536); // Missing-reader positive control.
  blocked.destroy();
  const stderr = new PassThrough({ highWaterMark: 1024 });
  require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport.mockImplementationOnce(() => ({ stderr }));
  client.connect.mockImplementation(async () => {
    await new Promise<void>(resolve => {
      stderr.once('drain', resolve);
      if (stderr.write(Buffer.alloc(65536))) resolve();
    });
  });
  try {
    expect(await mcp.connectSingleServer(config, register)).toMatchObject({ connected: true, toolCount: 1 });
    expect(stderr.readableLength).toBe(0);
    await mcp.shutdownMcpServers();
  } finally { stderr.destroy(); }
});

test('shutdown owns an unfinished handshake and prevents its late registration', async () => {
  const connecting = deferred<void>();
  client.connect.mockReturnValue(connecting.promise);
  const result = mcp.connectSingleServer(config, register);
  await settle();
  expect(client.connect).toHaveBeenCalledTimes(1);
  await mcp.shutdownMcpServers();
  expect(client.close).toHaveBeenCalledTimes(1);
  expect(await result).toMatchObject({ connected: false });
  connecting.resolve();
  await settle();
  expect(register).not.toHaveBeenCalled();
  expect(mcp.getMcpStatus()).toEqual([]);
});

test('shutdown owns unfinished discovery and ignores tools arriving after close', async () => {
  const discovery = deferred<{ tools: typeof tool[] }>();
  client.listTools.mockReturnValue(discovery.promise);
  const result = mcp.connectSingleServer(config, register);
  await settle();
  expect(client.listTools).toHaveBeenCalledTimes(1);
  await mcp.shutdownMcpServers();
  expect(client.close).toHaveBeenCalledTimes(1);
  expect(await result).toMatchObject({ connected: false });
  discovery.resolve({ tools: [tool] });
  await settle();
  expect(register).not.toHaveBeenCalled();
  expect(mcp.getMcpStatus()).toEqual([]);
});

test('shutdown cancels startup retry delay and never starts the next server', async () => {
  client.connect.mockRejectedValue(new Error('controlled handshake failure'));
  const initializing = initializeControlled();
  await settle();
  expect(createClient).toHaveBeenCalledTimes(1);
  expect(client.close).toHaveBeenCalledTimes(1);
  await mcp.shutdownMcpServers();
  await jest.advanceTimersByTimeAsync(30_000);
  await initializing;
  expect(createClient).toHaveBeenCalledTimes(1);
  expect(register).not.toHaveBeenCalled();
});

test('control: startup still retries a transient error and connects the next configured server', async () => {
  client.connect.mockRejectedValueOnce(new Error('controlled transient failure'));
  const initializing = initializeControlled();
  await settle();
  expect(createClient).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(3000);
  await initializing;
  expect(createClient).toHaveBeenCalledTimes(3);
  expect(register.mock.calls.map(call => call[0])).toEqual(['mcp_owned_read', 'mcp_second_read']);
  expect(mcp.getMcpStatus().map(server => server.name)).toEqual(['owned', 'second']);
  await mcp.shutdownMcpServers();
  expect(jest.getTimerCount()).toBe(0);
});

test('shutdown cancels the empty-tool discovery retry', async () => {
  client.listTools.mockResolvedValue({ tools: [] });
  const result = mcp.connectSingleServer(config, register);
  await settle();
  expect(client.listTools).toHaveBeenCalledTimes(1);
  await mcp.shutdownMcpServers();
  await jest.advanceTimersByTimeAsync(30_000);
  expect(await result).toMatchObject({ connected: false });
  expect(client.listTools).toHaveBeenCalledTimes(1);
  expect(client.close).toHaveBeenCalledTimes(1);
});

test('a new connect request after shutdown cannot construct or spawn a transport', async () => {
  await mcp.shutdownMcpServers();
  expect(await mcp.connectSingleServer(config, register)).toMatchObject({ connected: false });
  expect(createClient).not.toHaveBeenCalled();
  expect(require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport).not.toHaveBeenCalled();
});

test('shutdown closes concurrently, refuses a nonsettling client and retries its retained owner', async () => {
  client.close.mockReturnValue(new Promise(() => {}));
  await mcp.connectSingleServer(config, register);
  const second = { ...client, close: jest.fn().mockResolvedValue(undefined) };
  createClient.mockImplementationOnce(() => second);
  await mcp.connectSingleServer({ ...config, name: 'second' }, register);
  let completed = false;
  const shutdown = mcp.shutdownMcpServers().then(() => { completed = true; return ''; }, error => error.message);
  await settle();
  expect(client.close).toHaveBeenCalledTimes(1);
  expect(second.close).toHaveBeenCalledTimes(1);
  expect(completed).toBe(false);
  await jest.advanceTimersByTimeAsync(5000);
  expect(completed).toBe(false);
  expect(await shutdown).toMatch(/Cleanup timed out/);
  client.close.mockResolvedValue(undefined);
  await mcp.shutdownMcpServers();
  expect(client.close).toHaveBeenCalledTimes(2);
  expect(closeTransport).toHaveBeenCalledTimes(3);
  expect(second.close).toHaveBeenCalledTimes(1);
  expect(mcp.getMcpStatus()).toEqual([]);
});

test('protocol close cannot discard a failed transport owner, replacement retries before spawning', async () => {
  await mcp.connectSingleServer(config, register);
  closeTransport.mockRejectedValue(new Error('retained Job stop unconfirmed'));
  await expect(mcp.disconnectMcpServer(config.name)).rejects.toThrow(/unconfirmed/);
  expect(await mcp.connectSingleServer(config, register)).toMatchObject({ connected: false, error: 'retained Job stop unconfirmed' });
  expect(createClient).toHaveBeenCalledTimes(1);
  closeTransport.mockResolvedValue(undefined);
  expect(await mcp.connectSingleServer(config, register)).toMatchObject({ connected: true });
  expect(createClient).toHaveBeenCalledTimes(2);
  await mcp.shutdownMcpServers();
});

test('disconnect cancels an unfinished generation and ignores late discovery', async () => {
  const discovery = deferred<{ tools: typeof tool[] }>();
  client.listTools.mockReturnValue(discovery.promise);
  const connecting = mcp.connectSingleServer(config, register);
  await settle();
  await mcp.disconnectMcpServer(config.name);
  expect(await connecting).toMatchObject({ connected: false });
  discovery.resolve({ tools: [tool] }); await settle();
  expect(register).not.toHaveBeenCalled();
  expect(closeTransport).toHaveBeenCalledTimes(1);
});

test('simultaneous replacements admit only the newest generation', async () => {
  const first = mcp.connectSingleServer(config, register);
  const second = mcp.connectSingleServer(config, register);
  expect(await first).toMatchObject({ connected: false });
  expect(await second).toMatchObject({ connected: true });
  expect(createClient).toHaveBeenCalledTimes(1);
  await mcp.shutdownMcpServers();
});

test('repeated shutdown requests share cleanup without closing a client twice', async () => {
  await mcp.connectSingleServer(config, register);
  const closing = deferred<void>();
  client.close.mockReturnValue(closing.promise);
  const first = mcp.shutdownMcpServers();
  const second = mcp.shutdownMcpServers();
  expect(first).toBe(second);
  await settle();
  expect(client.close).toHaveBeenCalledTimes(1);
  closing.resolve();
  await first;
  expect(jest.getTimerCount()).toBe(0);
});

test('shutdown during replacement cleanup prevents a new connection after its await', async () => {
  await mcp.connectSingleServer(config, register);
  const closing = deferred<void>();
  client.close.mockReturnValue(closing.promise);
  const replacement = mcp.connectSingleServer(config, register);
  await settle();
  expect(client.close).toHaveBeenCalledTimes(1);
  const shutdown = mcp.shutdownMcpServers();
  closing.resolve();
  await shutdown;
  expect(await replacement).toMatchObject({ connected: false });
  expect(createClient).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledTimes(1);
  expect(mcp.getMcpStatus()).toEqual([]);
});
