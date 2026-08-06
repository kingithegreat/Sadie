/**
 * assistant-bridge.ts — exposes HomeBot's own tools to an external agent
 * (currently Claude Code) as an MCP server over loopback HTTP.
 *
 * WHY THIS EXISTS
 * Claude Code in `-p` mode executes its native tools with no approval step —
 * measured, not assumed: a prompt asking it to run a shell command returned
 * `permission_denials: 0` and the command had already run. So enabling its own
 * Bash/Edit/Write would give the user an assistant that touches their machine
 * with no prompt, which is precisely what they asked to avoid.
 *
 * Instead, Claude Code's native tools stay denied and it is handed HomeBot's
 * tools through MCP. Every call then lands in `executeTool()`, which enforces
 * `assertPermission` + `requestConfirmation` + the destructive-command
 * blocklist + the home-directory sandbox. One gate, the one already trusted,
 * and it works the same for every provider rather than only this one.
 *
 * SECURITY POSTURE
 *  - Bound to 127.0.0.1 on an ephemeral port; never a routable interface.
 *  - Every request must carry a per-session bearer token generated at start.
 *    Loopback alone is not enough: any local process could otherwise drive
 *    HomeBot's tools.
 *  - Only an explicit allowlist of tools is exposed (see CODING_TOOLS) — not
 *    the full 113-tool registry.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { executeTool, getTool } from './tools';
import type { ToolDefinition } from './tools/types';

/**
 * Tools the coding/filing assistant may reach. Deliberately narrow: this is a
 * coding assistant, not a remote control for the whole app. Notably absent are
 * email, CRM, automations and anything that spends money or messages people.
 */
export const CODING_TOOLS = [
  // Reading and navigating
  'read_file', 'list_directory', 'search_files', 'find_files',
  'grep_code', 'project_tree', 'analyze_file', 'get_file_info',
  // Editing
  'write_file', 'edit_file', 'create_directory',
  // Version control (read-only + commit; no push)
  'git_status', 'git_diff', 'git_log', 'git_branches',
  // Diffing
  'diff_text', 'diff_files',
  // Execution — gated by requiresConfirmation + the destructive blocklist
  'run_terminal_command',
] as const;

export interface BridgeHandle {
  url: string;
  token: string;
  close: () => void;
}

let handle: BridgeHandle | null = null;

/** JSON-RPC helpers — the MCP wire format. */
const rpcResult = (id: unknown, result: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) =>
  JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });

/** ToolDefinition -> MCP inputSchema. */
function toMcpTool(def: ToolDefinition) {
  return {
    name: def.name,
    description: def.description,
    inputSchema: {
      type: 'object',
      properties: def.parameters?.properties ?? {},
      required: def.parameters?.required ?? [],
    },
  };
}

/** Constant-time compare so the token can't be probed by timing. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface BridgeOptions {
  /** Prompts the user. Returning false must abort the tool call. */
  requestConfirmation: (message: string) => Promise<boolean>;
  /** Surface each attempt to the UI so tool use is never invisible. */
  onToolActivity?: (info: { tool: string; allowed: boolean; error?: string }) => void;
}

/**
 * Start the bridge. Idempotent — repeat calls return the existing handle so a
 * second chat turn doesn't leak another listener.
 */
export async function startAssistantBridge(options: BridgeOptions): Promise<BridgeHandle> {
  if (handle) return handle;

  const token = randomUUID().replace(/-/g, '');

  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: string) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    };

    // Bearer token on every request — loopback is not an authorisation boundary.
    const auth = (req.headers['authorization'] || '') as string;
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!provided || !tokenMatches(provided, token)) {
      send(401, JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (req.method !== 'POST') { send(405, JSON.stringify({ error: 'method not allowed' })); return; }

    let raw = '';
    req.on('data', (c) => {
      raw += c;
      // Refuse absurd bodies rather than buffering without bound.
      if (raw.length > 4 * 1024 * 1024) { req.destroy(); }
    });
    req.on('end', async () => {
      let msg: any;
      try { msg = JSON.parse(raw); } catch { send(400, rpcError(null, -32700, 'Parse error')); return; }

      const { id, method, params } = msg || {};

      try {
        if (method === 'initialize') {
          send(200, rpcResult(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'homebot', version: '1.0.0' },
          }));
          return;
        }

        // Notifications carry no id and expect no response body.
        if (method === 'notifications/initialized') { send(202, ''); return; }

        if (method === 'tools/list') {
          const tools = CODING_TOOLS
            .map(name => getTool(name)?.definition)
            .filter((d): d is ToolDefinition => !!d)
            .map(toMcpTool);
          send(200, rpcResult(id, { tools }));
          return;
        }

        if (method === 'tools/call') {
          const name = params?.name;
          const args = params?.arguments ?? {};

          // Allowlist check first: a tool outside CODING_TOOLS must never run,
          // even if the registry has it.
          if (!CODING_TOOLS.includes(name)) {
            options.onToolActivity?.({ tool: String(name), allowed: false, error: 'not exposed' });
            send(200, rpcResult(id, {
              content: [{ type: 'text', text: `Tool "${name}" is not available to the assistant.` }],
              isError: true,
            }));
            return;
          }

          // The gate: assertPermission + requestConfirmation + per-tool guards
          // all live inside executeTool.
          const result = await executeTool(
            { name, arguments: args },
            {
              executionId: randomUUID(),
              requestConfirmation: options.requestConfirmation,
            },
          );

          options.onToolActivity?.({
            tool: name,
            allowed: !!result.success,
            error: result.success ? undefined : result.error,
          });

          const text = result.success
            ? (typeof result.result === 'string' ? result.result : JSON.stringify(result.result ?? null, null, 2))
            : `Error: ${result.error || 'Tool failed.'}`;

          send(200, rpcResult(id, { content: [{ type: 'text', text }], isError: !result.success }));
          return;
        }

        send(200, rpcError(id, -32601, `Method not found: ${method}`));
      } catch (e: any) {
        send(200, rpcError(id, -32603, e?.message || String(e)));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // 127.0.0.1 explicitly — NOT 0.0.0.0. Port 0 asks the OS for a free port.
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  handle = {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () => { try { server.close(); } catch { /* already closed */ } handle = null; },
  };
  console.log(`[assistant-bridge] listening on ${handle.url}`);
  return handle;
}

export function stopAssistantBridge(): void {
  handle?.close();
  handle = null;
}

/** Test seam. */
export function __getBridgeHandleForTest(): BridgeHandle | null {
  return handle;
}
