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
});
