/**
 * n8n-auth-guard.ts
 *
 * Every workflow HomeBot deploys into the n8n container gets an **Auth Guard**
 * Code node between each Webhook trigger and its first downstream node. The
 * guard rejects requests missing the shared per-install secret (sent by
 * HomeBot as the `X-HOMEBOT-Auth` header), so only this machine's app can
 * trigger automations — not anything else that can reach the port.
 *
 * The secret is **embedded into the generated Code node** rather than read
 * from process.env: verified on n8n 1.122.5 (2026-08-22) that Code nodes see
 * an EMPTY process.env regardless of N8N_BLOCK_ENV_ACCESS_IN_NODE, so the
 * original env-based guards silently skipped validation on every execution.
 * The embedded value lives in the n8n database — the same trust boundary as
 * every other automation definition.
 *
 * This module is intentionally dependency-free so it unit-tests without
 * mocking Electron, Docker or HTTP.
 */

export const AUTH_GUARD_NODE_TYPE = 'n8n-nodes-base.code';

/** Marker shared by all guard variants (env-based legacy ones included). */
const GUARD_MARKER = "hdrs['x-homebot-auth']";

/** Generate the guard script with the per-install secret baked in. */
export function guardJsCode(secret: string): string {
  return [
    `// Auth Guard — deployed by HomeBot; validates X-HOMEBOT-Auth.`,
    `let secret = ${JSON.stringify(secret)};`,
    `if (!secret) secret = process.env.HOMEBOT_WEBHOOK_SECRET;`,
    `if (secret) {`,
    `  const hdrs = $input.first()?.json?.headers || {};`,
    `  const incoming = hdrs['x-homebot-auth'] || hdrs['X-HOMEBOT-Auth'] || '';`,
    `  if (incoming !== secret) {`,
    `    throw new Error('Unauthorized: invalid or missing X-HOMEBOT-Auth header');`,
    `  }`,
    `}`,
    `return $input.all();`,
  ].join('\n');
}

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
    (node.parameters.jsCode as string).includes(GUARD_MARKER)
  );
}

/**
 * Insert Auth Guard nodes after every Webhook trigger that doesn't already
 * have one, and upgrade any existing guard to the embedded-secret form (the
 * old process.env-based guards are inert on current n8n — Code nodes see no
 * environment). Mutates nothing — returns a new workflow object.
 *
 * Idempotent: running it twice changes nothing the second time.
 */
export function injectAuthGuards<T extends N8nWorkflow>(
  wf: T,
  secret: string,
): { wf: T; injected: number } {
  if (!wf || !Array.isArray(wf.nodes) || !wf.connections) {
    return { wf, injected: 0 };
  }

  const jsCode = guardJsCode(secret);

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

    const firstTarget = nodes.find((n) => n.name === outgoing[0]?.node);
    if (firstTarget && isGuardNode(firstTarget)) {
      // Upgrade legacy env-based guards to the embedded-secret form.
      if (
        secret &&
        !(firstTarget.parameters?.jsCode as string)?.includes(JSON.stringify(secret))
      ) {
        firstTarget.parameters = { ...(firstTarget.parameters as object), jsCode };
      }
      continue;
    }

    guardCount += 1;
    const guardName = guardCount === 1 ? 'Auth Guard' : `Auth Guard ${guardCount}`;
    nodes.push({
      name: guardName,
      type: AUTH_GUARD_NODE_TYPE,
      typeVersion: 2,
      position: [(node.position as number[]) ? (node.position as number[])[0] + 200 : 400, (node.position as number[]) ? (node.position as number[])[1] : 300],
      parameters: { jsCode },
    });

    // Webhook → Guard → (original targets)
    connections[guardName] = { main: [JSON.parse(JSON.stringify(outgoing))] };
    outgoing.forEach((t: N8nConnectionTarget) => { t.node = guardName; });
    injected += 1;
  }

  return { wf: { ...wf, nodes, connections }, injected };
}

