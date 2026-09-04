/**
 * n8n Code-node snippet: verify the X-HOMEBOT-Auth header.
 *
 * Place a Code node (JavaScript, "Run Once for All Items") immediately after
 * each Webhook Trigger. If the header is missing or wrong the node throws,
 * and n8n returns an error instead of running the rest of the workflow.
 *
 * ── Do not read the secret from the environment ──
 *
 * This file used to say to use `process.env.HOMEBOT_WEBHOOK_SECRET`. That does
 * not work. Verified on n8n 1.122.5 (2026-08-22): Code nodes see an EMPTY
 * `process.env` regardless of `N8N_BLOCK_ENV_ACCESS_IN_NODE`.
 *
 * The old guard was `if (secret) { ...compare... }`, so an empty env read
 * skipped the comparison entirely and the webhook accepted anything. Every
 * shipped workflow carried a guard that was a no-op, and it looked correct.
 *
 * ── Two rules that follow from that ──
 *
 * 1. The secret must be EMBEDDED in the node by whoever deploys the workflow.
 *    HomeBot does this automatically — `injectAuthGuards` in
 *    `widget/src/main/n8n-auth-guard.ts` bakes the per-install secret into
 *    every workflow it deploys, and upgrades older guards in place.
 *
 * 2. The guard must FAIL CLOSED. No secret means the workflow was never
 *    deployed by HomeBot — almost always a hand-import — and refusing is the
 *    only safe reading, because these webhooks run file and browser
 *    automation.
 *
 * ── Prefer deploying from HomeBot ──
 *
 * Importing these JSONs by hand through the n8n UI leaves the placeholder in
 * place, so the workflow will refuse every request until HomeBot deploys it.
 * That is deliberate: an unauthenticated automation endpoint is worse than one
 * that does not run yet.
 */

// Paste this into the Code node. HomeBot replaces the empty string with your
// per-install secret when it deploys the workflow.
let secret = "";
if (!secret) secret = process.env.HOMEBOT_WEBHOOK_SECRET; // inert on n8n 1.122.5; kept only as a last resort
const hdrs = $input.first()?.json?.headers || {};
const incoming = hdrs['x-homebot-auth'] || hdrs['X-HOMEBOT-Auth'] || '';
if (!secret) {
  throw new Error('Unauthorized: this workflow has no HomeBot secret. Deploy it from HomeBot instead of importing it by hand.');
}
if (incoming !== secret) {
  throw new Error('Unauthorized: invalid or missing X-HOMEBOT-Auth header');
}
return $input.all();
