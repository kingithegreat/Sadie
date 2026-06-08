/**
 * SADIE MCP (Model Context Protocol) Client
 *
 * Connects to MCP servers, fetches their tool lists, and bridges them into
 * SADIE's native tool registry so the LLM can call them transparently.
 *
 * Supports:
 *   - stdio servers  (local processes)
 *   - SSE servers    (remote HTTP endpoints)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ─── Config types ─────────────────────────────────────────────────────────────

export interface McpStdioConfig {
  type: 'stdio';
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
}

export interface McpSseConfig {
  type: 'sse';
  name: string;
  url: string;
  enabled?: boolean;
}

export type McpServerConfig = McpStdioConfig | McpSseConfig;

export interface McpServersFile {
  servers: McpServerConfig[];
}

// ─── Runtime state ────────────────────────────────────────────────────────────

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  toolNames: string[];
}

const connectedServers: ConnectedServer[] = [];

const MCP_CONNECT_TIMEOUT = 15_000;
const MCP_MAX_RETRIES = 2;
const MCP_RETRY_DELAY = 3_000;

// ─── Config path ─────────────────────────────────────────────────────────────

function mcpConfigPath(): string {
  return path.join(app.getPath('userData'), 'config', 'mcp-servers.json');
}

// ─── Bridge ───────────────────────────────────────────────────────────────────

/**
 * Load mcp-servers.json from the user-data config directory.
 * Falls back to an empty list if the file doesn't exist.
 */
export function loadMcpConfig(): McpServersFile {
  const cfgPath = mcpConfigPath();
  if (!fs.existsSync(cfgPath)) {
    return { servers: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as McpServersFile;
  } catch (err) {
    console.error('[MCP] Failed to parse mcp-servers.json:', err);
    return { servers: [] };
  }
}

/**
 * Persist mcp-servers.json to the user-data config directory.
 */
export function saveMcpConfig(config: McpServersFile): void {
  const cfgPath = mcpConfigPath();
  const dir = path.dirname(cfgPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Connect to all enabled MCP servers from config and bridge their tools into
 * SADIE's tool registry.
 *
 * @param registerTool  SADIE's registerTool function
 */
export async function initializeMcpServers(
  registerTool: (name: string, definition: any, handler: any) => void
): Promise<void> {
  const { servers } = loadMcpConfig();
  const enabled = servers.filter(s => s.enabled !== false);

  if (enabled.length === 0) {
    console.log('[MCP] No enabled servers configured.');
    return;
  }

  for (const config of enabled) {
    let connected = false;
    for (let attempt = 0; attempt <= MCP_MAX_RETRIES && !connected; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[MCP] Retrying "${config.name}" (attempt ${attempt + 1}/${MCP_MAX_RETRIES + 1})...`);
          await new Promise(r => setTimeout(r, MCP_RETRY_DELAY));
        }
        await connectServer(config, registerTool);
        connected = true;
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (attempt === MCP_MAX_RETRIES) {
          console.error(`[MCP] Failed to connect to "${config.name}" after ${MCP_MAX_RETRIES + 1} attempts: ${msg}`);
        } else {
          console.warn(`[MCP] "${config.name}" attempt ${attempt + 1} failed: ${msg}`);
        }
      }
    }
  }
}

async function connectServer(
  config: McpServerConfig,
  registerTool: (name: string, definition: any, handler: any) => void
): Promise<void> {
  const client = new Client(
    { name: 'sadie', version: '1.0.0' },
    { capabilities: {} }
  );

  let transport;
  if (config.type === 'stdio') {
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
      cwd: config.cwd,
      stderr: 'pipe'
    });
  } else {
    transport = new SSEClientTransport(new URL(config.url));
  }

  await Promise.race([
    client.connect(transport),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timed out after ${MCP_CONNECT_TIMEOUT}ms`)), MCP_CONNECT_TIMEOUT)
    ),
  ]);
  console.log(`[MCP] Connected to "${config.name}"`);

  // Fetch the tool list
  const { tools } = await client.listTools();
  const toolNames: string[] = [];

  for (const mcpTool of tools) {
    const prefixedName = `mcp_${config.name}_${mcpTool.name}`;
    toolNames.push(prefixedName);

    // Build a SADIE-compatible ToolDefinition
    const definition = {
      name: prefixedName,
      description: `[MCP: ${config.name}] ${mcpTool.description ?? mcpTool.name}`,
      category: 'utility' as const,
      parameters: {
        type: 'object' as const,
        properties: (mcpTool.inputSchema?.properties ?? {}) as Record<string, any>,
        required: (mcpTool.inputSchema?.required as string[] | undefined) ?? []
      }
    };

    // Build a SADIE-compatible ToolHandler
    const handler = async (args: Record<string, any>) => {
      try {
        const result = await client.callTool({ name: mcpTool.name, arguments: args });

        // MCP returns content[] — flatten to a single string result for SADIE
        const content = (result as any).content as any[];
        const text = content
          .map((c: any) => {
            if (c.type === 'text') return c.text;
            if (c.type === 'image') return `[image: ${c.mimeType}]`;
            return JSON.stringify(c);
          })
          .join('\n');

        return { success: !(result as any).isError, result: { text } };
      } catch (err: any) {
        return { success: false, error: `MCP tool error: ${err.message}` };
      }
    };

    registerTool(prefixedName, definition, handler);
    console.log(`[MCP]   Registered tool: ${prefixedName}`);
  }

  connectedServers.push({ config, client, toolNames });
  console.log(`[MCP] "${config.name}" registered ${toolNames.length} tool(s).`);
}

