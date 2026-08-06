/**
 * assistant-bridge.test.ts
 *
 * The bridge lets an EXTERNAL agent (Claude Code) drive HomeBot's tools, so its
 * security properties are the point of this suite, not its ergonomics:
 *
 *   1. A denied confirmation must actually stop the tool running.
 *   2. Only allowlisted tools are reachable, regardless of the registry.
 *   3. Every request needs the session bearer token.
 *   4. It listens on loopback only.
 *
 * Rationale for the bridge existing at all: Claude Code in -p mode runs its own
 * tools with permission_denials: 0 — measured, not assumed. Routing through
 * HomeBot's registry is what restores the approval step.
 */

const executeTool = jest.fn();
const getTool = jest.fn();

jest.mock('../tools', () => ({
  executeTool: (...args: any[]) => executeTool(...args),
  getTool: (...args: any[]) => getTool(...args),
}));

import * as http from 'http';
import {
  startAssistantBridge,
  stopAssistantBridge,
  CODING_TOOLS,
  type BridgeHandle,
} from '../assistant-bridge';

let bridge: BridgeHandle;
let confirmResult = true;
let confirmations: string[] = [];

/** Minimal JSON-RPC client against the bridge. */
function rpc(method: string, params?: unknown, token?: string): Promise<any> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const url = new URL(bridge.url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(token === null ? {} : { Authorization: `Bearer ${token ?? bridge.token}` }),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

beforeAll(async () => {
  bridge = await startAssistantBridge({
    requestConfirmation: async (message: string) => { confirmations.push(message); return confirmResult; },
  });
});

afterAll(() => { stopAssistantBridge(); });

beforeEach(() => {
  executeTool.mockReset();
  getTool.mockReset();
  confirmations = [];
  confirmResult = true;
  getTool.mockImplementation((name: string) => ({
    definition: {
      name,
      description: `desc for ${name}`,
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  }));
});

describe('authentication', () => {
  test('rejects a request with no token', async () => {
    const r = await rpc('tools/list', undefined, null as any);
    expect(r.status).toBe(401);
  });

  test('rejects a wrong token', async () => {
    const r = await rpc('tools/list', undefined, 'not-the-token');
    expect(r.status).toBe(401);
    expect(executeTool).not.toHaveBeenCalled();
  });

  test('rejects a token of a different length (no crash in constant-time compare)', async () => {
    const r = await rpc('tools/list', undefined, 'short');
    expect(r.status).toBe(401);
  });

  test('accepts the session token', async () => {
    const r = await rpc('tools/list');
    expect(r.status).toBe(200);
  });
});

describe('network exposure', () => {
  test('binds to loopback only — never a routable interface', () => {
    expect(bridge.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  test('issues a non-trivial per-session token', () => {
    expect(bridge.token.length).toBeGreaterThanOrEqual(32);
  });
});

describe('tool exposure', () => {
  test('advertises only the curated coding/filing allowlist', async () => {
    const r = await rpc('tools/list');
    const names = r.body.result.tools.map((t: any) => t.name);
    expect(names).toEqual([...CODING_TOOLS]);
  });

  test('the allowlist excludes tools that spend money or contact people', () => {
    for (const risky of ['email_send', 'crm_create_deal', 'create_automation', 'image_generate']) {
      expect(CODING_TOOLS).not.toContain(risky as any);
    }
  });

  test('a tool outside the allowlist is refused even if the registry has it', async () => {
    const r = await rpc('tools/call', { name: 'email_send', arguments: { to: 'x@y.z' } });
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toMatch(/not available/i);
    expect(executeTool).not.toHaveBeenCalled();
  });
});

describe('permission gate', () => {
  test('a call routes through executeTool with a confirmation callback attached', async () => {
    executeTool.mockResolvedValue({ success: true, result: 'file contents' });
    const r = await rpc('tools/call', { name: 'read_file', arguments: { path: 'a.ts' } });

    expect(executeTool).toHaveBeenCalledTimes(1);
    const [call, context] = executeTool.mock.calls[0];
    expect(call).toEqual({ name: 'read_file', arguments: { path: 'a.ts' } });
    // Without this, executeTool's requiresConfirmation branch can never prompt.
    expect(typeof context.requestConfirmation).toBe('function');
    expect(r.body.result.content[0].text).toBe('file contents');
  });

  test('a denied confirmation stops the tool — the user\'s "no" is honoured', async () => {
    // Mirror executeTool's real contract: it consults requestConfirmation and
    // returns a failure when the user declines.
    executeTool.mockImplementation(async (_call: any, ctx: any) => {
      const ok = await ctx.requestConfirmation('Run `rm -rf build`?');
      return ok ? { success: true, result: 'ran' } : { success: false, error: 'User declined' };
    });
    confirmResult = false;

    const r = await rpc('tools/call', { name: 'run_terminal_command', arguments: { command: 'rm -rf build' } });

    expect(confirmations).toHaveLength(1);
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toMatch(/declined/i);
  });

  test('an approved confirmation lets the tool run', async () => {
    executeTool.mockImplementation(async (_call: any, ctx: any) => {
      const ok = await ctx.requestConfirmation('Run `npm test`?');
      return ok ? { success: true, result: 'PASS' } : { success: false, error: 'User declined' };
    });
    confirmResult = true;

    const r = await rpc('tools/call', { name: 'run_terminal_command', arguments: { command: 'npm test' } });
    expect(r.body.result.isError).toBe(false);
    expect(r.body.result.content[0].text).toBe('PASS');
  });

  test('a tool failure is reported as an MCP error, not thrown', async () => {
    executeTool.mockResolvedValue({ success: false, error: 'Access denied' });
    const r = await rpc('tools/call', { name: 'read_file', arguments: { path: '/etc/passwd' } });
    expect(r.status).toBe(200);
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toMatch(/Access denied/);
  });

  test('a throwing tool degrades to a JSON-RPC error instead of killing the server', async () => {
    executeTool.mockRejectedValue(new Error('registry exploded'));
    const r = await rpc('tools/call', { name: 'read_file', arguments: {} });
    expect(r.body.error.message).toMatch(/registry exploded/);
    // Still serving afterwards.
    expect((await rpc('tools/list')).status).toBe(200);
  });
});

describe('protocol', () => {
  test('initialize advertises tool capability', async () => {
    const r = await rpc('initialize');
    expect(r.body.result.capabilities.tools).toBeDefined();
    expect(r.body.result.serverInfo.name).toBe('homebot');
  });

  test('an unknown method returns method-not-found rather than hanging', async () => {
    const r = await rpc('resources/list');
    expect(r.body.error.code).toBe(-32601);
  });

  test('starting twice reuses the same listener instead of leaking one', async () => {
    const again = await startAssistantBridge({ requestConfirmation: async () => true });
    expect(again.url).toBe(bridge.url);
    expect(again.token).toBe(bridge.token);
  });
});
