/**
 * Entitlements (Pro tier dimension) unit tests.
 */
import {
  isPro,
  hasFeature,
  capabilitiesFor,
  requiredTierFor,
  isProCapability,
  normalizeTier,
  mcpConnectionLimit,
  canAddMcpConnection,
  checkEntitlement,
  buildUpgradePrompt,
  UNLIMITED,
  DEFAULT_UPGRADE_URL,
} from '../entitlements';

describe('entitlements — tier normalization & isPro', () => {
  test('normalizeTier defaults unknown/undefined to free', () => {
    expect(normalizeTier(undefined)).toBe('free');
    expect(normalizeTier(null)).toBe('free');
    expect(normalizeTier('garbage')).toBe('free');
    expect(normalizeTier('pro')).toBe('pro');
  });

  test('isPro reflects tier', () => {
    expect(isPro('pro')).toBe(true);
    expect(isPro('free')).toBe(false);
    expect(isPro(undefined)).toBe(false);
  });
});

describe('entitlements — capability matrix', () => {
  test('free tier gets free capabilities and NOT pro ones', () => {
    expect(hasFeature('free', 'localChat')).toBe(true);
    expect(hasFeature('free', 'tasterTools')).toBe(true);
    expect(hasFeature('free', 'basicPermissions')).toBe(true);
    expect(hasFeature('free', 'automation')).toBe(false);
    expect(hasFeature('free', 'fullTools')).toBe(false);
    expect(hasFeature('free', 'rag')).toBe(false);
    expect(hasFeature('free', 'voice')).toBe(false);
    expect(hasFeature('free', 'imageGen')).toBe(false);
  });

  test('pro tier is a strict superset of free', () => {
    const free = capabilitiesFor('free');
    const pro = capabilitiesFor('pro');
    for (const cap of free) {
      expect(pro).toContain(cap);
    }
    expect(pro.length).toBeGreaterThan(free.length);
    // flagship + key pro features present
    for (const cap of ['automation', 'fullTools', 'rag', 'voice', 'imageGen', 'morningBriefing', 'advancedPolicy'] as const) {
      expect(hasFeature('pro', cap)).toBe(true);
    }
  });

  test('undefined tier is treated as free for gating', () => {
    expect(hasFeature(undefined, 'automation')).toBe(false);
    expect(hasFeature(undefined, 'localChat')).toBe(true);
  });

  test('requiredTierFor / isProCapability classify correctly', () => {
    expect(requiredTierFor('localChat')).toBe('free');
    expect(requiredTierFor('automation')).toBe('pro');
    expect(isProCapability('automation')).toBe(true);
    expect(isProCapability('tasterTools')).toBe(false);
  });
});

describe('entitlements — MCP connection caps', () => {
  test('free allows exactly 1, pro is unlimited', () => {
    expect(mcpConnectionLimit('free')).toBe(1);
    expect(mcpConnectionLimit('pro')).toBe(UNLIMITED);
    expect(canAddMcpConnection('free', 0)).toBe(true);
    expect(canAddMcpConnection('free', 1)).toBe(false);
    expect(canAddMcpConnection('pro', 999)).toBe(true);
  });
});

describe('entitlements — checkEntitlement & upgrade prompt', () => {
  test('allowed when tier has capability', () => {
    expect(checkEntitlement('pro', 'automation')).toEqual({ allowed: true });
    expect(checkEntitlement('free', 'localChat')).toEqual({ allowed: true });
  });

  test('blocked free user gets structured upgrade prompt', () => {
    const decision = checkEntitlement('free', 'automation');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.upgrade.reason).toBe('upgrade_required');
      expect(decision.upgrade.capability).toBe('automation');
      expect(decision.upgrade.requiredTier).toBe('pro');
      expect(decision.upgrade.upgradeUrl).toBe(DEFAULT_UPGRADE_URL);
      expect(decision.upgrade.message).toMatch(/Automation Center/);
    }
  });

  test('custom upgrade url flows through', () => {
    const p = buildUpgradePrompt('voice', 'https://store.lemonsqueezy.com/checkout/x');
    expect(p.upgradeUrl).toBe('https://store.lemonsqueezy.com/checkout/x');
  });
});
