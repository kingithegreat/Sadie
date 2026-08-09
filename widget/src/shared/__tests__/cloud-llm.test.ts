/**
 * cloud-llm.test.ts — resolveCloudLLM(), the single cloud-routing gate.
 *
 * The anchor case reproduces the exact settings file that shipped the bug:
 * useCustomLLM true, Gemini provider + model selected, customLLM.apiKey empty,
 * and the real key sitting in the top-level geminiApiKey vault. The renderer
 * hydrated that key for display; the router never did, so every chat silently
 * fell back to local qwen while Settings showed Gemini as configured.
 */

import { resolveCloudLLM } from '../cloud-llm';
import type { Settings } from '../types';

/** Minimal valid settings; tests override what they exercise. */
function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    alwaysOnTop: false,
    n8nUrl: 'http://localhost:5678',
    widgetHotkey: 'Ctrl+Shift+Space',
    ...overrides,
  } as Settings;
}

describe('the shipped bug: key in the vault, not in customLLM', () => {
  const adenShape = baseSettings({
    useCustomLLM: true,
    chatModel: 'qwen2.5:7b',
    geminiApiKey: 'AIza-real-key-from-the-vault',
    customLLM: {
      name: 'Google AI Studio',
      provider: 'google-ai-studio',
      model: 'gemini-2.5-flash',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: '', // <- the actual on-disk state that broke routing
      enabled: true,
    },
  });

  test('resolves ACTIVE — this is the fix', () => {
    const r = resolveCloudLLM(adenShape);
    expect(r.active).toBe(true);
    expect(r.misconfiguration).toBeNull();
  });

  test('hydrates the key into the returned config for downstream callers', () => {
    const r = resolveCloudLLM(adenShape);
    expect(r.config?.apiKey).toBe('AIza-real-key-from-the-vault');
  });

  test('never mutates the caller\'s settings object', () => {
    resolveCloudLLM(adenShape);
    expect(adenShape.customLLM?.apiKey).toBe('');
  });
});

describe('vault hydration per provider', () => {
  test.each([
    ['anthropic', 'anthropicApiKey', 'sk-ant-vault'],
    ['openai', 'openaiApiKey', 'sk-vault'],
    ['google-gemini', 'geminiApiKey', 'AIza-vault'],
  ] as const)('%s hydrates from %s', (provider, field, key) => {
    const r = resolveCloudLLM(baseSettings({
      useCustomLLM: true,
      [field]: key,
      customLLM: { name: 't', provider, model: 'm', apiUrl: 'https://x', apiKey: '', enabled: true },
    } as Partial<Settings>));
    expect(r.active).toBe(true);
    expect(r.config?.apiKey).toBe(key);
  });

  test('an explicit customLLM.apiKey wins over the vault', () => {
    const r = resolveCloudLLM(baseSettings({
      useCustomLLM: true,
      geminiApiKey: 'AIza-vault',
      customLLM: { name: 't', provider: 'google-ai-studio', model: 'm', apiUrl: 'https://x', apiKey: 'AIza-own', enabled: true },
    }));
    expect(r.config?.apiKey).toBe('AIza-own');
  });

  test('providers with no vault field (e.g. groq) do not hydrate from unrelated keys', () => {
    const r = resolveCloudLLM(baseSettings({
      useCustomLLM: true,
      geminiApiKey: 'AIza-vault',
      customLLM: { name: 't', provider: 'groq', model: 'm', apiUrl: 'https://x', apiKey: '', enabled: true },
    }));
    expect(r.active).toBe(false);
    expect(r.config?.apiKey).toBe('');
    expect(r.misconfiguration).toMatch(/groq/);
  });
});

