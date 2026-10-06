/**
 * provider-urls.test.ts
 *
 * `resetCliOnlyFields` guards the switch onto a subscription CLI provider. The
 * `apiUrl` field changes meaning across that boundary — for an HTTP provider it
 * is an endpoint, for `codex` / `claude-code` it is the CLI binary's path — so a
 * URL carried over from the previous provider gets spawned as a program.
 *
 * Observed live: switching DeepSeek → Codex kept `https://api.deepseek.com/v1`,
 * and the CLI launch died with "Codex CLI not found (https://api.deepseek.com/v1)"
 * while the header showed the Codex model.
 */

import { resetCliOnlyFields, isCliProvider, defaultApiUrlFor, PROVIDER_API_URLS } from '../provider-urls';

describe('isCliProvider', () => {
  test('the two subscription CLIs are the only CLI providers', () => {
    expect(isCliProvider('codex')).toBe(true);
    expect(isCliProvider('claude-code')).toBe(true);
  });

  test('HTTP providers are not CLIs', () => {
    for (const p of ['openai', 'anthropic', 'deepseek', 'openrouter', 'google-ai-studio', 'custom']) {
      expect(isCliProvider(p)).toBe(false);
    }
    expect(isCliProvider(undefined)).toBe(false);
    expect(isCliProvider(null)).toBe(false);
    expect(isCliProvider('')).toBe(false);
  });
});

describe('resetCliOnlyFields', () => {
  test('clears a leftover HTTP apiUrl and apiKey when switching to codex', () => {
    const cfg = {
      name: 'Custom LLM',
      apiUrl: 'https://api.deepseek.com/v1',
      apiKey: 'enc:v1:deadbeef',
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      enabled: true,
    };
    const out = resetCliOnlyFields({ ...cfg, provider: 'codex', model: 'default' }, 'codex');
    expect(out.apiUrl).toBe('');
    expect(out.apiKey).toBe('');
    // Untouched fields survive.
    expect(out.provider).toBe('codex');
    expect(out.model).toBe('default');
    expect(out.enabled).toBe(true);
  });

  test('does the same for claude-code', () => {
    const out = resetCliOnlyFields(
      { apiUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', provider: 'openai' },
      'claude-code',
    );
    expect(out.apiUrl).toBe('');
    expect(out.apiKey).toBe('');
  });

  test('leaves an HTTP provider\'s url and key intact', () => {
    // A metered provider needs both; clearing them would break a valid config.
    const out = resetCliOnlyFields(
      { apiUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', provider: 'deepseek' },
      'deepseek',
    );
    expect(out.apiUrl).toBe('https://api.deepseek.com/v1');
    expect(out.apiKey).toBe('sk-x');
  });

  test('is a no-op when the config already has empty CLI fields', () => {
    const out = resetCliOnlyFields({ apiUrl: '', apiKey: '', provider: 'codex' }, 'codex');
    expect(out).toEqual({ apiUrl: '', apiKey: '', provider: 'codex' });
  });
});

describe('PROVIDER_API_URLS', () => {
  test('the subscription CLIs deliberately have no URL', () => {
    // An entry here would be used as a fallback endpoint and send a CLI
    // provider's traffic to a web address. Tests assert they stay out.
    expect(PROVIDER_API_URLS['codex']).toBeUndefined();
    expect(PROVIDER_API_URLS['claude-code']).toBeUndefined();
  });

  test('every listed provider resolves its own default url', () => {
    expect(defaultApiUrlFor('deepseek')).toBe('https://api.deepseek.com/v1');
    expect(defaultApiUrlFor('codex')).toBe('');
    expect(defaultApiUrlFor(undefined)).toBe('');
  });
});
