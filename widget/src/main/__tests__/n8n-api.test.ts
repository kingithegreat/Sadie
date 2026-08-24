/**
 * n8n API layer tests
 *
 * Covers the transport selection added for authenticated n8n access:
 * - REST path (API key from HomeBot Settings â†’ X-N8N-API-KEY header)
 * - Docker CLI fallback when no key is configured (incl. the supported
 *   `n8n update:workflow --active=true` activation, replacing the old
 *   direct-SQLite hack)
 * - workflow JSON validation shared with the import tool
 */

jest.mock('electron', () => ({
  app: {
    getPath: (_name: string) => require('os').tmpdir(),
  },
}));
jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('axios', () => ({
  __esModule: true,
  default: { request: jest.fn(), get: jest.fn(), post: jest.fn() },
}));

import { execFile } from 'child_process';
import axios from 'axios';
import {
  registerN8nConnectionProvider,
  validateWorkflowJson,
  importWorkflow,
  activateWorkflow,
  deleteWorkflow,
  listWorkflows,
  extractWebhookUrl,
  verifyN8nConnection,
  buildWorkflowJson,
} from '../n8n-api';

const mockExecFile = execFile as unknown as jest.Mock;
const mockAxios = axios as jest.Mocked<typeof axios>;

const VALID_WORKFLOW = {
  name: 'Test Flow',
  active: true,
  versionId: 'v-1',
  nodes: [
    { id: 'a', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1.1, position: [0, 0], parameters: { path: 'test/flow' } },
    { id: 'b', name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [200, 0], parameters: {} },
  ],
  connections: { Webhook: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] } },
  settings: { executionOrder: 'v1' },
};

function useApiKey(apiKey?: string, baseUrl = 'http://myhost:5678/') {
  registerN8nConnectionProvider(() => ({ baseUrl, apiKey }));
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no API key â†’ CLI fallback
  useApiKey(undefined);
});

describe('validateWorkflowJson', () => {
  test('accepts the built-in template output', () => {
    const wf = buildWorkflowJson({ name: 'T', webhookPath: 'p', systemPrompt: 's' });
    expect(validateWorkflowJson(wf)).toEqual({ ok: true, errors: [] });
  });

  test('accepts a minimal valid workflow', () => {
    expect(validateWorkflowJson(VALID_WORKFLOW).ok).toBe(true);
  });

  test('rejects non-objects', () => {
    expect(validateWorkflowJson(null).ok).toBe(false);
    expect(validateWorkflowJson([]).ok).toBe(false);
    expect(validateWorkflowJson('wf').ok).toBe(false);
  });

  test('rejects missing name / empty nodes / missing connections', () => {
    const res = validateWorkflowJson({ nodes: [], connections: undefined });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/name/);
    expect(res.errors.join(' ')).toMatch(/nodes/);
    expect(res.errors.join(' ')).toMatch(/connections/);
  });

  test('rejects nodes missing name or type', () => {
    const res = validateWorkflowJson({
      name: 'X',
      nodes: [{ id: 'a' }],
      connections: {},
    });
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.includes('nodes[0]'))).toBe(true);
  });

  test('rejects connections that reference unknown nodes', () => {
    const res = validateWorkflowJson({
      ...VALID_WORKFLOW,
      connections: {
        Ghost: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
        Webhook: { main: [[{ node: 'Nowhere', type: 'main', index: 0 }]] },
      },
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('Ghost');
    expect(res.errors.join(' ')).toContain('Nowhere');
  });
});