describe('misconfiguration is reported, never silent', () => {
  test('cloud on + no key anywhere → inactive with an actionable reason', () => {
    const r = resolveCloudLLM(baseSettings({
      useCustomLLM: true,
      customLLM: { name: 't', provider: 'google-ai-studio', model: 'gemini-2.5-flash', apiUrl: 'https://x', apiKey: '', enabled: true },
    }));
    expect(r.intended).toBe(true);
    expect(r.active).toBe(false);
    expect(r.misconfiguration).toMatch(/no API key is saved/i);
    expect(r.misconfiguration).toMatch(/gemini-2.5-flash/);
  });

  test('cloud on + no model → inactive with a reason', () => {
    const r = resolveCloudLLM(baseSettings({
      useCustomLLM: true,
      geminiApiKey: 'AIza-x',
      customLLM: { name: 't', provider: 'google-ai-studio', model: '', apiUrl: 'https://x', apiKey: '', enabled: true },
    }));
    expect(r.active).toBe(false);
    expect(r.misconfiguration).toMatch(/no model is selected/i);
  });

  test('cloud on + no customLLM at all → inactive with a reason', () => {
    const r = resolveCloudLLM(baseSettings({ useCustomLLM: true }));
    expect(r.active).toBe(false);
    expect(r.config).toBeNull();
    expect(r.misconfiguration).toMatch(/no cloud provider is configured/i);
  });
});

describe('inactive by choice is not a misconfiguration', () => {
  test('cloud off → inactive, no complaint, config still hydrated for display', () => {
    const r = resolveCloudLLM(baseSettings({
      useCustomLLM: false,
      geminiApiKey: 'AIza-vault',
      customLLM: { name: 't', provider: 'google-ai-studio', model: 'm', apiUrl: 'https://x', apiKey: '', enabled: false },
    }));
    expect(r.intended).toBe(false);
    expect(r.active).toBe(false);
    expect(r.misconfiguration).toBeNull();
    expect(r.config?.apiKey).toBe('AIza-vault');
  });

  test('explicit useCustomLLM:false beats enabled:true (semantics changed 2026-08-09)', () => {
    // This test originally asserted the reverse ("enabled alone counts"),
    // mirroring the legacy gates this module replaced. That OR is what made a
    // stale enabled:true override the user's explicit local choice — seen
    // live three times as Qwen selected, opus answering. Explicit choice wins
    // now; `enabled` only decides when useCustomLLM was never written.
    const r = resolveCloudLLM(baseSettings({
      useCustomLLM: false,
      geminiApiKey: 'AIza-vault',
      customLLM: { name: 't', provider: 'google-ai-studio', model: 'm', apiUrl: 'https://x', apiKey: '', enabled: true },
    }));
    expect(r.intended).toBe(false);
    expect(r.active).toBe(false);
  });

  test('null settings → inactive, silent', () => {
    expect(resolveCloudLLM(null)).toEqual({
      intended: false, active: false, config: null, misconfiguration: null, localOverride: null,
    });
  });
});

describe('keyless providers', () => {
  test('claude-code needs no key — subscription auth via local CLI', () => {
    const r = resolveCloudLLM(baseSettings({
      useCustomLLM: true,
      customLLM: { name: 'sub', provider: 'claude-code', model: 'sonnet', apiUrl: '', apiKey: '', enabled: true },
    }));
    expect(r.active).toBe(true);
  });

  test('claude-code still needs a model', () => {
    const r = resolveCloudLLM(baseSettings({
      useCustomLLM: true,
      customLLM: { name: 'sub', provider: 'claude-code', model: '', apiUrl: '', apiKey: '', enabled: true },
    }));
    expect(r.active).toBe(false);
    expect(r.misconfiguration).toMatch(/no model/i);
  });

  test('custom endpoints need neither key nor model', () => {
    const r = resolveCloudLLM(baseSettings({
      useCustomLLM: true,
      customLLM: { name: 'local', provider: 'custom', model: '', apiUrl: 'http://localhost:8080/v1', apiKey: '', enabled: true },
    }));
    expect(r.active).toBe(true);
  });
});