// ─── Default server catalogue ────────────────────────────────────────────────

function getDefaultServers(): McpServerConfig[] {
  const home = os.homedir();
  return [
    {
      type: 'stdio',
      name: 'filesystem',
      command: 'cmd',
      args: [
        '/c', 'npx', '-y', '@modelcontextprotocol/server-filesystem',
        path.join(home, 'Desktop'),
        path.join(home, 'Documents'),
        path.join(home, 'Downloads'),
      ],
      enabled: true,
    },
    {
      type: 'stdio',
      name: 'memory',
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-memory'],
      enabled: true,
    },
    {
      type: 'stdio',
      name: 'fetch',
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-fetch'],
      enabled: false,
    },
    {
      type: 'stdio',
      name: 'playwright',
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@playwright/mcp@latest', '--headless'],
      enabled: false, // opt-in: heavy, needs Playwright browsers installed
    },
    {
      type: 'stdio',
      name: 'brave-search',
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '' },
      enabled: false, // set BRAVE_API_KEY and enable
    },
    {
      type: 'stdio',
      name: 'github',
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: '' },
      enabled: false, // set GITHUB_TOKEN and enable
    },
  ];
}

/**
 * Write default MCP server configs to userData on first run.
 * Skips if the file already exists (respects user customisations).
 */
export function seedMcpDefaults(): void {
  const cfgPath = mcpConfigPath();
  if (fs.existsSync(cfgPath)) return;
  const defaults: McpServersFile = { servers: getDefaultServers() };
  const dir = path.dirname(cfgPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(defaults, null, 2), 'utf-8');
  console.log('[MCP] Seeded default server configs to', cfgPath);
}

/**
 * Scan well-known external MCP config files (Cursor, Claude Desktop, VS Code Insiders)
 * and merge any servers not already known into SADIE's own config.
 *
 * Only adds new entries — never removes or modifies existing ones, so manual
 * customisations are always preserved.
 */
export function discoverExternalMcpServers(): void {
  const home = os.homedir();

  // Candidate external config paths (Windows + macOS/Linux variants)
  const candidatePaths: string[] = [
    // Cursor
    path.join(home, '.cursor', 'mcp.json'),
    path.join(home, 'AppData', 'Roaming', 'Cursor', 'User', 'mcp.json'),
    // Claude Desktop (Anthropic)
    path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    // VS Code Insiders MCP
    path.join(home, 'AppData', 'Roaming', 'Code - Insiders', 'User', 'mcp.json'),
    path.join(home, '.config', 'Code - Insiders', 'User', 'mcp.json'),
    // Generic ~/.config/mcp
    path.join(home, '.config', 'mcp', 'servers.json'),
  ];

  const current = loadMcpConfig();
  const existingNames = new Set(current.servers.map(s => s.name));
  let added = 0;

  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Different tools use different shapes — normalise to McpServerConfig[]
      const entries: McpServerConfig[] = [];

      // Shape 1: { servers: [...] } — SADIE / generic
      if (Array.isArray(raw?.servers)) {
        entries.push(...(raw.servers as any[]));
      }

      // Shape 2: { mcpServers: { name: { command, args, env } } } — Cursor / Claude Desktop
      if (raw?.mcpServers && typeof raw.mcpServers === 'object') {
        for (const [name, cfg] of Object.entries(raw.mcpServers as Record<string, any>)) {
          if (cfg.command) {
            entries.push({
              type: 'stdio',
              name,
              command: cfg.command,
              args: cfg.args ?? [],
              env: cfg.env ?? {},
              enabled: true,
            } satisfies McpStdioConfig);
          } else if (cfg.url) {
            entries.push({
              type: 'sse',
              name,
              url: cfg.url,
              enabled: true,
            } satisfies McpSseConfig);
          }
        }
      }

      for (const entry of entries) {
        if (!entry.name || existingNames.has(entry.name)) continue;
        // Validate minimally
        if (entry.type === 'stdio' && !(entry as McpStdioConfig).command) continue;
        if (entry.type === 'sse' && !(entry as McpSseConfig).url) continue;

        current.servers.push({ ...entry, enabled: false }); // disabled by default — user opts in
        existingNames.add(entry.name);
        added++;
        console.log(`[MCP] Auto-discovered server "${entry.name}" from ${filePath} (disabled by default)`);
      }
    } catch (err) {
      console.warn(`[MCP] Failed to parse external config at ${filePath}:`, err);
    }
  }

  if (added > 0) {
    saveMcpConfig(current);
    console.log(`[MCP] Auto-discovery: added ${added} new server(s) to config (all disabled by default — enable in Settings)`);
  }
}

/**
 * Disconnect all connected MCP servers (call on app quit).
 */
export async function shutdownMcpServers(): Promise<void> {
  for (const { client, config } of connectedServers) {
    try {
      await client.close();
      console.log(`[MCP] Disconnected from "${config.name}"`);
    } catch (err) {
      // Ignore errors during shutdown
    }
  }
  connectedServers.length = 0;
}

/**
 * Returns a summary of connected servers and their tool counts (for the UI).
 */
export function getMcpStatus(): Array<{ name: string; type: string; toolCount: number; connected: boolean }> {
  return connectedServers.map(s => ({
    name: s.config.name,
    type: s.config.type,
    toolCount: s.toolNames.length,
    connected: true
  }));
}
