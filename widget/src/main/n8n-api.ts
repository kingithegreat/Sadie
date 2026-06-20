/**
 * n8n-api.ts
 * Manages n8n workflows from HomeBot via docker exec CLI commands.
 * Creates, activates, lists, and deletes workflows without requiring
 * an API key — uses the n8n CLI and Node.js SQLite inside the container.
 */

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';

const CONTAINER = 'homebot-n8n';
const N8N_BASE = 'http://localhost:5678';
const SQLITE3_REQUIRE = '/usr/local/lib/node_modules/n8n/node_modules/sqlite3';

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
 * Activate a workflow by updating the DB via Node.js inside the container.
 * Reads the full nodes/connections from workflow_entity (written by n8n CLI import)
 * and copies them into a workflow_history entry so n8n registers the webhooks.
 */
export async function activateWorkflow(workflowId: string, workflowJson: object): Promise<void> {
  const wf = workflowJson as any;
  const versionId = wf.versionId || randomUUID();
  const wfName = wf.name || 'HomeBot Automation';

  // Node.js script piped via stdin — reads full nodes from workflow_entity
  const script = [
    `const sqlite3 = require('${SQLITE3_REQUIRE}');`,
    `const db = new sqlite3.Database('/home/node/.n8n/database.sqlite');`,
    `const wfId = ${JSON.stringify(workflowId)};`,
    `const vId = ${JSON.stringify(versionId)};`,
    `const name = ${JSON.stringify(wfName)};`,
    `const now = new Date().toISOString();`,
    `db.get('SELECT nodes, connections FROM workflow_entity WHERE id = ?', [wfId], (err, row) => {`,
    `  if (err || !row) { console.error('read err:', err?.message || 'not found'); process.exit(1); }`,
    `  db.serialize(() => {`,
    `    db.run('PRAGMA foreign_keys = OFF');`,
    `    db.run('INSERT OR REPLACE INTO workflow_history (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',`,
    `      [vId, wfId, 'homebot', now, now, row.nodes, row.connections, name, 0, null],`,
    `      function(e) { console.log(e ? 'history err: ' + e.message : 'history OK'); });`,
    `    db.run('UPDATE workflow_entity SET active = 1, versionId = ?, "activeVersionId" = ? WHERE id = ?',`,
    `      [vId, vId, wfId],`,
    `      function(e) { console.log(e ? 'activate err: ' + e.message : 'activated:' + this.changes); });`,
    `    db.run('PRAGMA foreign_keys = ON');`,
    `  });`,
    `  db.close(() => console.log('done'));`,
    `});`,
  ].join('\n');

  const result = await dockerExecStdin(script, 'node', '-');
  console.log('[n8n-api] activate result:', result);
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

export async function listWorkflows(): Promise<Array<{ id: string; name: string }>> {
  try {
    const out = await dockerExec('n8n', 'list:workflow');
    return out
      .split('\n')
      .filter((l) => l.includes('|'))
      .map((l) => {
        const [id, ...nameParts] = l.split('|');
        return { id: id.trim(), name: nameParts.join('|').trim() };
      });
  } catch {
    return [];
  }
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
        position: [480, 300],
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
      Webhook: { main: [[{ node: 'Fetch Page', type: 'main', index: 0 }]] },
      'Fetch Page': { main: [[{ node: 'Extract Text', type: 'main', index: 0 }]] },
      'Extract Text': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}

/**
 * Deploy the web-fetch workflow to n8n if it doesn't already exist.
 */
export async function ensureWebFetchWorkflow(): Promise<void> {
  const existing = await listWorkflows();
  if (existing.some(w => w.name.includes('Web Fetch'))) {
    console.log('[n8n-api] Web Fetch workflow already exists, skipping deploy');
    return;
  }

  console.log('[n8n-api] Deploying Web Fetch workflow to n8n...');
  const json = buildWebFetchWorkflowJson();
  const id = await importWorkflow(json);
  await activateWorkflow(id, json);
  await restartN8n();
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
  await activateWorkflow(id, json);
  await restartN8n();

  return {
    id,
    name: workflowName,
    webhookPath,
    webhookUrl: `${N8N_BASE}/webhook/${webhookPath}`,
  };
}
