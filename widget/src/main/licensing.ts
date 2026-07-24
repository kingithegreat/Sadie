/**
 * SADIE / HomeBot — main-process wiring for Pro licensing.
 * ---------------------------------------------------------------------------
 * Bridges the pure, electron-agnostic modules in repo-root `src/licensing` and
 * `src/entitlements` to the actual app: persists the CachedEntitlement +
 * activated license to a plain JSON file in userData (same pattern as
 * settings/automations/quiz-progress elsewhere in this file), and exposes a
 * TierProvider (getCurrentTier) consumed by the gated IPC handlers.
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  loadLemonSqueezyConfig,
  LemonSqueezyLicenseService,
  type CachedEntitlement,
  resolveTier,
  verifySignedLicense,
  looksLikeSignedLicense,
  getLicensePublicKey,
} from '../../../src/licensing';
import { Tier, DEFAULT_UPGRADE_URL } from '../../../src/entitlements';
import type { LicenseValidationResult } from '../../../src/licensing/types';

interface StoredLicenseState {
  licenseKey?: string;
  instanceId?: string;
  /** How this license is validated: offline signed key vs Lemon Squeezy. */
  kind?: 'offline' | 'lemonsqueezy';
  cache?: CachedEntitlement;
  /** HMAC over the entitlement payload, bound to this machine. */
  _sig?: string;
  /** Machine fingerprint the signature is bound to. */
  _machine?: string;
}

/**
 * App-embedded HMAC key. This is NOT a secret that stops a determined attacker
 * with a disassembler — the authoritative Pro check is server-side validation
 * (LemonSqueezyLicenseService). Its job is to stop the trivial offline bypass:
 * hand-editing license.json to `{"cache":{"pro":true}}`, or copying one user's
 * license file onto another machine. Both now fail signature/fingerprint checks
 * and resolve to Free.
 */
const CACHE_SIGNING_KEY = 'homebot.license.cache.v1.a7f3e9c1-do-not-rely-as-sole-gate';

function licenseFilePath(): string {
  return path.join(app.getPath('userData'), 'license.json');
}

