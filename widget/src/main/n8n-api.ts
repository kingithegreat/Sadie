/**
 * n8n-api.ts
 * Manages n8n workflows from HomeBot.
 *
 * Two transports, picked automatically per call:
 * - **REST (preferred)**: when an n8n API key is configured in HomeBot
 *   Settings, all operations go through n8n's public API
 *   (`/api/v1/workflows`, `X-N8N-API-KEY` header). Activation via the API
 *   registers webhooks live — no container restart needed.
 * - **Docker CLI (fallback)**: without an API key, workflows are managed
 *   via `docker exec homebot-n8n n8n <command>`, which requires Docker and
 *   a container restart for webhook registration.
 */

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { injectAuthGuards } from './n8n-auth-guard';

const CONTAINER = 'homebot-n8n';
const N8N_BASE = 'http://localhost:5678';
const SQLITE3_REQUIRE = '/usr/local/lib/node_modules/n8n/node_modules/sqlite3';

// ---- Connection settings (URL + API key from HomeBot Settings) ----

export interface N8nConnection {
  baseUrl: string;
  apiKey?: string;
}

let connectionProvider: (() => N8nConnection) | null = null;

/**
 * Called once at startup (ipc-handlers.ts) so every n8n operation picks up
 * the URL and API key the user entered in HomeBot Settings.
 */
export function registerN8nConnectionProvider(fn: () => N8nConnection): void {
  connectionProvider = fn;
}

function getConnection(): N8nConnection {
  try {
    const c = connectionProvider?.();
    if (c?.baseUrl) {
      return { baseUrl: c.baseUrl.replace(/\/$/, ''), apiKey: c.apiKey?.trim() || undefined };
    }
  } catch { /* fall through to defaults */ }
  return { baseUrl: N8N_BASE };
}

function hasApiKey(): boolean {
  return !!getConnection().apiKey;
}

async function apiRequest<T = any>(method: 'GET' | 'POST' | 'DELETE', apiPath: string, body?: object): Promise<T> {
  const { baseUrl, apiKey } = getConnection();
  if (!apiKey) throw new Error('n8n API key is not configured');
  const res = await axios.request({
    method,
    url: `${baseUrl}/api/v1${apiPath}`,
    data: body,
    headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
    timeout: 30_000,
  });
  return res.data as T;
}

// ---- Workflow JSON validation ----
// Mirrors the minimum schema n8n requires (kept in sync with
// widget/src/main/__tests__/n8n-workflow-schema.test.ts).

