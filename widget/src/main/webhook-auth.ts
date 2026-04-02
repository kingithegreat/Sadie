/**
 * webhook-auth.ts
 *
 * Generates and persists a per-install shared secret used to authenticate
 * all SADIE → n8n webhook requests.  The secret is stored alongside
 * user-settings.json so it survives app restarts.
 *
 * n8n workflows should validate the X-SADIE-Auth header against the
 * SADIE_WEBHOOK_SECRET environment variable (set automatically by
 * docker-compose / start-sadie.ps1).
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
    console.log('[SADIE] Generated new webhook auth secret');
  } catch (err) {
    console.warn('[SADIE] Could not persist webhook secret:', err);
  }

  return cachedSecret;
}

/**
 * Returns headers that should be included on every SADIE → n8n request.
 * Merges with any additional headers the caller provides.
 */
export function sadieWebhookHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-SADIE-Auth': getWebhookSecret(),
    ...extra,
  };
}
