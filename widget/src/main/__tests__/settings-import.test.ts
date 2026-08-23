import {
  sanitizeImportedSettings,
  analyzeImportedEndpoints,
  stripImportedSettings,
} from '../utils/settings-import';

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

describe('analyzeImportedEndpoints', () => {
  const current = {
    n8nUrl: 'http://localhost:5678',
    ollamaUrl: 'http://127.0.0.1:11434',
    searxngUrl: 'http://localhost:8888',
  };

  test('reports endpoints the import would move, with from/to', () => {
    const changes = analyzeImportedEndpoints(
      { n8nUrl: 'http://attacker.example:5678', theme: 'dark' },
      current
    );
    expect(changes).toEqual([
      { key: 'n8nUrl', from: 'http://localhost:5678', to: 'http://attacker.example:5678' },
    ]);
  });

  test('reports a moved customLLM.baseUrl', () => {
    const changes = analyzeImportedEndpoints(
      { customLLM: { provider: 'openai', baseUrl: 'https://evil.example/v1' } },
      { customLLM: { provider: 'openai', baseUrl: 'https://api.openai.com/v1' } }
    );
    expect(changes).toEqual([
      { key: 'customLLM.baseUrl', from: 'https://api.openai.com/v1', to: 'https://evil.example/v1' },
    ]);
  });

  test('ignores endpoints that are unchanged or absent from the import', () => {
    expect(analyzeImportedEndpoints({ n8nUrl: current.n8nUrl }, current)).toEqual([]);
    expect(analyzeImportedEndpoints({ theme: 'dark' }, current)).toEqual([]);
    // Absent from current counts as a move when the import sets one
    expect(analyzeImportedEndpoints({ searxngUrl: undefined as any }, current)).toEqual([]);
  });

  test('trailing slashes do not count as a move', () => {
    expect(analyzeImportedEndpoints({ ollamaUrl: 'http://127.0.0.1:11434/' }, current)).toEqual([]);
  });

  test('empty-string and non-string values are ignored', () => {
    expect(analyzeImportedEndpoints({ n8nUrl: '', codeApiUrl: 42 }, current)).toEqual([]);
  });

  test('handles non-object inputs on either side', () => {
    expect(analyzeImportedEndpoints(null, current)).toEqual([]);
    expect(analyzeImportedEndpoints([1], current)).toEqual([]);
    expect(analyzeImportedEndpoints({ n8nUrl: 'http://x' }, null)).toEqual([
      { key: 'n8nUrl', from: undefined, to: 'http://x' },
    ]);
  });
});

describe('stripImportedSettings', () => {
  test('removes credentials AND endpoints, keeps everything else', () => {
    const { settings, strippedEndpoints } = stripImportedSettings({
      theme: 'dark',
      openaiApiKey: 'sk-leak',
      n8nApiKey: 'leak',
      n8nUrl: 'http://attacker.example:5678',
      searxngUrl: 'http://127.0.0.1:8888',
      codeApiUrl: 'https://api.openai.com',
      morningBriefing: true,
    } as Record<string, unknown>);
    expect(settings).toEqual({ theme: 'dark', morningBriefing: true });
    expect(new Set(strippedEndpoints)).toEqual(
      new Set(['n8nUrl', 'searxngUrl', 'codeApiUrl'])
    );
  });

  test('strips customLLM.apiKey always; strips baseUrl too and says so', () => {
    const { settings, strippedEndpoints } = stripImportedSettings({
      customLLM: { provider: 'openai', model: 'gpt-x', apiKey: 'sk-leak', baseUrl: 'https://evil.example' },
    } as Record<string, unknown>);
    expect(settings.customLLM).toEqual({ provider: 'openai', model: 'gpt-x' });
    expect(strippedEndpoints).toContain('customLLM.baseUrl');
  });

  test('a customLLM without baseUrl reports nothing stripped for it', () => {
    const { settings, strippedEndpoints } = stripImportedSettings({
      customLLM: { provider: 'openai', enabled: true },
    } as Record<string, unknown>);
    expect(settings.customLLM).toEqual({ provider: 'openai', enabled: true });
    expect(strippedEndpoints).toEqual([]);
  });

  test('non-object input yields empty settings and no strippings', () => {
    const r = stripImportedSettings(null as any);
    expect(r.settings).toEqual({});
    expect(r.strippedEndpoints).toEqual([]);
  });

  test('does not mutate the input object', () => {
    const imported = {
      n8nUrl: 'http://attacker.example:5678',
      customLLM: { provider: 'openai', baseUrl: 'https://evil.example' },
    };
    stripImportedSettings(imported as Record<string, unknown>);
    expect(imported.n8nUrl).toBe('http://attacker.example:5678');
    expect((imported.customLLM as any).baseUrl).toBe('https://evil.example');
  });
});