export function validateWorkflowJson(wf: any): { ok: boolean; errors: string[] } {
  if (!wf || typeof wf !== 'object' || Array.isArray(wf)) {
    return { ok: false, errors: ['workflow must be a JSON object'] };
  }
  const errors: string[] = [];
  if (!wf.name || typeof wf.name !== 'string') errors.push('missing "name" (string)');
  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) {
    errors.push('"nodes" must be a non-empty array');
  } else {
    wf.nodes.forEach((n: any, i: number) => {
      if (!n || typeof n !== 'object') { errors.push(`nodes[${i}] must be an object`); return; }
      if (!n.name) errors.push(`nodes[${i}] missing "name"`);
      if (!n.type) errors.push(`nodes[${i}] missing "type"`);
    });
  }
  if (!wf.connections || typeof wf.connections !== 'object' || Array.isArray(wf.connections)) {
    errors.push('missing "connections" (object keyed by node name)');
  } else if (Array.isArray(wf.nodes)) {
    const names = new Set(wf.nodes.map((n: any) => n?.name));
    for (const [from, conn] of Object.entries(wf.connections)) {
      if (!names.has(from)) errors.push(`connections references unknown node "${from}"`);
      const groups = (conn as any)?.main;
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        for (const target of group) {
          if (target?.node && !names.has(target.node)) {
            errors.push(`connection from "${from}" targets unknown node "${target.node}"`);
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** n8n's public API rejects unknown top-level properties — strip to the allowed set. */
function toApiCreateBody(wf: any): object {
  return {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || { executionOrder: 'v1' },
    ...(wf.staticData ? { staticData: wf.staticData } : {}),
  };
}

function dockerExec(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('docker', ['exec', CONTAINER, ...args], {
      timeout: 30_000,
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

function dockerExecStdin(input: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = execFile('docker', ['exec', '-i', CONTAINER, ...args], {
      timeout: 30_000,
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
    proc.stdin?.write(input);
    proc.stdin?.end();
  });
}

function dockerRun(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('docker', args, {
      timeout: 60_000,
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

export interface N8nWorkflowInfo {
  id: string;
  name: string;
  webhookPath: string;
  webhookUrl: string;
}

export function buildWorkflowJson(opts: {
  name: string;
  webhookPath: string;
  systemPrompt: string;
}): object {
  const versionId = randomUUID();
  return {
    name: opts.name,
    active: true,
    versionId,
    nodes: [
      {
        parameters: {
          httpMethod: 'POST',
          path: opts.webhookPath,
          responseMode: 'responseNode',
          options: {},
        },
        id: randomUUID(),
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1.1,
        position: [250, 300],
        webhookId: `homebot-auto-${Date.now()}`,
      },
      {
        parameters: {
          jsCode: `const body = $input.item.json.body || $input.item.json || {};
const userMessage = body.message || body.text || '';
const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const systemPrompt = ${JSON.stringify(opts.systemPrompt + ' Today is ')}+ today + '.';
return {
  json: {
    model: 'qwen2.5:7b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    stream: false,
    user_message: userMessage
  }
};`,
        },
        id: randomUUID(),
        name: 'Prepare Request',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [480, 300],
      },
      {
        parameters: {
          method: 'POST',
          url: 'http://host.docker.internal:11434/api/chat',
          sendBody: true,
          specifyBody: 'json',
          jsonBody:
            '={{ { "model": $json.model, "messages": $json.messages, "stream": false, "options": { "num_predict": 2048, "temperature": 0.7 } } }}',
          options: {
            response: { response: { neverError: true, responseFormat: 'json' } },
          },
        },
        id: randomUUID(),
        name: 'Call Ollama',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [700, 300],
      },
      {
        parameters: {
          jsCode: `const ollamaRes = $input.item.json;
const content = ollamaRes.message?.content || ollamaRes.response || 'No response';
return {
  json: {
    output: content,
    data: { assistant: { role: 'assistant', content: content } }
  }
};`,
        },
        id: randomUUID(),
        name: 'Format Response',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [920, 300],
      },
      {
        parameters: {
          respondWith: 'json',
          responseBody: '={{ JSON.stringify($json) }}',
          options: {},
        },
        id: randomUUID(),
        name: 'Respond',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.1,
        position: [1140, 300],
      },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Prepare Request', type: 'main', index: 0 }]] },
      'Prepare Request': { main: [[{ node: 'Call Ollama', type: 'main', index: 0 }]] },
      'Call Ollama': { main: [[{ node: 'Format Response', type: 'main', index: 0 }]] },
      'Format Response': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}

export async function importWorkflow(workflowJson: object): Promise<string> {
  // Defense in depth: every app-deployed workflow gets Auth Guard nodes after
  // its webhook triggers, whatever builder produced the JSON. The per-install
  // secret is embedded into the guard (Code nodes cannot read container env —
  // see n8n-auth-guard.ts). Idempotent — already-guarded workflows are only
  // upgraded if their guard predates the embedded-secret form.
  const { getWebhookSecret } = await import('./webhook-auth');
  const guarded = injectAuthGuards(
    workflowJson as Parameters<typeof injectAuthGuards>[0],
    getWebhookSecret(),
  ).wf;
  workflowJson = guarded as object;

  const check = validateWorkflowJson(workflowJson);
  if (!check.ok) throw new Error(`Invalid workflow JSON: ${check.errors.join('; ')}`);

  // ── REST path: authenticated via the API key from HomeBot Settings ──
  if (hasApiKey()) {
    const created = await apiRequest<{ id?: string | number }>('POST', '/workflows', toApiCreateBody(workflowJson));
    if (created?.id === undefined || created?.id === null) {
      throw new Error('n8n API did not return a workflow id');
    }
    console.log('[n8n-api] Imported workflow via REST API, ID:', created.id);
    return String(created.id);
  }

  // ── CLI fallback (no API key configured) ──
  const jsonStr = JSON.stringify(workflowJson);

  // Write JSON into container via stdin to avoid Windows path encoding issues
  await dockerExecStdin(jsonStr, 'sh', '-c', 'cat > /tmp/homebot-import.json');

  // Import via n8n CLI
  const importOut = await dockerExec('n8n', 'import:workflow', '--input=/tmp/homebot-import.json');
  console.log('[n8n-api] import output:', importOut);

  // List workflows to find the new one by name
  const listOut = await dockerExec('n8n', 'list:workflow');
  const lines = listOut.split('\n').filter((l) => l.includes('|'));
  const name = (workflowJson as any).name;

  const match = lines.find((l) => l.includes(name));
  if (!match) throw new Error(`Workflow "${name}" not found after import. Output: ${listOut}`);

  const id = match.split('|')[0].trim();
  console.log('[n8n-api] Imported workflow ID:', id);
  return id;
}

/**
 * Activate a workflow.
 * - REST path: `POST /api/v1/workflows/{id}/activate` — webhooks register live.
 * - CLI fallback: `n8n update:workflow --active=true`, which requires a
 *   container restart to register webhooks.
 *
 * **Known limitation of the CLI fallback** (verified on n8n 1.122.5,
 * 2026-08-22): `import:workflow` does not create a `workflow_history` row for
 * the imported version, so the subsequent activation fails with
 * SQLITE_CONSTRAINT (FOREIGN KEY, activeVersionId → workflow_history) and —
 * even when the flag is forced in the database — webhook serving reports
 * "Active version not found". Only n8n's own save/activation path creates the
 * version bookkeeping. The REST path is therefore the only reliable way to
 * deploy; without an API key we fail loudly instead of leaving a silently
 * broken automation behind. The user can still activate an imported workflow
 * by hand in the n8n editor (that path writes proper versions), or better,
 * configure the API key under Settings → n8n.
 */
export async function activateWorkflow(workflowId: string): Promise<void> {
  if (hasApiKey()) {
    await apiRequest('POST', `/workflows/${encodeURIComponent(workflowId)}/activate`);
    console.log('[n8n-api] Activated workflow via REST API:', workflowId);
    return;
  }
  try {
    const out = await dockerExec('n8n', 'update:workflow', `--id=${workflowId}`, '--active=true');
    console.log('[n8n-api] activate result:', out);
  } catch (err: any) {
    const raw = String(err?.message || err);
    if (/FOREIGN KEY constraint failed|GOT ERROR|SQLITE_CONSTRAINT/i.test(raw)) {
      throw new Error(
        'Could not activate the workflow via the Docker CLI fallback: this n8n version ' +
          'cannot serve workflows imported with `n8n import:workflow` (missing active-version ' +
          'bookkeeping). Configure an n8n API key in Settings → n8n so deployments use the ' +
          'REST API, or activate the workflow manually in the n8n editor at ' +
          `${N8N_BASE}. Raw output: ${raw}`
      );
    }
    throw err;
  }
}


export async function restartN8n(): Promise<void> {
  console.log('[n8n-api] Restarting n8n container...');
  await dockerRun('restart', CONTAINER);

  // Wait for n8n to come back up
  const deadline = Date.now() + 45_000;
  const http = await import('http');
  while (Date.now() < deadline) {
    const up = await new Promise<boolean>((resolve) => {
      const req = http.get(N8N_BASE, { timeout: 2000 }, (res) => {
        resolve(res.statusCode !== undefined && res.statusCode < 500);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (up) {
      console.log('[n8n-api] n8n is back up');
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('n8n did not come back up after restart');
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  if (hasApiKey()) {
    await apiRequest('DELETE', `/workflows/${encodeURIComponent(workflowId)}`);
    console.log('[n8n-api] Deleted workflow via REST API:', workflowId);
    return;
  }
  // CLI fallback: n8n has no delete:workflow command, so this is the one
  // remaining direct-SQLite operation. Configure an API key to avoid it.
  const script = `
const sqlite3 = require('${SQLITE3_REQUIRE}');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite');
db.serialize(() => {
  db.run('PRAGMA foreign_keys = OFF');
  db.run('DELETE FROM workflow_history WHERE workflowId = ?', [${JSON.stringify(workflowId)}]);
  db.run('DELETE FROM workflow_entity WHERE id = ?', [${JSON.stringify(workflowId)}], function(err) {
    console.log(err ? 'error:' + err.message : 'deleted:' + this.changes);
  });
  db.run('PRAGMA foreign_keys = ON');
});
db.close();
`;
  await dockerExecStdin(script, 'node', '-');
  console.log('[n8n-api] Deleted workflow', workflowId);
}

/**
 * Like listWorkflows, but returns null when the list could not be READ, as
 * opposed to an empty array when n8n genuinely has no workflows.
 *
 * The difference matters, and losing it left real damage. The deploy guards
 * are "import unless a workflow by this name already exists", and they read
 * a failed listing as "none exist" — so every launch where the CLI was not
 * ready yet imported another copy. Aden's n8n ended up holding six copies of
 * "HomeBot: Web Fetch" and four of "System Health Check".
 */
async function tryListWorkflows(): Promise<Array<{ id: string; name: string }> | null> {
  if (hasApiKey()) {
    try {
      const res = await apiRequest<{ data?: Array<{ id: string | number; name: string }> }>('GET', '/workflows?limit=200');
      return (res?.data || []).map((w) => ({ id: String(w.id), name: w.name }));
    } catch (e: any) {
      console.warn('[n8n-api] REST list failed, falling back to CLI:', e?.message);
    }
  }
  try {
    const out = await dockerExec('n8n', 'list:workflow');
    return out
      .split('\n')
      .filter((l) => l.includes('|'))
      .map((l) => {
        const [id, ...nameParts] = l.split('|');
        return { id: id.trim(), name: nameParts.join('|').trim() };
      });
  } catch (e: any) {
    console.warn('[n8n-api] Could not list workflows:', e?.message || e);
    return null;
  }
}

export async function listWorkflows(): Promise<Array<{ id: string; name: string }>> {
  return (await tryListWorkflows()) ?? [];
}

/**
 * Find an existing workflow by name whose deployed copy LACKS the Auth Guard.
 *
 * The skip-if-exists rule ("a workflow by this name is already there, don't
 * import another") was written to stop duplicates, and it did — but it also
 * made every guard upgrade impossible: a workflow deployed before guard
 * injection keeps serving unauthenticated requests through every release,
 * because the one function that could replace it sees the name and skips.
 *
 * A workflow needs replacing when its nodes contain no Auth Guard marker at
 * all. The marker string lives in n8n-auth-guard.ts (GUARD_MARKER); checking
 * for it rather than for a specific secret means this also catches future
 * guard-format changes as long as they keep the marker.
 *
 * Returns the id of a stale workflow, or null if none found / not checkable
 * (no API key → node contents are not readable via the CLI list, so we must
 * NOT delete on a guess).
 */
async function findStaleGuardedWorkflow(
  existing: Array<{ id: string; name: string }>,
  namePart: string,
): Promise<string | null> {
  if (!hasApiKey()) return null; // cannot read nodes without REST; never delete blind

  const candidates = existing.filter((w) => w.name.includes(namePart));
  if (candidates.length === 0) return null;

  const { GUARD_MARKER } = await import('./n8n-auth-guard');

  for (const wf of candidates) {
    try {
      const full = await apiRequest<{ nodes?: Array<{ type?: string; parameters?: { jsCode?: string } }> }>(
        'GET',
        `/workflows/${encodeURIComponent(wf.id)}`,
      );
      const nodes = Array.isArray(full?.nodes) ? full.nodes : [];
      const hasGuard = nodes.some(
        (n) =>
          n.type === 'n8n-nodes-base.code' &&
          typeof n.parameters?.jsCode === 'string' &&
          n.parameters.jsCode.includes(GUARD_MARKER),
      );
      if (!hasGuard) return wf.id;
    } catch (e: any) {
      // If we cannot read it, we cannot judge it. Leave it alone rather than
      // deleting a workflow that might be fine.
      console.warn(`[n8n-api] Could not read workflow ${wf.id} to check its guard:`, e?.message || e);
    }
  }
  return null;
}

/**
 * Build a web-fetch workflow: receives { url, max_length } via webhook,
 * fetches the page via HTTP Request node, strips HTML to plain text, returns it.
 */
export function buildWebFetchWorkflowJson(): object {
  const versionId = randomUUID();
  return {
    name: 'HomeBot: Web Fetch',
    active: true,
    versionId,
    nodes: [
      {
        parameters: {
          httpMethod: 'POST',
          path: 'homebot/web-fetch',
          responseMode: 'responseNode',
          options: {},
        },
        id: randomUUID(),
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1.1,
        position: [250, 300],
        webhookId: `homebot-web-fetch`,
      },
      {
        parameters: {
          // SSRF guard: reject non-http(s) schemes and requests aimed at
          // loopback / private / link-local hosts (incl. the cloud-metadata
          // IP and Docker's host gateway) before any request leaves the
          // container. Throws (fails closed) on a blocked or malformed URL.
          // Note: literal-host checks only — a hostname that DNS-resolves to a
          // private IP (rebinding) is not caught here.
          jsCode: `const url = $json.body?.url || '';
let u;
try { u = new URL(url); } catch (e) { throw new Error('Invalid URL'); }
if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http/https URLs are allowed');
const host = u.hostname.toLowerCase().replace(/^\\[|\\]$/g, '');
const blockedNames = ['localhost', 'host.docker.internal', 'metadata.google.internal', 'metadata'];
if (blockedNames.includes(host) || host.endsWith('.localhost')) throw new Error('Blocked host: ' + host);
const m = host.match(/^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/);
if (m) {
  const a = Number(m[1]), b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    throw new Error('Blocked private/link-local IP: ' + host);
  }
}
if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) throw new Error('Blocked IPv6 host: ' + host);
return { json: $json };`,
        },
        id: randomUUID(),
        name: 'Validate URL',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [420, 300],
      },
      {
        parameters: {
          method: 'GET',
          url: '={{ $json.body.url }}',
          options: {
            response: { response: { neverError: true, responseFormat: 'text' } },
            timeout: 20000,
          },
        },
        id: randomUUID(),
        name: 'Fetch Page',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [620, 300],
      },
      {
        parameters: {
          jsCode: `const html = typeof $input.item.json === 'string' ? $input.item.json : ($input.item.json.data || '');
const maxLen = $('Webhook').item.json.body?.max_length || 20000;
let text = html
  .replace(/<(script|style|noscript)[^>]*>[\\s\\S]*?<\\/\\1>/gi, '')
  .replace(/<!--[\\s\\S]*?-->/g, '')
  .replace(/<\\/(p|div|h[1-6]|li|tr|section|article)[\\s>]/gi, '\\n')
  .replace(/<br\\s*\\/?>/gi, '\\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/[ \\t]+/g, ' ')
  .replace(/\\n /g, '\\n')
  .replace(/\\n{3,}/g, '\\n\\n')
  .trim();
const truncated = text.length > maxLen;
if (truncated) text = text.slice(0, maxLen) + '\\n\\n[...truncated]';
const url = $('Webhook').item.json.body?.url || '';
return { json: { success: true, url, content: text, truncated, length: text.length } };`,
        },
        id: randomUUID(),
        name: 'Extract Text',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [700, 300],
      },
      {
        parameters: {
          respondWith: 'json',
          responseBody: '={{ JSON.stringify($json) }}',
          options: {},
        },
        id: randomUUID(),
        name: 'Respond',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.1,
        position: [920, 300],
      },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Validate URL', type: 'main', index: 0 }]] },
      'Validate URL': { main: [[{ node: 'Fetch Page', type: 'main', index: 0 }]] },
      'Fetch Page': { main: [[{ node: 'Extract Text', type: 'main', index: 0 }]] },
      'Extract Text': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}

/**
 * Deploy the web-fetch workflow to n8n if it doesn't already exist.
 */
/**
 * Deploy the Media Studio research workflow if it is not already there.
 *
 * Idempotent by name: import, activate, and restart only when there is no API
 * key (REST activation registers the webhook live; the CLI path needs a
 * restart to pick it up).
 *
 * Reports success only after the webhook actually answers. That is not
 * belt-and-braces — the CLI path cannot activate a workflow at all on current
 * n8n, so without this check the function returns `deployed: true` for a
 * workflow that will never serve a request. Verified against n8n 1.122.5:
 *
 *   n8n import:workflow  ->  "Deactivating workflow. Remember to activate later."
 *   n8n update:workflow --active=true
 *     -> SQLITE_CONSTRAINT: FOREIGN KEY constraint failed
 *
 * The constraint is workflow_entity.activeVersionId -> workflow_history.versionId.
 * Activating writes activeVersionId, and a CLI-imported workflow has no
 * workflow_history row for it to point at. Nothing we can pass to the CLI
 * fixes that (--projectId and --userId were both tried; ownership is not the
 * problem — the imported rows are correctly shared to the personal project).
 *
 * So on an instance with no API key this now fails honestly, and says what
 * would fix it, instead of reporting a deployment that did not happen.
 */
export async function ensureMediaResearchWorkflow(): Promise<{ deployed: boolean; reason?: string }> {
  const { MEDIA_RESEARCH_PATH, buildMediaResearchWorkflowJson } = await import('./n8n-media-workflows');
  const { checkWebhook } = await import('./n8n-webhook-check');
  const verify = () => checkWebhook(MEDIA_RESEARCH_PATH, 'research for Media Studio scripts');

  try {
    const existing = await tryListWorkflows();
    if (existing === null) {
      // Not "there are none" — we could not tell. Importing on a guess is how
      // duplicates accumulate in the user's n8n.
      return { deployed: false, reason: 'Could not read the workflow list from n8n, so nothing was imported.' };
    }
    const stale = await findStaleGuardedWorkflow(existing, 'Media Research');

    if (stale) {
      // The deployed copy predates guard injection: it serves real research to
      // any caller on the network. Skipping because "a workflow by this name
      // exists" would leave that hole in place through every future release —
      // the repair path existed and never ran. Replace it.
      console.warn('[n8n-api] Media Research workflow has no Auth Guard; replacing it');
      await deleteWorkflow(stale);
    }
    // A stale workflow was just deleted, so a fresh import is required even
    // though the name still appears in the listing we fetched earlier.
    const already = existing.some(w => w.name.includes('Media Research')) && stale === null;

    if (!already) {
      const id = await importWorkflow(buildMediaResearchWorkflowJson());
      // Activation failure must not mask a successful import, and must not be
      // reported as the final word — the webhook check below decides.
      await activateWorkflow(id).catch((e) => {
        console.warn('[n8n-api] Media Research activate failed:', e?.message || e);
      });
      if (!hasApiKey()) await restartN8n();
      console.log('[n8n-api] Media Research workflow imported, id:', id);
    }

    const check = await verify();
    if (check.status === 'available') return { deployed: true };

    if (check.status === 'n8n_unreachable') {
      return { deployed: false, reason: check.detail };
    }
    return {
      deployed: false,
      reason: already
        ? 'The workflow is in n8n but is not switched on, so its webhook does not answer. '
          + 'Open n8n, find "HomeBot: Media Research" and toggle Active — or add an n8n API key '
          + 'in HomeBot Settings, which lets HomeBot activate it directly.'
        : 'The workflow imported but n8n would not switch it on from the command line. '
          + 'Open n8n and toggle "HomeBot: Media Research" to Active — or add an n8n API key '
          + 'in HomeBot Settings so HomeBot can activate it directly.',
    };
  } catch (e) {
    return { deployed: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function ensureWebFetchWorkflow(): Promise<void> {
  const existing = await tryListWorkflows();
  if (existing === null) {
    // Runs at startup, when Docker is often not up yet. Treating that as "no
    // workflows exist" is what put six copies of this workflow in Aden's n8n.
    console.warn('[n8n-api] Could not read the workflow list; skipping Web Fetch deploy rather than risking a duplicate');
    return;
  }
  if (existing.some(w => w.name.includes('Web Fetch'))) {
    console.log('[n8n-api] Web Fetch workflow already exists, skipping deploy');
    return;
  }

  console.log('[n8n-api] Deploying Web Fetch workflow to n8n...');
  const json = buildWebFetchWorkflowJson();
  const id = await importWorkflow(json);
  await activateWorkflow(id);
  if (!hasApiKey()) await restartN8n(); // REST activation registers webhooks live
  console.log('[n8n-api] Web Fetch workflow deployed, id:', id);
}

/**
 * Full flow: generate workflow JSON -> import -> activate -> restart n8n -> return info.
 */
export async function createAndActivateWorkflow(opts: {
  automationName: string;
  instructions: string;
}): Promise<N8nWorkflowInfo> {
  const safeName = opts.automationName.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40);
  const webhookPath = `homebot/auto/${safeName.replace(/\s+/g, '-').toLowerCase()}-${Date.now().toString(36)}`;
  const workflowName = `HomeBot Auto: ${opts.automationName}`;

  const systemPrompt =
    `You are HomeBot, a helpful desktop AI assistant. ` +
    `You are executing an automation called "${opts.automationName}". ` +
    `Follow these instructions precisely: ${opts.instructions} ` +
    `Be concise and use markdown formatting.`;

  const json = buildWorkflowJson({ name: workflowName, webhookPath, systemPrompt });

  const id = await importWorkflow(json);
  await activateWorkflow(id);
  if (!hasApiKey()) await restartN8n(); // REST activation registers webhooks live

  return {
    id,
    name: workflowName,
    webhookPath,
    webhookUrl: `${getConnection().baseUrl}/webhook/${webhookPath}`,
  };
}

/**
 * Extracts the production webhook URL from a workflow's Webhook node, if any.
 */
export function extractWebhookUrl(workflowJson: object): string | null {
  const nodes = (workflowJson as any)?.nodes;
  if (!Array.isArray(nodes)) return null;
  const webhookNode = nodes.find((n: any) => n?.type === 'n8n-nodes-base.webhook' && n?.parameters?.path);
  if (!webhookNode) return null;
  const p = String(webhookNode.parameters.path).replace(/^\//, '');
  return `${getConnection().baseUrl}/webhook/${p}`;
}

/**
 * Checks the n8n connection: is the instance reachable, and (when an API key
 * is set) does the key authenticate against the public API?
 * `authenticated` is null when no key is configured — nothing to verify.
 * Overrides let Settings test values before they're saved.
 */
export async function verifyN8nConnection(
  override?: { baseUrl?: string; apiKey?: string }
): Promise<{ reachable: boolean; authenticated: boolean | null; error?: string }> {
  const conn = getConnection();
  const baseUrl = (override?.baseUrl?.trim() || conn.baseUrl).replace(/\/$/, '');
  const apiKey = override?.apiKey !== undefined ? (override.apiKey.trim() || undefined) : conn.apiKey;

  let reachable = false;
  try {
    const r = await axios.get(`${baseUrl}/healthz`, { timeout: 4000, validateStatus: () => true });
    reachable = r.status < 500;
  } catch { /* unreachable */ }
  if (!reachable) {
    return { reachable: false, authenticated: null, error: `n8n is not reachable at ${baseUrl}` };
  }
  if (!apiKey) return { reachable: true, authenticated: null };

  try {
    await axios.get(`${baseUrl}/api/v1/workflows?limit=1`, {
      headers: { 'X-N8N-API-KEY': apiKey },
      timeout: 6000,
    });
    return { reachable: true, authenticated: true };
  } catch (err: any) {
    const status = err?.response?.status;
    return {
      reachable: true,
      authenticated: false,
      error: status === 401 ? 'API key rejected (401 Unauthorized)' : `API check failed${status ? ` (HTTP ${status})` : `: ${err?.message}`}`,
    };
  }
}