describe('uncensored mode overrides cloud', () => {
  const cloudOn = {
    useCustomLLM: true,
    customLLM: { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-test', enabled: true } as any,
    anthropicApiKey: 'sk-test',
    openaiApiKey: '',
    geminiApiKey: '',
  };

  it('routes to local when uncensored mode is on, even with cloud fully configured', () => {
    // The observed bug: header said "Dolphin 7B / Uncensored", every reply was
    // badged sonnet. Uncensored mode was only read on the Ollama path, which a
    // configured cloud provider never reached.
    const r = resolveCloudLLM({ ...cloudOn, uncensoredMode: true } as any);
    expect(r.active).toBe(false);
    expect(r.localOverride).toMatch(/uncensored/i);
  });

  it('is not reported as a misconfiguration — nothing is broken', () => {
    const r = resolveCloudLLM({ ...cloudOn, uncensoredMode: true } as any);
    expect(r.misconfiguration).toBeNull();
  });

  it('still reports intent, so the UI can explain why cloud went unused', () => {
    const r = resolveCloudLLM({ ...cloudOn, uncensoredMode: true } as any);
    expect(r.intended).toBe(true);
  });

  it('leaves cloud active when uncensored mode is off', () => {
    const r = resolveCloudLLM({ ...cloudOn, uncensoredMode: false } as any);
    expect(r.active).toBe(true);
    expect(r.localOverride).toBeNull();
  });

  it('treats a missing uncensoredMode as off', () => {
    const r = resolveCloudLLM(cloudOn as any);
    expect(r.active).toBe(true);
  });

  it('wins over an unconfigured cloud provider instead of warning about it', () => {
    // Without the ordering, a user in uncensored mode with a half-set-up cloud
    // provider would get a "no API key" warning about a model they never asked
    // to use.
    const r = resolveCloudLLM({
      useCustomLLM: true,
      customLLM: { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: '', enabled: true } as any,
      anthropicApiKey: '',
      openaiApiKey: '',
      geminiApiKey: '',
      uncensoredMode: true,
    } as any);
    expect(r.misconfiguration).toBeNull();
    expect(r.localOverride).toMatch(/uncensored/i);
  });
});

describe('explicit useCustomLLM wins; enabled is only the legacy fallback', () => {
  // History: intent used to be (useCustomLLM || enabled). A leftover
  // enabled:true then overrode an explicit useCustomLLM:false — live symptom,
  // three times: "I have Qwen selected" while replies stayed badged opus.
  // The symmetric header write (#92) fixed NEW picks but couldn't repair
  // stale files, so the resolver rule itself changed: an explicit boolean
  // useCustomLLM is the user's routing choice, full stop. enabled only
  // decides for legacy settings where useCustomLLM was never written.

  it('explicit OFF beats a stale enabled:true — the three-times-live bug', () => {
    const r = resolveCloudLLM({
      useCustomLLM: false,
      customLLM: { provider: 'claude-code', model: 'opus', apiKey: '', enabled: true } as any,
      anthropicApiKey: '', openaiApiKey: '', geminiApiKey: '',
    } as any);
    expect(r.intended).toBe(false);
    expect(r.active).toBe(false);
  });

  it('explicit ON works even if enabled was never set', () => {
    const r = resolveCloudLLM({
      useCustomLLM: true,
      customLLM: { provider: 'claude-code', model: 'opus', apiKey: '', enabled: false } as any,
      anthropicApiKey: '', openaiApiKey: '', geminiApiKey: '',
    } as any);
    expect(r.intended).toBe(true);
    expect(r.active).toBe(true);
  });

  it('legacy settings without useCustomLLM fall back to enabled', () => {
    const r = resolveCloudLLM({
      customLLM: { provider: 'claude-code', model: 'opus', apiKey: '', enabled: true } as any,
      anthropicApiKey: '', openaiApiKey: '', geminiApiKey: '',
    } as any);
    expect(r.intended).toBe(true);
    expect(r.active).toBe(true);
  });

  it('local pick done right — both flags off — routes local', () => {
    const r = resolveCloudLLM({
      useCustomLLM: false,
      customLLM: { provider: 'claude-code', model: 'opus', apiKey: '', enabled: false } as any,
      anthropicApiKey: '', openaiApiKey: '', geminiApiKey: '',
    } as any);
    expect(r.intended).toBe(false);
    expect(r.active).toBe(false);
  });
});