/** Stable-per-machine fingerprint used to bind the cached entitlement. */
function machineFingerprint(): string {
  const nics = os.networkInterfaces();
  const mac = Object.values(nics)
    .flat()
    .find((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')?.mac || '';
  const parts = [os.hostname(), os.platform(), os.arch(), os.userInfo().username, mac];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/** Canonical payload that the signature covers (order-stable). */
function signablePayload(state: StoredLicenseState, machine: string): string {
  return JSON.stringify({
    licenseKey: state.licenseKey ?? null,
    instanceId: state.instanceId ?? null,
    cache: state.cache
      ? { pro: state.cache.pro, lastValidatedAt: state.cache.lastValidatedAt, expiresAt: state.cache.expiresAt ?? null }
      : null,
    machine,
  });
}

function signState(state: StoredLicenseState, machine: string): string {
  return crypto.createHmac('sha256', CACHE_SIGNING_KEY).update(signablePayload(state, machine)).digest('hex');
}

function loadState(): StoredLicenseState {
  let parsed: StoredLicenseState;
  try {
    parsed = JSON.parse(fs.readFileSync(licenseFilePath(), 'utf-8'));
  } catch {
    return {};
  }
  // A state carrying an entitlement cache must be signed for THIS machine.
  // Anything else (hand-edited, unsigned, or copied from another machine) is
  // rejected — we drop the cache so the tier resolves to Free.
  if (parsed?.cache) {
    const machine = machineFingerprint();
    const expected = signState(parsed, machine);
    const provided = String(parsed._sig || '');
    const ok =
      parsed._machine === machine &&
      provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) {
      console.warn('[Licensing] license cache failed signature/fingerprint check — treating as unlicensed');
      return { licenseKey: parsed.licenseKey, instanceId: parsed.instanceId };
    }
  }
  return parsed;
}

function saveState(state: StoredLicenseState): void {
  const machine = machineFingerprint();
  const signed: StoredLicenseState = { ...state };
  delete signed._sig;
  delete signed._machine;
  if (signed.cache) {
    signed._machine = machine;
    signed._sig = signState(signed, machine);
  }
  fs.writeFileSync(licenseFilePath(), JSON.stringify(signed, null, 2), 'utf-8');
}

function service(): LemonSqueezyLicenseService {
  return new LemonSqueezyLicenseService(loadLemonSqueezyConfig(), fetch as any);
}

function cacheFromResult(result: LicenseValidationResult): CachedEntitlement {
  return {
    pro: result.valid,
    lastValidatedAt: Date.now(),
    expiresAt: result.expiresAt ? new Date(result.expiresAt).getTime() : undefined,
  };
}

/** Where the "Upgrade to Pro" button sends the user. Env override wins. */
function checkoutUrl(): string {
  const fromEnv = process.env.HOMEBOT_CHECKOUT_URL?.trim();
  return fromEnv || loadLemonSqueezyConfig().checkoutUrl || DEFAULT_UPGRADE_URL;
}

/**
 * Verify an offline signed key locally (no network) and, if valid, return a
 * successful result carrying the payload's expiry. Returns null when the key
 * is not a signed key (so the caller can fall through to Lemon Squeezy).
 */
function activateOffline(licenseKey: string): LicenseValidationResult | null {
  if (!looksLikeSignedLicense(licenseKey)) return null;
  const check = verifySignedLicense(licenseKey, getLicensePublicKey());
  if (!check.valid) {
    return { valid: false, error: check.error || 'Invalid license key.' };
  }
  return {
    valid: true,
    status: 'active',
    expiresAt: check.payload?.exp ? new Date(check.payload.exp).toISOString() : null,
  };
}

/** TierProvider — read at call time so an activation/expiry takes effect immediately. */
export function getCurrentTier(): Tier {
  return resolveTier(loadState().cache ?? null);
}

export function getLicenseStatus(): {
  tier: Tier;
  hasLicense: boolean;
  lastValidatedAt?: number;
  expiresAt?: number;
  upgradeUrl: string;
} {
  const state = loadState();
  return {
    tier: resolveTier(state.cache ?? null),
    hasLicense: !!state.licenseKey,
    lastValidatedAt: state.cache?.lastValidatedAt,
    expiresAt: state.cache?.expiresAt,
    upgradeUrl: checkoutUrl(),
  };
}

export async function activateLicense(licenseKey: string): Promise<LicenseValidationResult> {
  const key = licenseKey.trim();

  // 1) Offline signed key — the default, works-anywhere path (no network/account).
  const offline = activateOffline(key);
  if (offline) {
    if (offline.valid) {
      saveState({ licenseKey: key, kind: 'offline', cache: cacheFromResult(offline) });
    }
    return offline;
  }

  // 2) Lemon Squeezy key (only if the vendor configured an LS account).
  const result = await service().activate(key, `homebot-${os.hostname()}`);
  if (result.valid) {
    saveState({ licenseKey: key, kind: 'lemonsqueezy', instanceId: result.instanceId, cache: cacheFromResult(result) });
  }
  return result;
}

export async function validateLicense(): Promise<LicenseValidationResult> {
  const state = loadState();
  if (!state.licenseKey) {
    return { valid: false, error: 'No license activated on this device.' };
  }

  // Offline signed keys re-verify locally — no network needed, ever.
  if (state.kind === 'offline' || looksLikeSignedLicense(state.licenseKey)) {
    const offline = activateOffline(state.licenseKey)!;
    saveState({ ...state, kind: 'offline', cache: cacheFromResult(offline) });
    return offline;
  }

  const result = await service().validate(state.licenseKey, state.instanceId);
  saveState({ ...state, cache: cacheFromResult(result) });
  return result;
}

export async function deactivateLicense(): Promise<LicenseValidationResult> {
  const state = loadState();
  // Offline keys have no server-side seat to free — just clear local state.
  if (state.kind === 'offline' || !state.licenseKey || !state.instanceId) {
    saveState({});
    return { valid: true };
  }
  const result = await service().deactivate(state.licenseKey, state.instanceId);
  saveState({});
  return result;
}
