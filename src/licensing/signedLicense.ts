/**
 * HomeBot / HomeBot — Offline signed license keys (Ed25519).
 * ---------------------------------------------------------------------------
 * Lets HomeBot sell Pro TODAY with no third-party licensing account and no
 * server: the vendor holds a private key, mints a signed key per sale (through
 * any payment method — Gumroad, Ko-fi, PayPal, or manual), and the customer
 * pastes it in. The app embeds only the PUBLIC key and verifies keys offline,
 * so a paying customer's entitlement is cryptographically guaranteed and a
 * non-customer cannot forge one.
 *
 * Key format (URL-safe, paste-friendly, grouped for readability):
 *   HOMEBOT-PRO-<base64url(payloadJSON)>.<base64url(ed25519 signature)>
 *
 * This module is PURE (no electron, no I/O beyond Node's crypto primitive) so
 * it is fully unit-testable with an ephemeral keypair.
 */
import * as crypto from 'crypto';
import { Tier, normalizeTier } from '../entitlements';

/** Everything the signature covers — the customer's entitlement. */
export interface LicensePayload {
  /** Payload schema version. */
  v: number;
  /** Granted tier. */
  tier: Tier;
  /** Unique license id (lets the vendor track/revoke a specific sale). */
  id: string;
  /** Optional buyer identity, shown in the app so the license feels "theirs". */
  name?: string;
  email?: string;
  /** Issued-at epoch ms. */
  iat: number;
  /** Optional expiry epoch ms (omit for a lifetime license). */
  exp?: number;
}

export const LICENSE_PREFIX = 'HOMEBOT-PRO-';
export const LICENSE_PAYLOAD_VERSION = 1;

export interface VerifyResult {
  valid: boolean;
  payload?: LicensePayload;
  error?: string;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/** Load an embedded public key (base64 SPKI DER, or PEM) into a KeyObject. */
export function publicKeyFrom(encoded: string): crypto.KeyObject {
  const trimmed = (encoded || '').trim();
  if (!trimmed) throw new Error('empty public key');
  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    return crypto.createPublicKey(trimmed);
  }
  return crypto.createPublicKey({
    key: Buffer.from(trimmed, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

/**
 * Sign a payload with an Ed25519 private key → a license key string.
 * Used by the vendor's offline `issue-license` script, never in the shipped app.
 */
export function signLicense(payload: LicensePayload, privateKey: crypto.KeyObject | string): string {
  const key = typeof privateKey === 'string' ? crypto.createPrivateKey(privateKey) : privateKey;
  const payloadJson = Buffer.from(JSON.stringify(payload), 'utf8');
  // Ed25519: algorithm must be null; the key type selects the scheme.
  const sig = crypto.sign(null, payloadJson, key);
  return `${LICENSE_PREFIX}${b64urlEncode(payloadJson)}.${b64urlEncode(sig)}`;
}

/**
 * Verify a license key against the embedded public key.
 * Returns { valid:false, error } for anything malformed, wrongly-signed,
 * wrong-version, non-Pro, or expired — the app treats all of those as Free.
 */
export function verifySignedLicense(
  licenseKey: string,
  publicKeyEncoded: string,
  now: number = Date.now()
): VerifyResult {
  try {
    const raw = (licenseKey || '').trim();
    if (!raw) return { valid: false, error: 'Empty license key.' };
    const body = raw.startsWith(LICENSE_PREFIX) ? raw.slice(LICENSE_PREFIX.length) : raw;
    const dot = body.indexOf('.');
    if (dot <= 0) return { valid: false, error: 'Malformed license key.' };

    const payloadB64 = body.slice(0, dot);
    const sigB64 = body.slice(dot + 1);
    const payloadBuf = b64urlDecode(payloadB64);
    const sigBuf = b64urlDecode(sigB64);

    let key: crypto.KeyObject;
    try {
      key = publicKeyFrom(publicKeyEncoded);
    } catch {
      return { valid: false, error: 'License verification is not configured on this build.' };
    }

    const ok = crypto.verify(null, payloadBuf, key, sigBuf);
    if (!ok) return { valid: false, error: 'License key signature is invalid.' };

    let payload: LicensePayload;
    try {
      payload = JSON.parse(payloadBuf.toString('utf8'));
    } catch {
      return { valid: false, error: 'License payload is unreadable.' };
    }

    if (payload.v !== LICENSE_PAYLOAD_VERSION) {
      return { valid: false, error: `Unsupported license version (${payload.v}).` };
    }
    if (normalizeTier(payload.tier) !== 'pro') {
      return { valid: false, error: 'License does not grant Pro.' };
    }
    if (typeof payload.exp === 'number' && now > payload.exp) {
      return { valid: false, error: 'License has expired.' };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: `License verification failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Cheap shape check so the app can route a key to the offline verifier. */
export function looksLikeSignedLicense(licenseKey: string): boolean {
  return typeof licenseKey === 'string' && licenseKey.trim().startsWith(LICENSE_PREFIX);
}
