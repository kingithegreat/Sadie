import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import os from 'os';

// Mock electron app.getPath to return a temp dir, same pattern as config-manager.test.ts
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => process.env.TEST_USERDATA || ''),
  },
}));

import {
  getCurrentTier,
  getLicenseStatus,
  activateLicense,
  validateLicense,
  deactivateLicense,
} from '../licensing';

describe('main-process licensing wiring', () => {
  const temp = join(os.tmpdir(), 'homebot-license-test-' + Date.now());

  beforeEach(() => {
    process.env.TEST_USERDATA = temp;
    if (existsSync(temp)) rmSync(temp, { recursive: true, force: true });
    mkdirSync(temp, { recursive: true });
    delete process.env.LEMONSQUEEZY_API_KEY;
    delete process.env.LEMONSQUEEZY_STORE_ID;
    // The owner override. Set as a persistent USER environment variable on the
    // dev machine to unlock Pro, it leaked into the test process and turned
    // every "defaults to Free" assertion Pro — locally only, so CI stayed green
    // while the suite failed on the machine that set it. A test about default
    // tier must not depend on whose computer it runs on.
    delete process.env.HOMEBOT_TIER;
  });

  afterAll(() => {
    try { rmSync(temp, { recursive: true, force: true }); } catch {}
  });

  test('no license on disk → Free tier, hasLicense false', () => {
    expect(getCurrentTier()).toBe('free');
    const status = getLicenseStatus();
    expect(status.tier).toBe('free');
    expect(status.hasLicense).toBe(false);
  });

  test('activate without Lemon Squeezy configured returns a graceful not-configured error', async () => {
    const result = await activateLicense('SOME-KEY');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not configured/i);
    expect(getCurrentTier()).toBe('free');
  });

  test('activate with a fake configured fetch persists a Pro cache and flips the tier', async () => {
    process.env.LEMONSQUEEZY_API_KEY = 'test-key';
    process.env.LEMONSQUEEZY_STORE_ID = '123';
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        activated: true,
        instance: { id: 'inst-1' },
        license_key: { status: 'active', activation_usage: 1, activation_limit: 5, expires_at: null },
      }),
    })) as any;

    try {
      const result = await activateLicense('REAL-KEY');
      expect(result.valid).toBe(true);
      expect(getCurrentTier()).toBe('pro');

      const status = getLicenseStatus();
      expect(status.tier).toBe('pro');
      expect(status.hasLicense).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('validateLicense with no prior activation reports an error and stays Free', async () => {
    const result = await validateLicense();
    expect(result.valid).toBe(false);
    expect(getCurrentTier()).toBe('free');
  });

  test('deactivateLicense clears the stored state even with no instance id', async () => {
    const result = await deactivateLicense();
    expect(result.valid).toBe(true);
    expect(getCurrentTier()).toBe('free');
    expect(getLicenseStatus().hasLicense).toBe(false);
  });

  test('a corrupt license.json on disk is treated as no license (free)', () => {
    writeFileSync(join(temp, 'license.json'), '{not json', 'utf-8');
    expect(getCurrentTier()).toBe('free');
  });

  test('a hand-edited unsigned Pro cache is rejected and resolves to Free', () => {
    // The classic offline bypass: write pro:true directly. No valid signature →
    // must NOT unlock Pro.
    writeFileSync(
      join(temp, 'license.json'),
      JSON.stringify({ cache: { pro: true, lastValidatedAt: Date.now() } }),
      'utf-8'
    );
    expect(getCurrentTier()).toBe('free');
  });

  test('a Pro cache with a tampered/forged signature is rejected', () => {
    writeFileSync(
      join(temp, 'license.json'),
      JSON.stringify({
        cache: { pro: true, lastValidatedAt: Date.now() },
        _machine: 'someone-elses-machine',
        _sig: 'deadbeef'.repeat(8),
      }),
      'utf-8'
    );
    expect(getCurrentTier()).toBe('free');
  });

  test('an offline signed Pro key activates and flips the tier — no network', async () => {
    // Issue a key with an ephemeral keypair and point the app at its public key.
    const { generateKeyPairSync } = require('crypto');
    const { signLicense } = require('../../../../src/licensing/signedLicense');
    const kp = generateKeyPairSync('ed25519');
    process.env.HOMEBOT_LICENSE_PUBLIC_KEY = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    const key = signLicense({ v: 1, tier: 'pro', id: 'lic_1', email: 'buyer@x.com', iat: Date.now() }, kp.privateKey);
    // No global.fetch stub — this must succeed with zero network calls.
    const result = await activateLicense(key);
    expect(result.valid).toBe(true);
    expect(getCurrentTier()).toBe('pro');
    expect(getLicenseStatus().hasLicense).toBe(true);

    // Re-validation is also offline and keeps Pro.
    const revalidated = await validateLicense();
    expect(revalidated.valid).toBe(true);
    expect(getCurrentTier()).toBe('pro');

    delete process.env.HOMEBOT_LICENSE_PUBLIC_KEY;
  });

  test('a forged/garbage signed key is rejected and stays Free', async () => {
    process.env.HOMEBOT_LICENSE_PUBLIC_KEY =
      require('crypto').generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const result = await activateLicense('HOMEBOT-PRO-eyJmb3JnZWQiOnRydWV9.AAAA');
    expect(result.valid).toBe(false);
    expect(getCurrentTier()).toBe('free');
    delete process.env.HOMEBOT_LICENSE_PUBLIC_KEY;
  });

  test('a legitimately activated Pro cache survives a round-trip (sign → load)', async () => {
    process.env.LEMONSQUEEZY_API_KEY = 'test-key';
    process.env.LEMONSQUEEZY_STORE_ID = '123';
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        activated: true,
        instance: { id: 'inst-1' },
        license_key: { status: 'active', activation_usage: 1, activation_limit: 5, expires_at: null },
      }),
    })) as any;
    try {
      await activateLicense('REAL-KEY');
      // Re-read from disk (fresh loadState) — the signature written by
      // activateLicense must verify on this same machine.
      expect(getCurrentTier()).toBe('pro');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
