/**
 * n8n API layer tests
 *
 * Covers the transport selection added for authenticated n8n access:
 * - REST path (API key from HomeBot Settings → X-N8N-API-KEY header)
 * - Docker CLI fallback when no key is configured (incl. the supported
 *   `n8n update:workflow --active=true` activation, replacing the old
 *   direct-SQLite hack)
 * - workflow JSON validation shared with the import tool
 */

jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('axios', () => ({
  __esModule: true,
  default: { request: jest.fn(), get: jest.fn() },
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
  // Default: no API key → CLI fallback
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
    // Public API rejects unknown top-level props — active/versionId must be stripped
    expect(call.data).toEqual({
      name: VALID_WORKFLOW.name,
      nodes: VALID_WORKFLOW.nodes,
      connections: VALID_WORKFLOW.connections,
      settings: VALID_WORKFLOW.settings,
    });
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

  test('reachable, no key → authenticated is null', async () => {
    mockAxios.get.mockResolvedValue({ status: 200 });
    const res = await verifyN8nConnection({ baseUrl: 'http://up:5678', apiKey: '' });
    expect(res).toEqual({ reachable: true, authenticated: null });
  });

  test('reachable + valid key → authenticated true', async () => {
    mockAxios.get
      .mockResolvedValueOnce({ status: 200 }) // healthz
      .mockResolvedValueOnce({ status: 200, data: { data: [] } }); // /api/v1/workflows
    const res = await verifyN8nConnection({ baseUrl: 'http://up:5678', apiKey: 'good' });
    expect(res).toEqual({ reachable: true, authenticated: true });
    const authCall = mockAxios.get.mock.calls[1];
    expect(authCall[0]).toBe('http://up:5678/api/v1/workflows?limit=1');
    expect((authCall[1] as any).headers['X-N8N-API-KEY']).toBe('good');
  });

  test('reachable + rejected key → authenticated false with a 401 message', async () => {
    mockAxios.get
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce({ response: { status: 401 } });
    const res = await verifyN8nConnection({ baseUrl: 'http://up:5678', apiKey: 'bad' });
    expect(res.reachable).toBe(true);
    expect(res.authenticated).toBe(false);
    expect(res.error).toContain('401');
  });
});