describe('REST path (API key configured)', () => {
  beforeEach(() => useApiKey('secret-key'));

  test('importWorkflow POSTs to /api/v1/workflows with the auth header and stripped body', async () => {
    mockAxios.request.mockResolvedValue({ data: { id: 17 } });
    const id = await importWorkflow(VALID_WORKFLOW);
    expect(id).toBe('17');

    expect(mockAxios.request).toHaveBeenCalledTimes(1);
    const call = mockAxios.request.mock.calls[0][0] as any;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('http://myhost:5678/api/v1/workflows');
    expect(call.headers['X-N8N-API-KEY']).toBe('secret-key');
    // Public API rejects unknown top-level props â€” active/versionId must be stripped
    expect(call.data).toEqual({
      name: VALID_WORKFLOW.name,
      // Deployment injects an Auth Guard between the webhook and its first
      // downstream node (see n8n-auth-guard.ts) â€” assert the rewired graph.
      nodes: expect.arrayContaining([
        expect.objectContaining({ name: 'Webhook', type: 'n8n-nodes-base.webhook' }),
        expect.objectContaining({ name: 'Auth Guard', type: 'n8n-nodes-base.code' }),
        expect.objectContaining({ name: 'Respond' }),
      ]),
      connections: {
        Webhook: { main: [[{ node: 'Auth Guard', type: 'main', index: 0 }]] },
        'Auth Guard': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
      },
      settings: VALID_WORKFLOW.settings,
    });
    const guard = call.data.nodes.find((n: any) => n.name === 'Auth Guard');
    expect(guard.parameters.jsCode).toContain('x-homebot-auth');
    // No docker involvement on the REST path
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  test('importWorkflow rejects invalid JSON before any request', async () => {
    await expect(importWorkflow({ name: 'x' } as any)).rejects.toThrow(/Invalid workflow JSON/);
    expect(mockAxios.request).not.toHaveBeenCalled();
  });

  test('activateWorkflow POSTs to /activate', async () => {
    mockAxios.request.mockResolvedValue({ data: {} });
    await activateWorkflow('wf-9');
    const call = mockAxios.request.mock.calls[0][0] as any;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('http://myhost:5678/api/v1/workflows/wf-9/activate');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  test('deleteWorkflow DELETEs the workflow', async () => {
    mockAxios.request.mockResolvedValue({ data: {} });
    await deleteWorkflow('wf-9');
    const call = mockAxios.request.mock.calls[0][0] as any;
    expect(call.method).toBe('DELETE');
    expect(call.url).toBe('http://myhost:5678/api/v1/workflows/wf-9');
  });

  test('listWorkflows maps the API response', async () => {
    mockAxios.request.mockResolvedValue({ data: { data: [{ id: 1, name: 'A' }, { id: '2', name: 'B' }] } });
    expect(await listWorkflows()).toEqual([
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ]);
  });
});

describe('CLI fallback (no API key)', () => {
  test('activateWorkflow uses `n8n update:workflow --active=true` (no SQLite)', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => cb(null, 'ok', ''));
    await activateWorkflow('wf-3');
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [cmd, args] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('docker');
    expect(args).toEqual(['exec', 'homebot-n8n', 'n8n', 'update:workflow', '--id=wf-3', '--active=true']);
    expect(mockAxios.request).not.toHaveBeenCalled();
  });
});

describe('extractWebhookUrl', () => {
  test('builds the production URL from the Webhook node path', () => {
    useApiKey(undefined, 'http://myhost:5678');
    expect(extractWebhookUrl(VALID_WORKFLOW)).toBe('http://myhost:5678/webhook/test/flow');
  });

  test('strips a leading slash from the path', () => {
    const wf = { ...VALID_WORKFLOW, nodes: [{ ...VALID_WORKFLOW.nodes[0], parameters: { path: '/lead/slash' } }] };
    expect(extractWebhookUrl(wf)).toContain('/webhook/lead/slash');
  });

  test('returns null when there is no webhook node', () => {
    expect(extractWebhookUrl({ nodes: [{ name: 'X', type: 'n8n-nodes-base.code' }] })).toBeNull();
    expect(extractWebhookUrl({})).toBeNull();
  });
});

describe('verifyN8nConnection', () => {
  test('unreachable instance', async () => {
    mockAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await verifyN8nConnection({ baseUrl: 'http://down:5678', apiKey: 'k' });
    expect(res.reachable).toBe(false);
    expect(res.authenticated).toBeNull();
    expect(res.error).toContain('not reachable');
  });

  test('reachable, no key â†’ authenticated is null', async () => {
    mockAxios.get.mockResolvedValue({ status: 200 });
    const res = await verifyN8nConnection({ baseUrl: 'http://up:5678', apiKey: '' });
    expect(res).toEqual({ reachable: true, authenticated: null });
  });

  test('reachable + valid key â†’ authenticated true', async () => {
    mockAxios.get
      .mockResolvedValueOnce({ status: 200 }) // healthz
      .mockResolvedValueOnce({ status: 200, data: { data: [] } }); // /api/v1/workflows
    const res = await verifyN8nConnection({ baseUrl: 'http://up:5678', apiKey: 'good' });
    expect(res).toEqual({ reachable: true, authenticated: true });
    const authCall = mockAxios.get.mock.calls[1];
    expect(authCall[0]).toBe('http://up:5678/api/v1/workflows?limit=1');
    expect((authCall[1] as any).headers['X-N8N-API-KEY']).toBe('good');
  });

  test('reachable + rejected key â†’ authenticated false with a 401 message', async () => {
    mockAxios.get
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce({ response: { status: 401 } });
    const res = await verifyN8nConnection({ baseUrl: 'http://up:5678', apiKey: 'bad' });
    expect(res.reachable).toBe(true);
    expect(res.authenticated).toBe(false);
    expect(res.error).toContain('401');
  });
});

/**
 * Deploy guards.
 *
 * The guards are "import unless a workflow by this name already exists", and
 * they read a FAILED listing as "none exist". Every launch where Docker was
 * not ready yet imported another copy â€” Aden's n8n ended up with six copies of
 * "HomeBot: Web Fetch" and four of "System Health Check".
 */
describe('not knowing is not the same as knowing there are none', () => {
  const { ensureWebFetchWorkflow, ensureMediaResearchWorkflow } = require('../n8n-api');

  const failListing = () =>
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) =>
      cb(Object.assign(new Error('Cannot connect to the Docker daemon'), { code: 1 }), '', 'daemon not running'));

  test('listWorkflows still reports an empty list, for callers that only read', async () => {
    failListing();
    await expect(listWorkflows()).resolves.toEqual([]);
  });

  test('ensureWebFetchWorkflow imports nothing when it cannot read the list', async () => {
    failListing();
    await ensureWebFetchWorkflow();
    // Every docker call is a failed list attempt; none is an import.
    const importCalls = mockExecFile.mock.calls.filter(
      ([, args]: any) => Array.isArray(args) && args.some((a: string) => String(a).includes('import:workflow')),
    );
    expect(importCalls).toHaveLength(0);
  });

  test('ensureMediaResearchWorkflow says so rather than importing on a guess', async () => {
    failListing();
    const res = await ensureMediaResearchWorkflow();
    expect(res.deployed).toBe(false);
    expect(String(res.reason)).toMatch(/could not read/i);
    const importCalls = mockExecFile.mock.calls.filter(
      ([, args]: any) => Array.isArray(args) && args.some((a: string) => String(a).includes('import:workflow')),
    );
    expect(importCalls).toHaveLength(0);
  });
});

