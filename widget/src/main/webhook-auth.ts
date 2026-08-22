/**
 * webhook-auth.ts
 *
 * Generates and persists a per-install shared secret used to authenticate
 * all HomeBot → n8n webhook requests.  The secret is stored alongside
 * user-settings.json so it survives app restarts.
 *
 * n8n workflows should validate the X-HOMEBOT-Auth header against the
 * HOMEBOT_WEBHOOK_SECRET environment variable (set automatically by
 * docker-compose / start-homebot.ps1).
 */

import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';

const SECRET_FILENAME = 'webhook-secret';
let cachedSecret: string | null = null;

function secretPath(): string {
  try {
    return join(app.getPath('userData'), 'config', SECRET_FILENAME);
  } catch {
    // In test environments app.getPath may not be available
    return join(require('os').tmpdir(), SECRET_FILENAME);
  }
}

/**
 * Return the shared webhook secret, generating one on first call.
 * The token is a 32-byte hex string (256 bits of entropy).
 */
export function getWebhookSecret(): string {
  if (cachedSecret) return cachedSecret;

  const p = secretPath();
  try {
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf-8').trim();
      if (raw.length >= 32) {
        cachedSecret = raw;
        return cachedSecret;
      }
    }
  } catch {
    // Fall through to generation
  }

  // Generate a new secret
  cachedSecret = randomBytes(32).toString('hex');

  // Persist to disk
  try {
    const dir = join(p, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, cachedSecret, 'utf-8');
    console.log('[HomeBot] Generated new webhook auth secret');
  } catch (err) {
    console.warn('[HomeBot] Could not persist webhook secret:', err);
  }

  return cachedSecret;
}

/**
 * Returns headers that should be included on every HomeBot → n8n request.
 * Merges with any additional headers the caller provides.
 *
 * Warns once when the Electron side has a secret but n8n may not: the
 * workflow auth guards SKIP validation when HOMEBOT_WEBHOOK_SECRET is unset
 * (local-dev convenience), so a silent mismatch would mean unauthenticated
 * webhooks. docker-compose / start-homebot.ps1 normally export the variable;
 * this warning makes a broken handoff visible at startup instead of never.
 */
let warnedSecretMismatch = false;
export function homebotWebhookHeaders(extra?: Record<string, string>): Record<string, string> {
  const secret = getWebhookSecret();
  if (!warnedSecretMismatch && !process.env['HOMEBOT_WEBHOOK_SECRET']) {
    warnedSecretMismatch = true;
    console.warn(
      '[HomeBot] HOMEBOT_WEBHOOK_SECRET is not set in this environment — n8n workflow ' +
        'auth guards will SKIP validation and webhook endpoints are unauthenticated on ' +
        'the network. Set it via start-homebot.ps1 or docker-compose.'
    );
  }
  return {
    'Content-Type': 'application/json',
    'X-HOMEBOT-Auth': secret,
    ...extra,
  };
}
