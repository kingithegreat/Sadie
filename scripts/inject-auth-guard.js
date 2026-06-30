/**
 * inject-auth-guard.js
 *
 * Injects an "Auth Guard" Code node into every n8n workflow JSON that uses
 * a webhook trigger. The node is placed between the Webhook Trigger and its
 * first downstream node, validating X-HOMEBOT-Auth against the
 * HOMEBOT_WEBHOOK_SECRET env var.
 *
 * Run: node scripts/inject-auth-guard.js
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_DIRS = [
  path.join(__dirname, '..', 'n8n-workflows', 'tools'),
  path.join(__dirname, '..', 'n8n-workflows', 'core'),
];

// The JS code that goes inside the Auth Guard Code node
const AUTH_GUARD_CODE = [
  "const secret = process.env.HOMEBOT_WEBHOOK_SECRET;",
  "if (secret) {",
  "  const hdrs = $input.first()?.json?.headers || {};",
  "  const incoming = hdrs['x-homebot-auth'] || hdrs['X-HOMEBOT-Auth'] || '';",
  "  if (incoming !== secret) {",
  "    throw new Error('Unauthorized: invalid or missing X-HOMEBOT-Auth header');",
  "  }",
  "}",
  "return $input.all();"
].join('\n');

const AUTH_GUARD_NODE_ID = 'homebot-auth-guard';
const AUTH_GUARD_NODE_NAME = 'Auth Guard';

function isWebhookNode(node) {
  return node.type === 'n8n-nodes-base.webhook';
}

function alreadyHasAuthGuard(wf) {
  return wf.nodes.some(n => n.id === AUTH_GUARD_NODE_ID || n.name === AUTH_GUARD_NODE_NAME);
}

function findConnectionKey(connections, webhookNode) {
  // Try by name first (most common), then by id
  if (connections[webhookNode.name]) return webhookNode.name;
  if (connections[webhookNode.id]) return webhookNode.id;
  return null;
}

function processWorkflow(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  let wf;
  try { wf = JSON.parse(raw); } catch { return { file: filePath, status: 'skip', reason: 'invalid JSON' }; }

  if (!wf.nodes || !wf.connections) return { file: filePath, status: 'skip', reason: 'no nodes/connections' };

  // Find webhook trigger node
  const webhookNode = wf.nodes.find(isWebhookNode);
  if (!webhookNode) return { file: filePath, status: 'skip', reason: 'no webhook trigger' };

  if (alreadyHasAuthGuard(wf)) return { file: filePath, status: 'skip', reason: 'already has Auth Guard' };

  const connKey = findConnectionKey(wf.connections, webhookNode);
  if (!connKey) return { file: filePath, status: 'skip', reason: 'no connections from webhook' };

  // Get the downstream targets from the webhook
  const downstreamOutputs = wf.connections[connKey];
  if (!downstreamOutputs || !downstreamOutputs.main || downstreamOutputs.main.length === 0) {
    return { file: filePath, status: 'skip', reason: 'webhook has no main outputs' };
  }

  // Position the Auth Guard node between webhook and its first downstream
  const whPos = webhookNode.position || [200, 300];
  const guardPos = [whPos[0] + 110, whPos[1]];

  // Shift all non-webhook nodes right by 130px to make room
  for (const node of wf.nodes) {
    if (node === webhookNode) continue;
    if (node.position && node.position[0] > whPos[0]) {
      node.position[0] += 130;
    }
  }

  // Create the Auth Guard node
  const authGuardNode = {
    id: AUTH_GUARD_NODE_ID,
    name: AUTH_GUARD_NODE_NAME,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: guardPos,
    parameters: {
      jsCode: AUTH_GUARD_CODE
    }
  };

  wf.nodes.push(authGuardNode);

  // Rewire: Webhook → Auth Guard → (original downstream)
  // Save original downstream connections
  const originalDownstream = JSON.parse(JSON.stringify(downstreamOutputs.main));

  // Webhook now connects to Auth Guard only
  wf.connections[connKey] = {
    main: [[{ node: AUTH_GUARD_NODE_NAME, type: 'main', index: 0 }]]
  };

  // Auth Guard connects to whatever the webhook used to connect to
  wf.connections[AUTH_GUARD_NODE_NAME] = { main: originalDownstream };

  // Write back
  const output = JSON.stringify(wf, null, 2);
  fs.writeFileSync(filePath, output, 'utf-8');

  return { file: filePath, status: 'injected' };
}

// Main
let injected = 0, skipped = 0;
for (const dir of WORKFLOW_DIRS) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const result = processWorkflow(path.join(dir, f));
    if (result.status === 'injected') {
      injected++;
      console.log(`  ✓ ${path.basename(result.file)}`);
    } else {
      skipped++;
      console.log(`  – ${path.basename(result.file)} (${result.reason})`);
    }
  }
}
console.log(`\nDone: ${injected} injected, ${skipped} skipped`);