/**
 * Self-healing guard replacement.
 *
 * The skip-if-exists deploy guards stopped duplicates, but they also made
 * every guard upgrade impossible: a workflow deployed before Auth Guard
 * injection keeps serving unauthenticated requests through every release,
 * because the one function that could replace it sees the name and skips.
 * Found live 2026-08-24: "HomeBot: Media Research" had no guard at all and
 * returned full Wikipedia research to any caller on the network.
 *
 * The fix: when the existing workflow's nodes carry no guard marker, replace
 * it (delete + reimport) instead of skipping. When there is no API key the
 * node contents cannot be read, so nothing is deleted on a guess â€” the
 * function reports honestly instead.
 */
describe('a stale unguarded workflow is replaced, not skipped', () => {
  const { ensureMediaResearchWorkflow } = require('../n8n-api');

  const GUARD_MARKER = "hdrs['x-homebot-auth']";

  const guardedNodes = [
    { id: 'a', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1.1, position: [0, 0], parameters: { path: 'homebot/media-research' } },
    { id: 'g', name: 'Auth Guard', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0], parameters: { jsCode: `let secret = "abc";\nconst hdrs = $input.first()?.json?.headers || {};\n${GUARD_MARKER}` } },
  ];
  const unguardedNodes = [
    { id: 'a', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1.1, position: [0, 0], parameters: { path: 'homebot/media-research' } },
    { id: 'q', name: 'Build query', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0], parameters: { jsCode: 'return [];' } },
  ];

  const listViaRest = (workflows: Array<{ id: string; name: string }>) => {
    mockAxios.request.mockImplementation(async ({ method, url }: any) => {
      if (method === 'GET' && String(url).includes('/workflows?')) {
        return { data: { data: workflows.map((w) => ({ ...w })) } };
      }
      if (method === 'GET' && /\/workflows\/[^/]+$/.test(String(url))) {
        const id = String(url).split('/').pop();
        const wf = workflows.find((w) => w.id === id);
        return { data: { id, name: wf?.name, nodes: wf && (wf as any).nodes || unguardedNodes } };
      }
      throw new Error('unexpected axios call: ' + method + ' ' + url);
    });
  };

  test('an existing workflow with no guard marker is deleted and reimported', async () => {
    useApiKey('key');
    const stale = { id: 'stale-1', name: 'HomeBot: Media Research', nodes: unguardedNodes };
    listViaRest([stale]);

    let deleted: string[] = [];
    mockAxios.request.mockImplementation(async ({ method, url }: any) => {
      if (method === 'GET' && String(url).includes('/workflows?')) {
        return { data: { data: [{ id: stale.id, name: stale.name }] } };
      }
      if (method === 'GET' && /\/workflows\/[^/]+$/.test(String(url))) {
        return { data: { id: stale.id, name: stale.name, nodes: unguardedNodes } };
      }
      if (method === 'DELETE') {
        deleted.push(String(url));
        return { data: {} };
      }
      if (method === 'POST' && String(url).endsWith('/workflows')) {
        return { data: { id: 'new-1' } };
      }
      if (method === 'POST' && String(url).includes('/activate')) {
        return { data: {} };
      }
      throw new Error('unexpected axios call: ' + method + ' ' + url);
    });
    // checkWebhook pings the webhook via axios.post â€” answer it so the final
    // verify passes. A 200 with any body means "available".
    (mockAxios.post as jest.Mock).mockResolvedValue({ status: 200, data: {} });

    const res = await ensureMediaResearchWorkflow();
    expect(res.deployed).toBe(true);
    expect(deleted.some((u) => u.includes('stale-1'))).toBe(true);
    // And a fresh import happened after the delete (the POST to
    // /api/v1/workflows; the activate POST and the webhook ping POST are
    // separate calls). axios.request receives ONE config object, so the mock
    // calls destructure accordingly.
    const posts = mockAxios.request.mock.calls.filter(
      ([cfg]: any) => cfg?.method === 'POST' && String(cfg?.url).endsWith('/api/v1/workflows'),
    );
    expect(posts.length).toBe(1);
  });

  test('a workflow that already has the guard is left alone', async () => {
    useApiKey('key');
    mockAxios.request.mockImplementation(async ({ method, url }: any) => {
      if (method === 'GET' && String(url).includes('/workflows?')) {
        return { data: { data: [{ id: 'ok-1', name: 'HomeBot: Media Research' }] } };
      }
      if (method === 'GET' && /\/workflows\/[^/]+$/.test(String(url))) {
        return { data: { id: 'ok-1', name: 'HomeBot: Media Research', nodes: guardedNodes } };
      }
      if (method === 'DELETE') {
        throw new Error('must not delete a guarded workflow');
      }
      if (method === 'POST') {
        throw new Error('must not reimport a guarded workflow');
      }
      throw new Error('unexpected axios call: ' + method + ' ' + url);
    });

    const res = await ensureMediaResearchWorkflow();
    expect(res.deployed).toBe(true);
  });

  test('without an API key nothing is deleted â€” node contents are unreadable, so replacement would be a guess', async () => {
    useApiKey(undefined);
    failListingSafe();
    const res = await ensureMediaResearchWorkflow();
    // With no key and no Docker, listing fails and we report honestly.
    expect(res.deployed).toBe(false);

    function failListingSafe() {
      mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) =>
        cb(Object.assign(new Error('no docker'), { code: 1 }), '', 'err'));
    }
  });
});

