/**
 * deepseek-model-discovery.test.ts
 *
 * The DeepSeek picker used to show a hard-coded list of retired ids
 * (deepseek-chat / deepseek-reasoner). Discovery now asks DeepSeek's /models
 * endpoint with the saved key and returns a truthful source ('live' / 'cached'
 * / 'fallback'); auth failures and Online-disabled surface as errors, never as
 * a normal-looking fallback.
 */

jest.mock('axios');

import axios from 'axios';
import { apiKeyForProvider } from '../../shared/cloud-llm';
import {
  discoverDeepseekModels,
  resolveDeepseekModels,
  fetchAvailableCustomModels,
} from '../custom-llm-client';

const modelsPayload = () => ({
  object: 'list',
  data: [
    { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
    { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
  ],
});

beforeEach(() => jest.clearAllMocks());

describe('discoverDeepseekModels', () => {
  test('calls the documented endpoint with a Bearer key', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: modelsPayload() });
    await discoverDeepseekModels('sk-call-1');
    const [url, opts] = (axios.get as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/models');
    expect(opts.headers.Authorization).toBe('Bearer sk-call-1');
  });

  test('preserves exact ids and does not invent display names', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: modelsPayload() });
    const models = await discoverDeepseekModels('sk-call-2');
    expect(models.map(m => m.id)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
    expect(models[0].name).toBe('deepseek-v4-flash'); // the id, not a marketing name
    expect(models[0].description).toBe('deepseek');
  });

  test('deduplicates ids and rejects malformed entries', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: {
        object: 'list',
        data: [
          { id: 'deepseek-v4-flash' },
          { id: 'deepseek-v4-flash' },
          { id: '   ' },
          { id: 123 },
          {},
          { id: 'deepseek-v4-pro', owned_by: 'deepseek' },
        ],
      },
    });
    const models = await discoverDeepseekModels('sk-call-3');
    expect(models.map(m => m.id)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  test('a future model id appears without any catalog change', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: { object: 'list', data: [{ id: 'deepseek-v5-whatever', owned_by: 'deepseek' }] },
    });
    const models = await discoverDeepseekModels('sk-call-4');
    expect(models.map(m => m.id)).toEqual(['deepseek-v5-whatever']);
  });

  test('throws AUTH_FAILED on 401/403', async () => {
    (axios.get as jest.Mock).mockRejectedValue({ response: { status: 401 } });
    await expect(discoverDeepseekModels('sk-bad')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  test('rethrows non-auth failures as plain errors', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('socket hang up'));
    await expect(discoverDeepseekModels('sk-call-5')).rejects.toThrow('socket hang up');
  });
});

describe('resolveDeepseekModels', () => {
  test('no key: no network call, returns fallback', async () => {
    const res = await resolveDeepseekModels(undefined);
    expect(res.source).toBe('fallback');
    expect(res.models.length).toBeGreaterThan(0);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('onlineAccess gate blocks before any network I/O', async () => {
    const gate = jest.fn(() => { throw new Error('needs Online'); });
    await expect(resolveDeepseekModels('sk-gate', { onlineAccess: gate })).rejects.toThrow('needs Online');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('live discovery is cached and returned as cached on repeat', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: modelsPayload() });
    const first = await resolveDeepseekModels('sk-cache');
    expect(first.source).toBe('live');
    const second = await resolveDeepseekModels('sk-cache');
    expect(second.source).toBe('cached');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('forceRefresh bypasses the cache', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: modelsPayload() });
    await resolveDeepseekModels('sk-refresh');
    await resolveDeepseekModels('sk-refresh', { forceRefresh: true });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('a different key does not reuse another credential cached catalog', async () => {
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({ data: { object: 'list', data: [{ id: 'deepseek-v4-flash', owned_by: 'deepseek' }] } })
      .mockResolvedValueOnce({ data: { object: 'list', data: [{ id: 'deepseek-v4-pro', owned_by: 'deepseek' }] } });
    const a = await resolveDeepseekModels('sk-key-a');
    const b = await resolveDeepseekModels('sk-key-b');
    expect(a.source).toBe('live');
    expect(b.source).toBe('live'); // a second key is a fresh discovery, not 'cached'
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('transient failure falls back and reports source fallback', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('offline'));
    const res = await resolveDeepseekModels('sk-transient');
    expect(res.source).toBe('fallback');
    expect(res.models.some(m => m.id === 'deepseek-v4-flash')).toBe(true);
  });

  test('auth failure is re-thrown, not concealed behind the fallback', async () => {
    (axios.get as jest.Mock).mockRejectedValue({ response: { status: 401 } });
    await expect(resolveDeepseekModels('sk-bad-auth')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  test('does not leak the key in the error message', async () => {
    (axios.get as jest.Mock).mockRejectedValue({ response: { status: 401 } });
    try {
      await resolveDeepseekModels('sk-SUPER-SECRET');
    } catch (err: any) {
      expect(err.message).not.toContain('SUPER-SECRET');
    }
  });
});

describe('fetchAvailableCustomModels (deepseek branch)', () => {
  test('no key still returns the static fallback without network', async () => {
    const models = await fetchAvailableCustomModels({ apiUrl: 'https://api.deepseek.com/v1', provider: 'deepseek' as any });
    expect(models.length).toBeGreaterThan(0);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('saved-key resolution through the list-models handler path', () => {
  // Reproduces the homebot:list-custom-llm-models deepseek branch verbatim
  // (see list-models-ipc.test.ts for the same convention), using the real
  // apiKeyForProvider and resolveDeepseekModels so the vault -> discovery
  // routing is exercised end to end without booting all of ipc-handlers.
  test('resolves the vault key and discovers with it', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: modelsPayload() });

    const settings: any = { providerApiKeys: { deepseek: 'sk-vault-key' } };
    const payload: any = { apiUrl: 'https://api.deepseek.com/v1', provider: 'deepseek' };

    let resolvedPayload = payload;
    if (!(resolvedPayload.apiKey || '').trim() && resolvedPayload.provider) {
      resolvedPayload = { ...resolvedPayload, apiKey: apiKeyForProvider(settings, resolvedPayload.provider) || '' };
    }
    const gate = jest.fn(); // assertProviderOnlineAccess('DeepSeek')
    const result = await resolveDeepseekModels(resolvedPayload.apiKey, {
      onlineAccess: gate,
      forceRefresh: !!(payload || {}).refresh,
    });

    expect(result.source).toBe('live');
    expect(gate).toHaveBeenCalledTimes(1);
    const [url, opts] = (axios.get as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/models');
    expect(opts.headers.Authorization).toBe('Bearer sk-vault-key');
    expect(result.models.map(m => m.id)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  test('deepseek key is read from providerApiKeys, not customLLM.apiKey', () => {
    expect(apiKeyForProvider({ providerApiKeys: { deepseek: 'sk-from-map' } } as any, 'deepseek')).toBe('sk-from-map');
    expect(apiKeyForProvider({ customLLM: { apiKey: 'sk-legacy' } } as any, 'deepseek')).toBe('');
  });
});


