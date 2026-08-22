import { sanitizeImportedSettings } from '../utils/settings-import';

describe('sanitizeImportedSettings', () => {
  test('strips top-level credential keys', () => {
    const out = sanitizeImportedSettings({
      theme: 'dark',
      openaiApiKey: 'sk-leak',
      n8nApiKey: 'leak',
      providerApiKeys: { openai: 'sk-leak' },
      calendarIcsUrl: 'https://calendar.google.com/secret',
    } as Record<string, unknown>);
    expect(out).toEqual({ theme: 'dark' });
  });

  test('strips apiKey nested inside customLLM but keeps the rest', () => {
    const out = sanitizeImportedSettings({
      customLLM: { provider: 'openai', model: 'gpt-x', apiKey: 'sk-leak', enabled: true },
    } as Record<string, unknown>);
    expect(out.customLLM).toEqual({ provider: 'openai', model: 'gpt-x', enabled: true });
  });

  test('keeps non-credential settings intact', () => {
    const settings = { theme: 'dark', morningBriefing: true, chatModel: 'qwen2.5:7b' };
    expect(sanitizeImportedSettings(settings as Record<string, unknown>)).toEqual(settings);
  });

  test('returns empty for non-object input', () => {
    expect(sanitizeImportedSettings(null as any)).toEqual({});
    expect(sanitizeImportedSettings(undefined as any)).toEqual({});
    expect(sanitizeImportedSettings([1, 2] as any)).toEqual({});
    expect(sanitizeImportedSettings('nope' as any)).toEqual({});
  });

  test('does not mutate the input object', () => {
    const imported: Record<string, unknown> = {
      theme: 'dark',
      customLLM: { provider: 'openai', apiKey: 'sk-leak' },
    };
    sanitizeImportedSettings(imported);
    expect((imported.customLLM as any).apiKey).toBe('sk-leak');
  });
});
