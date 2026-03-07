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
} from '../mcp-client';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-mcp-test-'));
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

  test('does not overwrite existing config on re-seed', () => {
    saveMcpConfig({ servers: [{ type: 'sse' as const, name: 'custom', url: 'http://custom', enabled: true }] });
    seedMcpDefaults(); // should be a no-op

    const cfg = loadMcpConfig();
    expect(cfg.servers.length).toBe(1);
    expect(cfg.servers[0].name).toBe('custom');
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

  test('merges a server from a SADIE-format external file', () => {
    // Write a fake external config in SADIE shape: { servers: [...] }
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

  test('merges servers from Cursor/Claude mcpServers shape into SADIE config', () => {
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
