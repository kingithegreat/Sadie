/**
 * Connections catalogue — the front door to MCP, in words a person can read.
 *
 * The mechanism (mcp-client.ts, the permission gate, the hand-entry form in
 * PrivacySettingsTab) works and stays untouched. What was missing is the way
 * in: nobody who does not know what MCP is can reach it, because reaching it
 * meant Settings → Permissions → typing a stdio command line. This file is the
 * curated list Plan.md asked for — a short set of services people actually
 * use, each one click to connect with the technical details pre-filled, each
 * saying what it lets HomeBot reach and what an account costs BEFORE connecting.
 *
 * Every entry builds a plain McpStdioConfig-shaped object and goes through the
 * SAME mcpAddServer IPC path as the hand-entry form. Nothing here bypasses the
 * permission gate, and nothing here arrives by inheriting another app's MCP
 * config — HomeBot mediates what it installs (--strict-mcp-config lesson),
 * and this catalogue keeps that true by construction.
 *
 * Credentials are the user's. The catalogue never ships a key, never fetches
 * one, and says where each one comes from instead.
 */

/** What plugging this service in costs beyond HomeBot itself. */
export type ConnectionCost =
  | 'free-local'    // no account, no key
  | 'free-key'      // account needed, key is free
  | 'paid-account'; // cannot be used without paying someone

export interface ConnectionKey {
  /** The env var the MCP server reads. */
  key: string;
  /** What the user should paste, in words. */
  label: string;
  /** Rendered as a password field when true. */
  secret: boolean;
  /** Where this value comes from — a signup page, a settings screen. */
  whereToGet: string;
}

export interface ConnectionEntry {
  /** Stable id — also the navContext.service key chat can send. */
  id: string;
  name: string;
  /** What HomeBot can do once connected, concretely. */
  reach: string;
  cost: ConnectionCost;
  /** Extra honesty when 'free-key' has a paid tier or similar. */
  costNote?: string;
  /** Name stored in mcp-servers.json — also how duplicates are detected. */
  serverName: string;
  command: string;
  args: string[];
  /**
   * Keys the user must fill before Connect enables. Values become env vars
   * named by `.key`, except where `envTemplates` composes them.
   */
  keys: ConnectionKey[];
  /** Env vars composed FROM collected values — '{NOTION_TOKEN}' placeholders. */
  envTemplates?: Record<string, string>;
  docsUrl: string;
}

/** Structurally McpStdioConfig — kept local so shared/ imports nothing from main/. */
export interface ConnectionServerConfig {
  type: 'stdio';
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

const GITHUB_TOKEN_URL = 'https://github.com/settings/tokens';
const NOTION_INTEGRATIONS_URL = 'https://www.notion.so/profile/integrations';
const SLACK_APPS_URL = 'https://api.slack.com/quickstart';
const BRAVE_API_URL = 'https://brave.com/search/api/';

export const CONNECTIONS: ReadonlyArray<ConnectionEntry> = [
  {
    id: 'notion',
    name: 'Notion',
    reach: 'Read and search your Notion pages and databases, and edit pages when you ask.',
    cost: 'free-key',
    costNote: 'Notion accounts are free; you create an "integration" and paste its token.',
    serverName: 'notion',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    keys: [
      {
        key: 'NOTION_TOKEN',
        label: 'Notion integration token (starts with ntn_)',
        secret: true,
        whereToGet: NOTION_INTEGRATIONS_URL,
      },
    ],
    envTemplates: {
      OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer {NOTION_TOKEN}","Notion-Version":"2022-06-28"}',
    },
    docsUrl: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'github',
    name: 'GitHub',
    reach: 'Read your repositories, issues and pull requests, and create issues or comment when you ask.',
    cost: 'free-key',
    serverName: 'github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    keys: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal access token (classic, with repo scope)',
        secret: true,
        whereToGet: GITHUB_TOKEN_URL,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'slack',
    name: 'Slack',
    reach: 'List channels and read messages, and post messages when you ask.',
    cost: 'free-key',
    costNote: 'Works on Slack free plans; you create a Slack app and paste its bot token.',
    serverName: 'slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    keys: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Bot token (starts with xoxb-)',
        secret: true,
        whereToGet: SLACK_APPS_URL,
      },
      {
        key: 'SLACK_TEAM_ID',
        label: 'Workspace ID (the T… part from your workspace URL)',
        secret: false,
        whereToGet: 'https://api.slack.com/methods/admin.teams.teams.list',
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    reach: 'Web search for HomeBot — real results instead of asking you to rephrase.',
    cost: 'free-key',
    costNote: 'A free tier covers normal use; heavier use is paid.',
    serverName: 'brave-search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    keys: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Search API key',
        secret: true,
        whereToGet: BRAVE_API_URL,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'web-fetch',
    name: 'Web Fetch',
    reach: 'Fetch a web page on request and hand its contents to the assistant as clean text.',
    cost: 'free-local',
    serverName: 'web-fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    keys: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'memory',
    name: 'Memory',
    reach: 'A private notebook the assistant keeps between conversations — facts about you and your projects, stored on this PC.',
    cost: 'free-local',
    serverName: 'memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    keys: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
];

/** The entry whose id matches, so chat payloads like {service:'notion'} resolve. */
export function findConnection(id: unknown): ConnectionEntry | undefined {
  if (typeof id !== 'string') return undefined;
  const needle = id.trim().toLowerCase();
  return CONNECTIONS.find((c) => c.id === needle);
}

function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Z0-9_]+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : `{${key}}`,
  );
}

/**
 * Build the config mcpAddServer stores, or say plainly why not yet.
 *
 * Refusing to produce a half-filled config is the point: a connection saved
 * without its key starts, fails, and looks broken — worse than a disabled
 * button saying which box is empty.
 */
export function buildServerConfig(
  entry: ConnectionEntry,
  values: Record<string, string>,
): { ok: true; config: ConnectionServerConfig } | { ok: false; error: string } {
  const missing = entry.keys.filter((k) => !(values[k.key] ?? '').trim());
  if (missing.length > 0) {
    return {
      ok: false,
      error: `${entry.name} needs ${missing.map((k) => k.label).join(' and ')} before it can connect.`,
    };
  }

  const filled: Record<string, string> = {};
  for (const k of entry.keys) filled[k.key] = values[k.key].trim();

  const env: Record<string, string> = {};
  for (const k of entry.keys) env[k.key] = filled[k.key];
  for (const [target, template] of Object.entries(entry.envTemplates ?? {})) {
    env[target] = substitute(template, filled);
  }

  return {
    ok: true,
    config: {
      type: 'stdio',
      name: entry.serverName,
      command: entry.command,
      args: [...entry.args],
      env: Object.keys(env).length > 0 ? env : undefined,
      enabled: true,
    },
  };
}

/** Human sentence for the cost badge — the same words everywhere it appears. */
export function describeCost(entry: ConnectionEntry): string {
  switch (entry.cost) {
    case 'free-local':
      return 'Free — no account needed';
    case 'free-key':
      return 'Free — needs a free account & key';
    case 'paid-account':
      return 'Needs a paid account';
  }
}

