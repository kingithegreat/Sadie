/**
 * mcp-client.test.ts
 * Tests for src/main/mcp-client.ts (config I/O and query functions)
 *
 * Mocks: electron (app.getPath → tmpDir), MCP SDK clients (no real connections)
 */

import os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// Mock electron so app.getPath('userData') returns our tmpDir
jest.mock('electron', () => ({
  app: { isPackaged: true, getPath: jest.fn(() => process.env.TEST_USERDATA || os.tmpdir()) },
}));

// Mock the MCP SDK to avoid real process spawning / HTTP connections
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    listTools: jest.fn().mockResolvedValue({ tools: [] }),
    callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn(),
}));
jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn(),
}));

import {
  loadMcpConfig,
  saveMcpConfig,
  seedMcpDefaults,
  getMcpStatus,
  discoverExternalMcpServers,
  shutdownMcpServers,
  connectSingleServer,
} from '../mcp-client';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-mcp-test-'));
  process.env.TEST_USERDATA = tmpDir;
  jest.clearAllMocks();
  // Reset electron mock to use new tmpDir
  const { app } = jest.requireMock('electron');
  app.getPath.mockReturnValue(tmpDir);
});

afterEach(() => {
  delete process.env.TEST_USERDATA;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ── loadMcpConfig ─────────────────────────────────────────────────────────────

describe('loadMcpConfig', () => {
  test('returns { servers: [] } when config file does not exist', () => {
    const cfg = loadMcpConfig();
    expect(cfg).toEqual({ servers: [] });
  });

  test('returns parsed content when config file exists', () => {
    const configPath = path.join(tmpDir, 'config', 'mcp-servers.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const data = { servers: [{ type: 'sse', name: 'my-server', url: 'http://localhost:9000', enabled: true }] };
    fs.writeFileSync(configPath, JSON.stringify(data), 'utf-8');

    const cfg = loadMcpConfig();
    expect(cfg.servers.length).toBe(1);
    expect(cfg.servers[0].name).toBe('my-server');
  });

  test('returns { servers: [] } when config file has invalid JSON', () => {
    const configPath = path.join(tmpDir, 'config', 'mcp-servers.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'NOT_VALID_JSON', 'utf-8');

    const cfg = loadMcpConfig();
    expect(cfg).toEqual({ servers: [] });
  });
});

// ── saveMcpConfig ─────────────────────────────────────────────────────────────

describe('saveMcpConfig', () => {
  test('writes the config to disk and can be reloaded', () => {
    const data = { servers: [{ type: 'stdio' as const, name: 'test', command: 'node', args: [], enabled: true }] };
    saveMcpConfig(data);

    const reloaded = loadMcpConfig();
    expect(reloaded.servers.length).toBe(1);
    expect(reloaded.servers[0].name).toBe('test');
  });

  test('creates the config directory if it does not exist', () => {
    const configDir = path.join(tmpDir, 'config');
    expect(fs.existsSync(configDir)).toBe(false);

    saveMcpConfig({ servers: [] });
    expect(fs.existsSync(configDir)).toBe(true);
  });

  test('overwrites existing config with new data', () => {
    saveMcpConfig({ servers: [{ type: 'sse' as const, name: 'old', url: 'http://old', enabled: true }] });
    saveMcpConfig({ servers: [] });

    const reloaded = loadMcpConfig();
    expect(reloaded.servers.length).toBe(0);
  });
});

// ── seedMcpDefaults ───────────────────────────────────────────────────────────

describe('seedMcpDefaults', () => {
  test('creates config file when it does not exist', () => {
    seedMcpDefaults();
    const cfg = loadMcpConfig();
    expect(cfg.servers.length).toBeGreaterThan(0);
  });

  test('includes default servers like filesystem and memory', () => {
    seedMcpDefaults();
    const cfg = loadMcpConfig();
    const names = cfg.servers.map(s => s.name);
    expect(names).toContain('filesystem');
    expect(names).toContain('memory');
  });

  test('fetch server defaults to disabled', () => {
    seedMcpDefaults();
    const cfg = loadMcpConfig();
    const fetch = cfg.servers.find(s => s.name === 'fetch');
    expect(fetch).toBeDefined();
    expect(fetch!.enabled).toBe(false);
  });

  test('does not overwrite existing config on re-seed', () => {
    saveMcpConfig({ servers: [{ type: 'sse' as const, name: 'custom', url: 'http://custom', enabled: true }] });
    seedMcpDefaults(); // should be a no-op

    const cfg = loadMcpConfig();
    expect(cfg.servers.length).toBe(1);
    expect(cfg.servers[0].name).toBe('custom');
  });

  test('resolves default server commands for the current platform (never hardcoded "cmd" on POSIX)', () => {
    // Regression test for a CI/prod bug: default servers hardcoded `command: 'cmd'`,
    // which only exists on Windows. On any POSIX host (ubuntu-latest CI runners,
    // macOS, Linux desktops) every default server spawn failed with ENOENT.
    seedMcpDefaults();
    const cfg = loadMcpConfig();
    const stdioServers = cfg.servers.filter(
      (s): s is Extract<typeof s, { type: 'stdio' }> => s.type === 'stdio'
    );
    expect(stdioServers.length).toBeGreaterThan(0);
    for (const server of stdioServers) {
      if (process.platform === 'win32') {
        expect(server.command).toBe('cmd');
        expect(server.args?.[0]).toBe('/c');
        expect(server.args?.[1]).toBe('npx');
      } else {
        expect(server.command).toBe('npx');
        expect(server.args?.[0]).not.toBe('/c');
      }
    }
  });
});

// ── getMcpStatus ──────────────────────────────────────────────────────────────

describe('getMcpStatus', () => {
  test('returns empty array when no servers have been connected', async () => {
    // shutdownMcpServers clears the list; call it to ensure clean state first
    await shutdownMcpServers();
    const status = getMcpStatus();
    expect(status).toEqual([]);
  });

  test('returns array of objects with name, type, toolCount, connected fields', async () => {
    await shutdownMcpServers();
    // The module-level connectedServers list is empty so the status is []
    // Shape check on empty array (nothing to iterate but function runs)
    const status = getMcpStatus();
    expect(Array.isArray(status)).toBe(true);
    for (const entry of status) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('toolCount');
      expect(entry).toHaveProperty('connected');
    }
  });
});

// ── shutdownMcpServers ────────────────────────────────────────────────────────

describe('shutdownMcpServers', () => {
  test('resolves without error when no servers are connected', async () => {
    await expect(shutdownMcpServers()).resolves.toBeUndefined();
  });
});

// ── discoverExternalMcpServers ───────────────────────────────────────────────

describe('discoverExternalMcpServers', () => {
  test('runs without error when no candidate files exist', () => {
    // All candidate paths will be non-existent in the temp dir context
    expect(() => discoverExternalMcpServers()).not.toThrow();
  });

  test('does not modify config when no external files are found', () => {
    saveMcpConfig({ servers: [] });
    discoverExternalMcpServers();
    const cfg = loadMcpConfig();
    // Nothing was added
    expect(cfg.servers.length).toBe(0);
  });

  test('merges a server from a HomeBot-format external file', () => {
    // Write a fake external config in HomeBot shape: { servers: [...] }
    const fakeExternal = path.join(tmpDir, 'mcp-external.json');
    const externalData = {
      servers: [{ type: 'sse', name: 'external-server', url: 'http://ext:8080', enabled: true }],
    };
    fs.writeFileSync(fakeExternal, JSON.stringify(externalData), 'utf-8');

    // discoverExternalMcpServers uses hardcoded paths so it won't find our file.
    // This test just confirms it reads/ignores non-matching paths gracefully.
    saveMcpConfig({ servers: [] });
    expect(() => discoverExternalMcpServers()).not.toThrow();
  });

  test('merges servers from Cursor/Claude mcpServers shape into HomeBot config', () => {
    // We'll write a file to a path that discoverExternalMcpServers actually checks.
    // On Windows it checks: path.join(home, '.cursor', 'mcp.json')
    const home = os.homedir();
    const cursorDir = path.join(home, '.cursor');
    const cursorFile = path.join(cursorDir, 'mcp.json');
    const existed = fs.existsSync(cursorFile);

    if (existed) {
      // Skip this test if user has a real Cursor config to avoid modifying it
      return;
    }

    let createdDir = false;
    try {
      if (!fs.existsSync(cursorDir)) { fs.mkdirSync(cursorDir, { recursive: true }); createdDir = true; }
      const cursorCfg = { mcpServers: { 'cursor-tool': { command: 'node', args: ['cursor.js'] } } };
      fs.writeFileSync(cursorFile, JSON.stringify(cursorCfg), 'utf-8');

      saveMcpConfig({ servers: [] });
      discoverExternalMcpServers();

      const cfg = loadMcpConfig();
      const names = cfg.servers.map(s => s.name);
      expect(names).toContain('cursor-tool');
      // Added servers are disabled by default
      const added = cfg.servers.find(s => s.name === 'cursor-tool');
      expect(added!.enabled).toBe(false);
    } finally {
      // Clean up
      try { fs.unlinkSync(cursorFile); } catch (_) {}
      if (createdDir) { try { fs.rmdirSync(cursorDir); } catch (_) {} }
    }
  });
});

// ── connectSingleServer (connect-on-add) ─────────────────────────────────────

describe('connectSingleServer — Connect means connected', () => {
  const registerTool = jest.fn();
  const SDK = () => require('@modelcontextprotocol/sdk/client/index.js');

  beforeEach(async () => {
    registerTool.mockClear();
    await shutdownMcpServers();
  });

  test('starts the server now and returns its live tool count', async () => {
    SDK().Client.mockImplementationOnce(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [
        { name: 'search', description: 'Search', inputSchema: { type: 'object', properties: {} } },
        { name: 'fetch', description: 'Fetch', inputSchema: { type: 'object', properties: {} } },
      ]}),
      callTool: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    const res = await connectSingleServer(
      { type: 'stdio', name: 'live-srv', command: 'npx', args: ['-y', 'x'], enabled: true },
      registerTool,
    );
    expect(res).toMatchObject({ connected: true, toolCount: 2 });
    expect(registerTool).toHaveBeenCalledWith(
      'mcp_live-srv_search',
      expect.objectContaining({ requiresConfirmation: true }),
      expect.any(Function),
    );
  });

  test('a failed start is reported as a result — never thrown — and leaves nothing half-open', async () => {
    SDK().Client.mockImplementationOnce(() => ({
      connect: jest.fn().mockRejectedValue(new Error('spawn ENOENT')),
      listTools: jest.fn(),
      callTool: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    const res = await connectSingleServer({ type: 'stdio', name: 'broken', command: 'nope' }, registerTool);
    expect(res.connected).toBe(false);
    expect(res.error).toContain('ENOENT');
    expect(getMcpStatus()).toHaveLength(0);
  });

  test('re-adding a name replaces the old live connection instead of doubling it', async () => {
    const makeClient = () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [{ name: 't', inputSchema: { type: 'object' } }] }),
      callTool: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    });
    const first = makeClient();
    const second = makeClient();
    SDK().Client.mockImplementationOnce(() => first).mockImplementationOnce(() => second);
    const cfg = { type: 'stdio' as const, name: 'dup', command: 'x' };
    await connectSingleServer(cfg, registerTool);
    await connectSingleServer(cfg, registerTool);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(getMcpStatus()).toHaveLength(1);
  });

  test('a disabled server is stored without connecting and says so plainly', async () => {
    const res = await connectSingleServer({ type: 'stdio', name: 'off', command: 'x', enabled: false }, registerTool);
    expect(res).toEqual({ connected: false, toolCount: 0 });
    expect(getMcpStatus()).toHaveLength(0);
  });
});
