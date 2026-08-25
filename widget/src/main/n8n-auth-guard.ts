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
    `const hdrs = $input.first()?.json?.headers || {};`,
    `const incoming = hdrs['x-homebot-auth'] || hdrs['X-HOMEBOT-Auth'] || '';`,
    // No secret means this workflow was never deployed by HomeBot — almost
    // always a hand-import. Refusing is the only safe reading: the alternative
    // is an open webhook that runs file and browser automation.
    `if (!secret) {`,
    `  throw new Error('Unauthorized: this workflow has no HomeBot secret. Deploy it from HomeBot instead of importing it by hand.');`,
    `}`,
    `if (incoming !== secret) {`,
    `  throw new Error('Unauthorized: invalid or missing X-HOMEBOT-Auth header');`,
    `}`,
    `return $input.all();`,
  ].join('\n');
}

/**
 * The guard shipped inside the repo's workflow JSONs.
 *
 * Identical to the deployed guard but with an EMPTY secret, so it denies until
 * HomeBot patches it on import. The per-install secret cannot live in the repo
 * — it is generated per machine — so the shipped copy has to be the
 * deny-by-default one.
 *
 * It keeps the shared marker deliberately, so `injectAuthGuards` recognises it
 * and upgrades it in place rather than adding a second guard node.
 */
export function placeholderGuardJsCode(): string {
  return guardJsCode('');
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
 * Matches the embedded-secret assignment `guardJsCode` writes, capturing the
 * JSON string literal so it can be decoded and tested for emptiness. The
 * placeholder copy ships as `let secret = "";` and every legacy env-based
 * guard has no such line at all.
 */
const EMBEDDED_SECRET_RE = /\nlet secret = ("(?:[^"\\]|\\.)*");/;

export type WorkflowGuardState =
  /** At least one guard node, and every one carries an embedded non-empty secret. */
  | 'embedded'
  /**
   * Guard nodes exist but at least one cannot actually authenticate: a
   * placeholder that denies everyone, or a pre-#191 env-based guard that —
   * on n8n ≥1.122.5 — sees an empty process.env and silently passes EVERYONE.
   * Both carry the shared marker, which is why marker presence alone is not
   * proof of protection.
   */
  | 'marker-only'
  /** No guard node at all — predates the Auth Guard, or hand-imported bare. */
  | 'none';

/**
 * Can this deployed workflow actually authenticate requests?
 *
 * The distinction exists because "has the marker" and "rejects strangers" are
 * different facts. The 2026-08-24 audit measured homebot/media-research serving
 * research with no auth header at all; its guard carried the marker and read
 * its secret from process.env, which Code nodes never see. Detecting by marker
 * alone would have blessed exactly that workflow.
 */
export function workflowGuardState(wf: N8nWorkflow): WorkflowGuardState {
  if (!wf || !Array.isArray(wf.nodes)) return 'none';
  const guards = wf.nodes.filter(isGuardNode);
  if (guards.length === 0) return 'none';
  for (const g of guards) {
    const js = g.parameters?.jsCode as string;
    const m = js.match(EMBEDDED_SECRET_RE);
    let secret: string = '';
    if (m) {
      try { secret = JSON.parse(m[1]) as string; } catch { /* treat as not embedded */ }
    }
    if (!secret) return 'marker-only';
  }
  return 'embedded';
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

