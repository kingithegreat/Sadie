/**
 * Licensing scaffold tests: LS service (with fake fetch) + tier resolver.
 * No real Lemon Squeezy account/keys are used — fetch is injected.
 */
import {
  LemonSqueezyLicenseService,
  mapLemonSqueezyResponse,
  type FetchLike,
} from '../licensing/lemonSqueezyLicenseService';
import { loadLemonSqueezyConfig, isLemonSqueezyConfigured } from '../licensing/config';
import {
  resolveTier,
  isWithinOfflineGrace,
  DEFAULT_OFFLINE_GRACE_MS,
  CachedEntitlement,
} from '../licensing/tierResolver';

function fakeFetch(ok: boolean, payload: any): FetchLike {
  return async () => ({ ok, status: ok ? 200 : 400, json: async () => payload });
}

const cfg = {
  apiKey: 'test-key',
  storeId: '123',
  productId: '456',
  apiBase: 'https://api.lemonsqueezy.com/v1',
};

describe('LemonSqueezy config', () => {
  test('free tier needs no config — unconfigured when env empty', () => {
    const c = loadLemonSqueezyConfig({} as NodeJS.ProcessEnv);
    expect(isLemonSqueezyConfigured(c)).toBe(false);
    expect(c.apiBase).toBe('https://api.lemonsqueezy.com/v1');
  });

  test('configured when api key + store id present', () => {
    const c = loadLemonSqueezyConfig({
      LEMONSQUEEZY_API_KEY: 'k',
      LEMONSQUEEZY_STORE_ID: '1',
    } as any);
    expect(isLemonSqueezyConfigured(c)).toBe(true);
  });
});

describe('LemonSqueezyLicenseService', () => {
  test('activate returns valid + instanceId on success', async () => {
    const svc = new LemonSqueezyLicenseService(
      cfg,
      fakeFetch(true, {
        activated: true,
        instance: { id: 'inst-1' },
        license_key: { status: 'active', activation_usage: 1, activation_limit: 3, expires_at: null },
      })
    );
    const r = await svc.activate('LK-XYZ', 'Aden-PC');
    expect(r.valid).toBe(true);
    expect(r.instanceId).toBe('inst-1');
    expect(r.activationLimit).toBe(3);
    expect(r.status).toBe('active');
  });

  test('validate returns invalid on error payload', async () => {
    const svc = new LemonSqueezyLicenseService(
      cfg,
      fakeFetch(false, { error: 'license_key not found' })
    );
    const r = await svc.validate('bad-key');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/not found/);
  });

  test('deactivate succeeds', async () => {
    const svc = new LemonSqueezyLicenseService(cfg, fakeFetch(true, { deactivated: true, valid: true }));
    const r = await svc.deactivate('LK-XYZ', 'inst-1');
    expect(r.valid).toBe(true);
  });

  test('unconfigured service refuses without calling network', async () => {
    let called = 0;
    const counting: FetchLike = async () => {
      called++;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const svc = new LemonSqueezyLicenseService({ apiBase: cfg.apiBase }, counting);
    const r = await svc.validate('LK');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/not configured/i);
    expect(called).toBe(0);
  });

  test('network exception is captured as invalid', async () => {
    const throwing: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const svc = new LemonSqueezyLicenseService(cfg, throwing);
    const r = await svc.activate('LK', 'dev');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  test('mapLemonSqueezyResponse handles empty body', () => {
    expect(mapLemonSqueezyResponse(true, null).valid).toBe(false);
  });
});

describe('tierResolver — license state → tier', () => {
  const now = 1_000_000_000_000;

  test('no cache → free (free works with no license)', () => {
    expect(resolveTier(null)).toBe('free');
    expect(resolveTier(undefined)).toBe('free');
    expect(resolveTier({ pro: false, lastValidatedAt: now })).toBe('free');
  });

  test('valid pro, recently validated → pro', () => {
    const cache: CachedEntitlement = { pro: true, lastValidatedAt: now };
    expect(resolveTier(cache, { now })).toBe('pro');
  });

  test('pro but past offline grace → free', () => {
    const cache: CachedEntitlement = {
      pro: true,
      lastValidatedAt: now - DEFAULT_OFFLINE_GRACE_MS - 1,
    };
    expect(resolveTier(cache, { now })).toBe('free');
  });

  test('pro within offline grace → pro', () => {
    const cache: CachedEntitlement = {
      pro: true,
      lastValidatedAt: now - (DEFAULT_OFFLINE_GRACE_MS - 1000),
    };
    expect(resolveTier(cache, { now })).toBe('pro');
    expect(isWithinOfflineGrace(cache, { now })).toBe(true);
  });

  test('expired plan → free even if recently validated', () => {
    const cache: CachedEntitlement = {
      pro: true,
      lastValidatedAt: now,
      expiresAt: now - 1,
    };
    expect(resolveTier(cache, { now })).toBe('free');
  });
});
