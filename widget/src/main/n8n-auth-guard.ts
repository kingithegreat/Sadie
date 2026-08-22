/**
 * n8n-auth-guard.ts
 *
 * Every workflow HomeBot deploys into the n8n container gets an **Auth Guard**
 * Code node between each Webhook trigger and its first downstream node. The
 * guard rejects requests missing the shared per-install secret (sent by
 * HomeBot as the `X-HOMEBOT-Auth` header), so only this machine's app can
 * trigger automations — not anything else that can reach the port.
 *
 * The guard reads HOMEBOT_WEBHOOK_SECRET from the n8n container's environment
 * (set via docker-compose / start-homebot.ps1). When unset it skips validation
 * so local development keeps working; webhook-auth.ts warns about that state
 * at app startup.
 *
 * This module is intentionally dependency-free so it unit-tests without
 * mocking Electron, Docker or HTTP.
 */

export const AUTH_GUARD_NODE_TYPE = 'n8n-nodes-base.code';

/** Same logic as n8n-workflows/_shared/auth-guard.js — keep the two in sync. */
export const AUTH_GUARD_JS = [
  "const secret = process.env.HOMEBOT_WEBHOOK_SECRET;",
  "if (secret) {",
  "  const hdrs = $input.first()?.json?.headers || {};",
  "  const incoming = hdrs['x-homebot-auth'] || hdrs['X-HOMEBOT-Auth'] || '';",
  "  if (incoming !== secret) {",
  "    throw new Error('Unauthorized: invalid or missing X-HOMEBOT-Auth header');",
  "  }",
  "}",
  "return $input.all();",
].join('\n');

interface N8nNode {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

interface N8nConnectionTarget {
  node: string;
  [key: string]: unknown;
}

interface N8nWorkflow {
  nodes?: N8nNode[];
  connections?: Record<string, { main?: Array<Array<N8nConnectionTarget>> }>;
  [key: string]: unknown;
}

function isGuardNode(node: N8nNode): boolean {
  return (
    node.type === AUTH_GUARD_NODE_TYPE &&
    typeof node.parameters?.jsCode === 'string' &&
    (node.parameters.jsCode as string).includes('HOMEBOT_WEBHOOK_SECRET')
  );
}

/**
 * Insert Auth Guard nodes after every Webhook trigger that doesn't already
 * have one. Mutates nothing — returns a new workflow object.
 *
 * Idempotent: running it on an already-guarded workflow injects nothing.
 */
export function injectAuthGuards<T extends N8nWorkflow>(wf: T): { wf: T; injected: number } {
  if (!wf || !Array.isArray(wf.nodes) || !wf.connections) {
    return { wf, injected: 0 };
  }

  const nodes = wf.nodes.map((n) => ({ ...n }));
  const connections: NonNullable<N8nWorkflow['connections']> = {};
  for (const [src, conn] of Object.entries(wf.connections)) {
    connections[src] = JSON.parse(JSON.stringify(conn));
  }

  let guardCount = 0;
  let injected = 0;

  for (const node of nodes) {
    if (node.type !== 'n8n-nodes-base.webhook') continue;
    const outgoing = connections[node.name]?.main?.[0];
    if (!outgoing || outgoing.length === 0) continue;

    // Already guarded when the first downstream node is a guard.
    const firstTarget = nodes.find((n) => n.name === outgoing[0]?.node);
    if (firstTarget && isGuardNode(firstTarget)) continue;

    guardCount += 1;
    const guardName = guardCount === 1 ? 'Auth Guard' : `Auth Guard ${guardCount}`;
    nodes.push({
      name: guardName,
      type: AUTH_GUARD_NODE_TYPE,
      typeVersion: 2,
      position: [(node.position as number[]) ? (node.position as number[])[0] + 200 : 400, (node.position as number[]) ? (node.position as number[])[1] : 300],
      parameters: { jsCode: AUTH_GUARD_JS },
    });

    // Webhook → Guard → (original targets)
    connections[guardName] = { main: [JSON.parse(JSON.stringify(outgoing))] };
    outgoing.forEach((t: N8nConnectionTarget) => { t.node = guardName; });
    injected += 1;
  }

  return { wf: { ...wf, nodes, connections }, injected };
}
