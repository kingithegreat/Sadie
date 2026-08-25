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
// checkWebhook is the deployment oracle behind ensureMediaResearchWorkflow.
// Mocked so these tests decide what the probe answers instead of standing up
// an HTTP layer — the probe itself is covered in its own suite.
jest.mock('../n8n-webhook-check', () => ({ checkWebhook: jest.fn() }));

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
  exportWorkflowJson,
} from '../n8n-api';
import { guardJsCode } from '../n8n-auth-guard';
import { checkWebhook } from '../n8n-webhook-check';

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
 * The self-heal. "A workflow of this name exists" used to end the check, which
 * meant a copy deployed before the Auth Guard (or hand-imported bare) sat
 * there through every release — measured live 2026-08-24 as homebot/
 * media-research returning 5 KB of research to an unauthenticated POST.
 * These tests pin the new rule: judge each COPY by its guard, replace the
 * defenceless ones, and never destroy anything on an unreadable guess.
 */
describe('ensureMediaResearchWorkflow replaces copies without a working guard', () => {
  const { ensureMediaResearchWorkflow } = require('../n8n-api');

  const API_BASE = 'http://myhost:5678/api/v1';
  const ENV_ERA_GUARD =
    "const secret = process.env.HOMEBOT_WEBHOOK_SECRET;\nif (!secret) return $input.all();\nconst incoming = hdrs['x-homebot-auth'];";

  /** Full workflow definition as the n8n API / export returns it. */
  const exported = (id: string, guardJs?: string) => ({
    id,
    name: 'HomeBot: Media Research',
    nodes: [
      { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'homebot/media-research' } },
      ...(guardJs ? [{ name: 'Auth Guard', type: 'n8n-nodes-base.code', parameters: { jsCode: guardJs } }] : []),
      { name: 'Build query', type: 'n8n-nodes-base.code', parameters: {} },
      { name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', parameters: {} },
    ],
    connections: {},
    settings: { executionOrder: 'v1' },
  });

  /** Script mockAxios.request by METHOD url → response or thrown error. */
  function rest(routes: Record<string, { data?: any; reject?: any }>) {
    mockAxios.request.mockImplementation(async (cfg: any) => {
      const key = `${String(cfg.method).toUpperCase()} ${cfg.url}`;
      const hit = routes[key];
      if (!hit) throw Object.assign(new Error(`unrouted call: ${key}`), { response: { status: 404 } });
      if (hit.reject) throw hit.reject;
      return { data: hit.data ?? {} };
    });
  }

  beforeEach(() => {
    useApiKey('secret-key');
    (checkWebhook as jest.Mock).mockReset();
    (checkWebhook as jest.Mock).mockResolvedValue({
      path: 'homebot/media-research', powers: '', status: 'available',
    });
  });

  const callsFor = (method: string, url: string): any[] =>
    (mockAxios.request.mock.calls as any[]).filter(
      (c: any[]) => c[0]?.method === method && c[0]?.url === url,
    );
  const IMPORT_URL = `${API_BASE}/workflows`; // exact — '/workflows/x/activate' must not match

  test('a pre-guard copy is deleted and freshly imported, delete before import', async () => {
    rest({
      [`GET ${API_BASE}/workflows?limit=200`]: { data: { data: [{ id: 9, name: 'HomeBot: Media Research' }] } },
      [`GET ${API_BASE}/workflows/9`]: { data: exported('9') }, // no guard node
      [`DELETE ${API_BASE}/workflows/9`]: {},
      [`POST ${API_BASE}/workflows`]: { data: { id: 'new-1' } },
      [`POST ${API_BASE}/workflows/new-1/activate`]: {},
    });

    await expect(ensureMediaResearchWorkflow()).resolves.toEqual({ deployed: true });

    expect(callsFor('DELETE', `${API_BASE}/workflows/9`)).toHaveLength(1);
    expect(callsFor('POST', IMPORT_URL)).toHaveLength(1);
    // The fresh import must carry the guard — that is the whole repair.
    const postBody = callsFor('POST', IMPORT_URL)[0][0].data;
    expect(postBody.nodes.some((n: any) => n.name === 'Auth Guard')).toBe(true);
    // Order matters: the open webhook closes before the replacement goes in.
    const calls = mockAxios.request.mock.calls as any[];
    expect(
      calls.findIndex((c) => c[0]?.method === 'DELETE') < calls.findIndex((c) => c[0]?.method === 'POST'),
    ).toBe(true);
  });

  test('an env-era guard carries the marker but is still replaced', async () => {
    rest({
      [`GET ${API_BASE}/workflows?limit=200`]: { data: { data: [{ id: 9, name: 'HomeBot: Media Research' }] } },
      [`GET ${API_BASE}/workflows/9`]: { data: exported('9', ENV_ERA_GUARD) },
      [`DELETE ${API_BASE}/workflows/9`]: {},
      [`POST ${API_BASE}/workflows`]: { data: { id: 'new-1' } },
      [`POST ${API_BASE}/workflows/new-1/activate`]: {},
    });

    await expect(ensureMediaResearchWorkflow()).resolves.toEqual({ deployed: true });
    expect(callsFor('DELETE', `${API_BASE}/workflows/9`)).toHaveLength(1);
  });

  test('a copy with an embedded-secret guard is left entirely alone', async () => {
    rest({
      [`GET ${API_BASE}/workflows?limit=200`]: { data: { data: [{ id: 9, name: 'HomeBot: Media Research' }] } },
      [`GET ${API_BASE}/workflows/9`]: { data: exported('9', guardJsCode('real-secret')) },
    });

    await expect(ensureMediaResearchWorkflow()).resolves.toEqual({ deployed: true });
    expect(mockAxios.request.mock.calls.filter((c: any[]) => c[0]?.method !== 'GET')).toHaveLength(0);
  });

  test('mixed duplicates: only the unguarded one dies, no duplicate import', async () => {
    rest({
      [`GET ${API_BASE}/workflows?limit=200`]: { data: { data: [
        { id: 9, name: 'HomeBot: Media Research' },
        { id: 10, name: 'HomeBot: Media Research' },
      ] } },
      [`GET ${API_BASE}/workflows/9`]: { data: exported('9') },
      [`GET ${API_BASE}/workflows/10`]: { data: exported('10', guardJsCode('real-secret')) },
      [`DELETE ${API_BASE}/workflows/9`]: {},
    });

    await expect(ensureMediaResearchWorkflow()).resolves.toEqual({ deployed: true });
    expect(callsFor('DELETE', `${API_BASE}/workflows/9`)).toHaveLength(1);
    expect(callsFor('DELETE', `${API_BASE}/workflows/10`)).toHaveLength(0);
    // A working copy remains — importing again would mint a duplicate.
    expect(callsFor('POST', IMPORT_URL)).toHaveLength(0);
  });

  test('a copy whose definition cannot be read stops everything, hands off nothing', async () => {
    rest({
      [`GET ${API_BASE}/workflows?limit=200`]: { data: { data: [{ id: 9, name: 'HomeBot: Media Research' }] } },
      [`GET ${API_BASE}/workflows/9`]: { reject: Object.assign(new Error('boom'), { response: { status: 500 } }) },
    });

    const res = await ensureMediaResearchWorkflow();
    expect(res.deployed).toBe(false);
    expect(String(res.reason)).toMatch(/could not read/i);
    expect(String(res.reason)).toContain('Auth Guard');
    expect(mockAxios.request.mock.calls.filter((c: any[]) => c[0]?.method === 'DELETE')).toHaveLength(0);
    expect(callsFor('POST', IMPORT_URL)).toHaveLength(0);
  });

  test('when the probe says the webhook does not answer, it says so instead of claiming success', async () => {
    (checkWebhook as jest.Mock).mockResolvedValue({
      path: 'homebot/media-research', powers: '', status: 'not_deployed',
    });
    rest({
      [`GET ${API_BASE}/workflows?limit=200`]: { data: { data: [{ id: 9, name: 'HomeBot: Media Research' }] } },
      [`GET ${API_BASE}/workflows/9`]: { data: exported('9', guardJsCode('real-secret')) },
    });

    const res = await ensureMediaResearchWorkflow();
    expect(res.deployed).toBe(false);
    expect(String(res.reason)).toMatch(/toggle active|api key/i);
  });
});

describe('exportWorkflowJson', () => {
  beforeEach(() => useApiKey(undefined)); // CLI path

  test('parses the exported JSON document from docker output', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) =>
      cb(null, JSON.stringify({ id: '7', name: 'X', nodes: [], connections: {} }), ''));
    await expect(exportWorkflowJson('7')).resolves.toEqual(
      { id: '7', name: 'X', nodes: [], connections: {} });
  });

  test('survives noise around the document', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) =>
      cb(null, 'some banner line\n{"id":"7","nodes":[]}\ntrailing text', ''));
    await expect(exportWorkflowJson('7')).resolves.toEqual({ id: '7', nodes: [] });
  });

  test('returns null — never throws — when export fails', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) =>
      cb(Object.assign(new Error('no container'), { code: 1 }), '', 'not running'));
    await expect(exportWorkflowJson('7')).resolves.toBeNull();
  });
});
