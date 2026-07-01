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
import {
  loadLemonSqueezyConfig,
  LemonSqueezyLicenseService,
  type CachedEntitlement,
  resolveTier,
} from '../../../src/licensing';
import { Tier, DEFAULT_UPGRADE_URL } from '../../../src/entitlements';
import type { LicenseValidationResult } from '../../../src/licensing/types';

interface StoredLicenseState {
  licenseKey?: string;
  instanceId?: string;
  cache?: CachedEntitlement;
}

function licenseFilePath(): string {
  return path.join(app.getPath('userData'), 'license.json');
}

function loadState(): StoredLicenseState {
  try {
    const raw = fs.readFileSync(licenseFilePath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveState(state: StoredLicenseState): void {
  fs.writeFileSync(licenseFilePath(), JSON.stringify(state, null, 2), 'utf-8');
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
    upgradeUrl: loadLemonSqueezyConfig().checkoutUrl || DEFAULT_UPGRADE_URL,
  };
}

export async function activateLicense(licenseKey: string): Promise<LicenseValidationResult> {
  const result = await service().activate(licenseKey.trim(), `homebot-${os.hostname()}`);
  if (result.valid) {
    saveState({ licenseKey: licenseKey.trim(), instanceId: result.instanceId, cache: cacheFromResult(result) });
  }
  return result;
}

export async function validateLicense(): Promise<LicenseValidationResult> {
  const state = loadState();
  if (!state.licenseKey) {
    return { valid: false, error: 'No license activated on this device.' };
  }
  const result = await service().validate(state.licenseKey, state.instanceId);
  saveState({ ...state, cache: cacheFromResult(result) });
  return result;
}

export async function deactivateLicense(): Promise<LicenseValidationResult> {
  const state = loadState();
  if (!state.licenseKey || !state.instanceId) {
    saveState({});
    return { valid: true };
  }
  const result = await service().deactivate(state.licenseKey, state.instanceId);
  saveState({});
  return result;
}
