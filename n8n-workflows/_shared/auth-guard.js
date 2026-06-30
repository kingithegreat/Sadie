/**
 * n8n Code-node snippet: verify X-HOMEBOT-Auth header.
 *
 * Place a Code node (JavaScript) **immediately after** each Webhook Trigger
 * node. This reads the incoming request header and compares it against
 * the HOMEBOT_WEBHOOK_SECRET environment variable set via docker-compose.
 *
 * If the header is missing or wrong the node throws, which causes n8n
 * to return a 403 response via the Webhook Trigger's error handling.
 *
 * Usage in n8n Code node (set to "Run Once for All Items"):
 *   Paste the code below (or require this file from the mounted /workflows volume).
 */

// ---------- paste into an n8n Code node ----------
const secret = process.env.HOMEBOT_WEBHOOK_SECRET;
if (secret) {
  // Header names are lower-cased by Node.js / n8n
  const incoming =
    $input.first()?.json?.headers?.['x-homebot-auth'] ??
    $input.first()?.json?.headers?.['X-HOMEBOT-Auth'] ??
    '';
  if (incoming !== secret) {
    throw new Error('Unauthorized: invalid or missing X-HOMEBOT-Auth header');
  }
}
// If HOMEBOT_WEBHOOK_SECRET is not set we skip validation (local dev).
return $input.all();
