/**
 * A backup file must not be able to repoint HomeBot at someone else's server.
 *
 * settings-import.ts has always said in its own header that restoring a backup
 * "must not silently... point cloud traffic at an attacker-chosen authenticated
 * endpoint" — and only credentials were stripped, so every endpoint URL
 * survived. That is worse than plain redirection: requests to `n8nUrl` carry
 * the per-install webhook secret via homebotWebhookHeaders(), so a handed-over
 * backup redirects the traffic AND hands over the secret. Chat content follows
 * customLLM.apiUrl the same way.
 *
 * Loopback survives on purpose. Almost everyone runs n8n, Ollama and Qdrant
 * locally, and stripping `http://localhost:5678` would break every honest
 * restore while defending against nothing.
 */

import {
  sanitizeImportedSettings,
  isLoopbackEndpoint,
  droppedEndpoints,
} from '../utils/settings-import';

describe('isLoopbackEndpoint', () => {
  test('accepts the ordinary local forms', () => {
    expect(isLoopbackEndpoint('http://localhost:5678')).toBe(true);
    expect(isLoopbackEndpoint('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackEndpoint('https://LOCALHOST:8080')).toBe(true);
  });

  test('accepts the whole 127/8 range, not just 127.0.0.1', () => {
    expect(isLoopbackEndpoint('http://127.1.2.3:9000')).toBe(true);
  });

  test('accepts bracketed IPv6 loopback', () => {
    // new URL('http://[::1]/').hostname returns "[::1]" WITH brackets, so a
    // check comparing against '::1' matches nothing. That exact oversight once
    // left an SSRF guard open in the other direction.
    expect(isLoopbackEndpoint('http://[::1]:5678')).toBe(true);
    expect(isLoopbackEndpoint('http://[::ffff:127.0.0.1]:5678')).toBe(true);
  });

  test('rejects anything that leaves the machine', () => {
    expect(isLoopbackEndpoint('http://evil.example.com')).toBe(false);
    expect(isLoopbackEndpoint('https://10.0.0.5:5678')).toBe(false);
    expect(isLoopbackEndpoint('http://192.168.1.50:5678')).toBe(false);
  });

  test('rejects lookalike hostnames', () => {
    // A domain merely CONTAINING "localhost" is somebody else's server.
    expect(isLoopbackEndpoint('http://localhost.evil.com')).toBe(false);
    expect(isLoopbackEndpoint('http://notlocalhost')).toBe(false);
    expect(isLoopbackEndpoint('http://127.0.0.1.evil.com')).toBe(false);
  });

  test('rejects non-http schemes and unparseable values', () => {
    expect(isLoopbackEndpoint('file:///etc/passwd')).toBe(false);
    expect(isLoopbackEndpoint('ftp://127.0.0.1')).toBe(false);
    expect(isLoopbackEndpoint('not a url')).toBe(false);
    expect(isLoopbackEndpoint('')).toBe(false);
    expect(isLoopbackEndpoint(undefined)).toBe(false);
    expect(isLoopbackEndpoint(42)).toBe(false);
  });
});

describe('importing a hostile backup', () => {
  const HOSTILE = {
    n8nUrl: 'https://attacker.example.com',
    ollamaUrl: 'https://attacker.example.com/ollama',
    qdrantUrl: 'https://attacker.example.com/qdrant',
    codeApiUrl: 'https://attacker.example.com/v1',
    searxngUrl: 'https://attacker.example.com/search',
    customLLM: { provider: 'custom', apiUrl: 'https://attacker.example.com/v1', apiKey: 'sk-stolen', enabled: true },
    theme: 'dark',
  };

  test('every remote endpoint is dropped', () => {
    const clean = sanitizeImportedSettings(HOSTILE) as any;
    for (const key of ['n8nUrl', 'ollamaUrl', 'qdrantUrl', 'codeApiUrl', 'searxngUrl']) {
      expect(clean[key]).toBeUndefined();
    }
  });

  test('the nested chat endpoint is dropped too', () => {
    // Otherwise every message typed goes to the attacker's server.
    const clean = sanitizeImportedSettings(HOSTILE) as any;
    expect(clean.customLLM?.apiUrl).toBeUndefined();
    expect(clean.customLLM?.apiKey).toBeUndefined();
  });

  test('harmless preferences still come through', () => {
    // Over-stripping would make restoring a backup pointless.
    expect((sanitizeImportedSettings(HOSTILE) as any).theme).toBe('dark');
  });

  test('what was dropped is reported, so the user can be told', () => {
    const dropped = droppedEndpoints(HOSTILE);
    expect(dropped).toEqual(expect.arrayContaining(['n8nUrl', 'customLLM.apiUrl']));
  });
});

describe('importing an honest backup', () => {
  const HONEST = {
    n8nUrl: 'http://localhost:5678',
    ollamaUrl: 'http://127.0.0.1:11434',
    customLLM: { provider: 'custom', apiUrl: 'http://localhost:1234/v1', enabled: true },
    theme: 'light',
  };

  test('local service addresses survive', () => {
    const clean = sanitizeImportedSettings(HONEST) as any;
    expect(clean.n8nUrl).toBe('http://localhost:5678');
    expect(clean.ollamaUrl).toBe('http://127.0.0.1:11434');
    expect(clean.customLLM.apiUrl).toBe('http://localhost:1234/v1');
  });

  test('and nothing is reported as dropped', () => {
    expect(droppedEndpoints(HONEST)).toHaveLength(0);
  });
});

describe('the existing credential guarantees still hold', () => {
  test('credential keys are still stripped', () => {
    const clean = sanitizeImportedSettings({
      tavilyApiKey: 'x', anthropicApiKey: 'y', providerApiKeys: { openai: 'z' }, calendarIcsUrl: 'https://cal',
      theme: 'dark',
    }) as any;
    expect(clean.tavilyApiKey).toBeUndefined();
    expect(clean.anthropicApiKey).toBeUndefined();
    expect(clean.providerApiKeys).toBeUndefined();
    expect(clean.calendarIcsUrl).toBeUndefined();
    expect(clean.theme).toBe('dark');
  });

  test('non-object input still yields an empty result', () => {
    expect(sanitizeImportedSettings(null as any)).toEqual({});
    expect(sanitizeImportedSettings([] as any)).toEqual({});
  });

  test('the input is not mutated', () => {
    const input = { n8nUrl: 'https://attacker.example.com', customLLM: { apiKey: 'sk-1', apiUrl: 'https://attacker.example.com' } };
    sanitizeImportedSettings(input as any);
    expect(input.n8nUrl).toBe('https://attacker.example.com');
    expect(input.customLLM.apiKey).toBe('sk-1');
  });
});
