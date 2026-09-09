/**
 * discovery-boundary.test.ts
 *
 * The model-discovery credential boundary: a saved provider key may only reach
 * that provider's trusted canonical endpoint, and dynamic discovery enforces
 * Online consent. These exercise the real resolveDiscoveryPayload /
 * resolveGeminiModels / resolveDeepseekModels functions.
 */

jest.mock('axios');

import axios from 'axios';
import { resolveDiscoveryPayload } from '../discovery-payload';
import { resolveGeminiModels, resolveDeepseekModels } from '../custom-llm-client';

beforeEach(() => jest.clearAllMocks());

describe('resolveDiscoveryPayload — credential boundary', () => {
  test('pins a known provider to its canonical URL and attaches the saved key', () => {
    const settings: any = { providerApiKeys: { deepseek: 'sk-vault' } };
    const r = resolveDiscoveryPayload(
      { provider: 'deepseek', apiUrl: 'https://api.deepseek.com/v1' },
      settings,
    );
    expect(r.canonical).toBe(true);
    expect(r.apiUrl).toBe('https://api.deepseek.com/v1');
    expect(r.apiKey).toBe('sk-vault');
  });

  test('ignores a caller-supplied URL for a known provider', () => {
    const settings: any = { providerApiKeys: { openai: 'sk-openai-vault' } };
    const r = resolveDiscoveryPayload(
      { provider: 'openai', apiUrl: 'https://evil.example.com/v1' },
      settings,
    );
    expect(r.apiUrl).toBe('https://api.openai.com/v1'); // canonical, not evil
    expect(r.apiKey).toBe('sk-openai-vault');
  });

  test('never attaches a saved provider key to a custom endpoint', () => {
    const settings: any = { providerApiKeys: { openai: 'sk-openai-vault' } };
    const r = resolveDiscoveryPayload(
      { provider: 'custom', apiUrl: 'http://localhost:11434', apiKey: 'local-key' },
      settings,
    );
    expect(r.canonical).toBe(false);
    expect(r.apiUrl).toBe('http://localhost:11434');
    expect(r.apiKey).toBe('local-key'); // only the caller's own key
  });

  test('strips a stale saved key when resolving a custom endpoint without one', () => {
    const settings: any = { providerApiKeys: { openai: 'sk-openai-vault' } };
    const r = resolveDiscoveryPayload({ provider: 'custom', apiUrl: 'http://localhost:11434' }, settings);
    expect(r.apiKey).toBe('');
  });

  test('legacy Google key fallback via geminiApiKey', () => {
    const r = resolveDiscoveryPayload(
      { provider: 'google-ai-studio', apiUrl: '' },
      { geminiApiKey: 'AIza-legacy' } as any,
    );
    expect(r.apiUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(r.apiKey).toBe('AIza-legacy');
  });

  test('an explicit caller key wins over the saved vault key', () => {
    const settings: any = { providerApiKeys: { deepseek: 'sk-vault' } };
    const r = resolveDiscoveryPayload(
      { provider: 'deepseek', apiUrl: '', apiKey: 'sk-explicit' },
      settings,
    );
    expect(r.apiKey).toBe('sk-explicit');
  });
});

describe('dynamic discovery — Online consent', () => {
  test('gemini discovery makes zero requests when the Online gate throws', async () => {
    const gate = jest.fn(() => { throw new Error('needs Online'); });
    await expect(
      resolveGeminiModels('google-ai-studio', 'AIza-1', { onlineAccess: gate }),
    ).rejects.toThrow('needs Online');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('deepseek discovery makes zero requests when the Online gate throws (direct call)', async () => {
    const gate = jest.fn(() => { throw new Error('needs Online'); });
    await expect(resolveDeepseekModels('sk-1', { onlineAccess: gate })).rejects.toThrow('needs Online');
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('dynamic discovery — bounded cache', () => {
  test('evicts the oldest entry past the bound', async () => {
    // MAX_DISCOVERY_CACHE_ENTRIES is 10; fill 11 distinct keys.
    (axios.get as jest.Mock).mockImplementation(async () => ({
      data: { object: 'list', data: [{ id: 'deepseek-v4-flash', owned_by: 'deepseek' }] },
    }));

    for (let i = 0; i < 11; i++) {
      await resolveDeepseekModels(`sk-evict-${i}`);
    }
    // The first key should have been evicted, so re-fetching it hits the network again.
    (axios.get as jest.Mock).mockClear();
    await resolveDeepseekModels('sk-evict-0');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
