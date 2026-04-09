/**
 * custom-llm-client.test.ts
 * Tests for src/main/custom-llm-client.ts
 */

// Prevent axios from making real HTTP calls
jest.mock('axios');

import { EventEmitter } from 'events';
import axios from 'axios';

import {
  getModelMetadata,
  validateCustomLLMConfig,
  autoConfigureCustomLLM,
  fetchAvailableCustomModels,
  streamFromCustomLLM,
} from '../custom-llm-client';

describe('getModelMetadata', () => {
  test('returns exact match for gpt-4', () => {
    const meta = getModelMetadata('gpt-4');
    expect(meta.contextWindow).toBe(8192);
    expect(meta.maxTokens).toBe(4096);
    expect(meta.supportsTools).toBe(true);
    expect(meta.supportsVision).toBe(false);
    expect(meta.supportsStreaming).toBe(true);
  });

  test('returns exact match for gpt-4o with vision', () => {
    const meta = getModelMetadata('gpt-4o');
    expect(meta.contextWindow).toBe(128000);
    expect(meta.supportsVision).toBe(true);
    expect(meta.supportsTools).toBe(true);
  });

  test('returns partial match for versioned claude model', () => {
    // 'claude-3-5-sonnet-20241022' contains 'claude-3-5-sonnet'
    const meta = getModelMetadata('claude-3-5-sonnet-20241022');
    expect(meta.contextWindow).toBe(200000);
    expect(meta.maxTokens).toBe(8192);
    expect(meta.supportsVision).toBe(true);
  });

  test('returns exact match for gpt-4-turbo', () => {
    // exact match — 'gpt-4-turbo' is its own entry with 128k context and vision
    const meta = getModelMetadata('gpt-4-turbo');
    expect(meta.contextWindow).toBe(128000);
    expect(meta.supportsVision).toBe(true);
  });

  test('returns defaults for completely unknown model', () => {
    const meta = getModelMetadata('my-custom-local-model');
    expect(meta.contextWindow).toBe(8192);
    expect(meta.maxTokens).toBe(4096);
    expect(meta.supportsTools).toBe(false);
    expect(meta.supportsVision).toBe(false);
    expect(meta.supportsStreaming).toBe(true);
  });

  test('returns defaults for empty string', () => {
    const meta = getModelMetadata('');
    expect(meta.contextWindow).toBe(8192);
    expect(meta.supportsTools).toBe(false);
  });

  test('supportsStreaming defaults to true even for unknown models', () => {
    const meta = getModelMetadata('totally-unknown-xyz');
    expect(meta.supportsStreaming).toBe(true);
  });

  test('gpt-3.5-turbo returns correct context window', () => {
    const meta = getModelMetadata('gpt-3.5-turbo');
    expect(meta.contextWindow).toBe(16385);
    expect(meta.supportsVision).toBe(false);
  });

  test('does not mutate the defaults object between calls', () => {
    const a = getModelMetadata('unknown-a');
    const b = getModelMetadata('unknown-b');
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // separate objects
  });

  test('claude-opus-4 returns 200k context and 16k maxTokens', () => {
    const meta = getModelMetadata('claude-opus-4-20250514');
    expect(meta.contextWindow).toBe(200000);
    expect(meta.maxTokens).toBe(16384);
    expect(meta.supportsTools).toBe(true);
    expect(meta.supportsVision).toBe(true);
  });

  test('claude-sonnet-4 returns 200k context and 16k maxTokens', () => {
    const meta = getModelMetadata('claude-sonnet-4-20250514');
    expect(meta.contextWindow).toBe(200000);
    expect(meta.maxTokens).toBe(16384);
    expect(meta.supportsTools).toBe(true);
  });

  test('claude-3-5-haiku returns correct metadata', () => {
    const meta = getModelMetadata('claude-3-5-haiku-20241022');
    expect(meta.contextWindow).toBe(200000);
    expect(meta.maxTokens).toBe(8192);
    expect(meta.supportsTools).toBe(true);
  });

  test('gpt-4o-mini returns correct metadata', () => {
    const meta = getModelMetadata('gpt-4o-mini');
    expect(meta.contextWindow).toBe(128000);
    expect(meta.supportsTools).toBe(true);
    expect(meta.supportsVision).toBe(true);
  });
});

// ─── validateCustomLLMConfig ─────────────────────────────────────────────────

describe('validateCustomLLMConfig', () => {
  test('invalid when config is undefined', () => {
    const r = validateCustomLLMConfig(undefined);
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  test('invalid when apiUrl is missing', () => {
    const r = validateCustomLLMConfig({ apiKey: 'k', model: 'gpt-4', provider: 'openai' } as any);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/url/i);
  });

  test('invalid when apiKey is missing for openai provider', () => {
    const r = validateCustomLLMConfig({ apiUrl: 'https://api.openai.com/v1', model: 'gpt-4', provider: 'openai' } as any);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/key/i);
  });

  test('invalid when model is missing for non-custom provider', () => {
    const r = validateCustomLLMConfig({ apiUrl: 'https://api.openai.com/v1', apiKey: 'k', provider: 'openai' } as any);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/model/i);
  });

  test('valid when custom provider with no apiKey and no model', () => {
    const r = validateCustomLLMConfig({ apiUrl: 'http://localhost:11434', provider: 'custom' } as any);
    expect(r.valid).toBe(true);
  });

  test('valid for well-formed openai config', () => {
    const r = validateCustomLLMConfig({ apiUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4', provider: 'openai', name: 'test', enabled: true });
    expect(r.valid).toBe(true);
    expect(r.error).toBeUndefined();
  });

  test('valid for well-formed anthropic config', () => {
    const r = validateCustomLLMConfig({ apiUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant', model: 'claude-3-5-sonnet-20241022', provider: 'anthropic', name: 'test', enabled: true });
    expect(r.valid).toBe(true);
  });
});

// ─── autoConfigureCustomLLM ───────────────────────────────────────────────────

describe('autoConfigureCustomLLM', () => {
  test('auto-detects openai provider from gpt-4o model name', () => {
    const result = autoConfigureCustomLLM({ apiUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-4o' } as any);
    expect(result.provider).toBe('openai');
  });

  test('auto-detects anthropic provider from claude model name', () => {
    const result = autoConfigureCustomLLM({ apiUrl: 'https://api.anthropic.com/v1', apiKey: 'k', model: 'claude-3-5-sonnet-20241022' } as any);
    expect(result.provider).toBe('anthropic');
  });

  test('does not overwrite existing provider', () => {
    const result = autoConfigureCustomLLM({ apiUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'gpt-4o', provider: 'openrouter', name: 'test', enabled: true });
    expect(result.provider).toBe('openrouter');
  });

  test('adds metadata for known model when metadata not present', () => {
    const result = autoConfigureCustomLLM({ apiUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-4o', provider: 'openai', name: 'test', enabled: true });
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.contextWindow).toBe(128000);
  });

  test('preserves existing metadata if already defined', () => {
    const existing = { contextWindow: 999, maxTokens: 1, supportsTools: false, supportsVision: false, supportsStreaming: false };
    const result = autoConfigureCustomLLM({ apiUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-4o', provider: 'openai', name: 'test', enabled: true, metadata: existing });
    expect(result.metadata).toBe(existing);
  });
});

// ─── fetchAvailableCustomModels – static branches (no http) ─────────────────

describe('fetchAvailableCustomModels', () => {
  test('throws when apiUrl is missing', async () => {
    await expect(fetchAvailableCustomModels({})).rejects.toThrow(/url/i);
  });

  test('returns anthropic model list for anthropic provider (no http call)', async () => {
    const models = await fetchAvailableCustomModels({ apiUrl: 'https://api.anthropic.com/v1', provider: 'anthropic' });
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(m => m.provider === 'anthropic')).toBe(true);
    expect(models.some(m => m.id.includes('claude'))).toBe(true);
  });

  test('returns openai model list for openai provider (no http call)', async () => {
    const models = await fetchAvailableCustomModels({ apiUrl: 'https://api.openai.com/v1', provider: 'openai' });
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(m => m.provider === 'openai')).toBe(true);
    expect(models.some(m => m.id === 'gpt-4o')).toBe(true);
  });

  test('throws for openrouter provider without apiKey', async () => {
    await expect(
      fetchAvailableCustomModels({ apiUrl: 'https://openrouter.ai/api/v1', provider: 'openrouter' })
    ).rejects.toThrow();
  });

  test('returns groq model list (no http call)', async () => {
    const models = await fetchAvailableCustomModels({ apiUrl: 'https://api.groq.com/openai/v1', provider: 'groq' as any });
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(m => m.provider === 'groq')).toBe(true);
    expect(models.some(m => m.id.includes('llama'))).toBe(true);
  });

  test('returns deepseek model list (no http call)', async () => {
    const models = await fetchAvailableCustomModels({ apiUrl: 'https://api.deepseek.com/v1', provider: 'deepseek' as any });
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(m => m.provider === 'deepseek')).toBe(true);
    expect(models.some(m => m.id === 'deepseek-chat')).toBe(true);
    expect(models.some(m => m.id === 'deepseek-reasoner')).toBe(true);
  });

  test('returns google-ai-studio model list (no http call)', async () => {
    const models = await fetchAvailableCustomModels({ apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', provider: 'google-ai-studio' as any });
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(m => m.provider === 'google-ai-studio')).toBe(true);
    expect(models.some(m => m.id.includes('gemini'))).toBe(true);
  });

  test('groq models have contextWindow defined', async () => {
    const models = await fetchAvailableCustomModels({ apiUrl: 'https://api.groq.com/openai/v1', provider: 'groq' as any });
    expect(models.every(m => typeof m.contextWindow === 'number' && m.contextWindow > 0)).toBe(true);
  });
});

// ─── fetchAvailableCustomModels – HTTP branches ───────────────────────────────

describe('fetchAvailableCustomModels – HTTP call branches', () => {
  beforeEach(() => jest.clearAllMocks());

  test('custom provider with no apiKey calls axios.get successfully (direct array)', async () => {
    const data = [
      { id: 'my-model', name: 'My Model', description: 'local', owned_by: 'me' },
    ];
    (axios.get as jest.Mock).mockResolvedValue({ data });

    const models = await fetchAvailableCustomModels({ apiUrl: 'http://localhost:11434', provider: 'custom' });
    expect(models.length).toBe(1);
    expect(models[0].id).toBe('my-model');
    expect(models[0].provider).toBe('custom');
  });

  test('payload wrapped in .data array is normalised', async () => {
    const data = { data: [{ id: 'wrapped-model', name: 'Wrapped' }] };
    (axios.get as jest.Mock).mockResolvedValue({ data });

    const models = await fetchAvailableCustomModels({ apiUrl: 'http://localhost:8080', provider: 'custom' });
    expect(models[0].id).toBe('wrapped-model');
  });

  test('payload with .models array is normalised', async () => {
    const data = { models: [{ id: 'models-key', name: 'Models Key Model' }] };
    (axios.get as jest.Mock).mockResolvedValue({ data });

    const models = await fetchAvailableCustomModels({ apiUrl: 'http://localhost:8080', provider: 'custom' });
    expect(models[0].id).toBe('models-key');
  });

  test('empty models list throws error', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: [] });

    await expect(
      fetchAvailableCustomModels({ apiUrl: 'http://localhost:1234', provider: 'custom' })
    ).rejects.toThrow();
  });

  test('axios error is reformatted with detail message', async () => {
    const axiosErr: any = new Error('404');
    axiosErr.isAxiosError = true;
    axiosErr.response = { status: 404, statusText: 'Not Found', data: { error: { message: 'endpoint missing' } } };
    (axios.get as jest.Mock).mockRejectedValue(axiosErr);
    (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

    await expect(
      fetchAvailableCustomModels({ apiUrl: 'http://localhost:9999', provider: 'custom' })
    ).rejects.toThrow('endpoint missing');
  });

  test('non-axios error is re-thrown as-is', async () => {
    const nativeErr = new TypeError('socket hang up');
    (axios.get as jest.Mock).mockRejectedValue(nativeErr);
    (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);

    await expect(
      fetchAvailableCustomModels({ apiUrl: 'http://localhost:9999', provider: 'custom' })
    ).rejects.toThrow('socket hang up');
  });

  test('openrouter with apiKey calls axios.get', async () => {
    const data = [{ id: 'openrouter/model', name: 'OpenRouter Model', description: '', owned_by: 'openrouter' }];
    (axios.get as jest.Mock).mockResolvedValue({ data });

    const models = await fetchAvailableCustomModels({
      apiUrl: 'https://openrouter.ai/api/v1',
      provider: 'openrouter',
      apiKey: 'sk-or-test',
    });
    expect(models[0].id).toBe('openrouter/model');
  });

  test('deduplicates models with the same id', async () => {
    const data = [
      { id: 'dup-model', name: 'Dup 1' },
      { id: 'dup-model', name: 'Dup 2' },
      { id: 'unique-model', name: 'Unique' },
    ];
    (axios.get as jest.Mock).mockResolvedValue({ data });

    const models = await fetchAvailableCustomModels({ apiUrl: 'http://localhost:11434', provider: 'custom' });
    expect(models.filter(m => m.id === 'dup-model').length).toBe(1);
    expect(models.length).toBe(2);
  });

  test('items missing id are filtered out', async () => {
    const data = [
      { display_name: 'No ID Model' }, // no id field
      { id: 'valid-id', name: 'Valid' },
    ];
    (axios.get as jest.Mock).mockResolvedValue({ data });

    const models = await fetchAvailableCustomModels({ apiUrl: 'http://localhost:11434', provider: 'custom' });
    expect(models.every(m => m.id !== undefined)).toBe(true);
    expect(models.some(m => m.id === 'valid-id')).toBe(true);
  });
});

// ─── streamFromCustomLLM ─────────────────────────────────────────────────────

describe('streamFromCustomLLM', () => {
  beforeEach(() => jest.clearAllMocks());

  function makeFakeStream() {
    const emitter = new EventEmitter();
    return emitter;
  }

  test('calls onError and returns cancel fn when config is invalid', async () => {
    const onError = jest.fn();
    const onEnd = jest.fn();
    const onChunk = jest.fn();

    const result = await streamFromCustomLLM(
      'hello',
      [],
      { apiUrl: '', provider: 'openai', model: 'gpt-4', apiKey: '' } as any,
      'system prompt',
      onChunk,
      onEnd,
      onError
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(typeof result.cancel).toBe('function');
  });

  test('routes valid openai config to streamOpenAI path (axios.post called)', async () => {
    const fakeStream = makeFakeStream();
    (axios.post as jest.Mock).mockResolvedValue({ data: fakeStream });

    const onEnd = jest.fn();
    const onError = jest.fn();
    const onChunk = jest.fn();

    streamFromCustomLLM(
      'hello',
      [],
      { apiUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4', provider: 'openai', name: 'test', enabled: true },
      'system',
      onChunk,
      onEnd,
      onError
    );

    // Give the async path a tick to start
    await new Promise(r => setTimeout(r, 0));
    fakeStream.emit('end');

    expect(axios.post).toHaveBeenCalled();
    const callUrl: string = (axios.post as jest.Mock).mock.calls[0][0];
    expect(callUrl).toContain('chat/completions');
  });

  test('routes valid anthropic config to streamAnthropic path (different endpoint)', async () => {
    const fakeStream = makeFakeStream();
    (axios.post as jest.Mock).mockResolvedValue({ data: fakeStream });

    const onEnd = jest.fn();
    const onError = jest.fn();
    const onChunk = jest.fn();

    streamFromCustomLLM(
      'hello',
      [],
      { apiUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-test', model: 'claude-3-5-sonnet-20241022', provider: 'anthropic', name: 'test', enabled: true },
      'system',
      onChunk,
      onEnd,
      onError
    );

    await new Promise(r => setTimeout(r, 0));
    fakeStream.emit('end');

    expect(axios.post).toHaveBeenCalled();
    const callUrl: string = (axios.post as jest.Mock).mock.calls[0][0];
    expect(callUrl).toContain('messages');
  });

  test('routes custom provider to streamOpenAI path', async () => {
    const fakeStream = makeFakeStream();
    (axios.post as jest.Mock).mockResolvedValue({ data: fakeStream });

    const onChunk = jest.fn();
    const onEnd = jest.fn();
    const onError = jest.fn();

    streamFromCustomLLM(
      'hello',
      [],
      { apiUrl: 'http://localhost:11434/v1', provider: 'custom', model: '' } as any,
      'system',
      onChunk,
      onEnd,
      onError
    );

    await new Promise(r => setTimeout(r, 0));
    fakeStream.emit('end');

    expect(axios.post).toHaveBeenCalled();
  });

  test('returned object has a cancel function', async () => {
    const fakeStream = makeFakeStream();
    (axios.post as jest.Mock).mockResolvedValue({ data: fakeStream });

    const result = await streamFromCustomLLM(
      'hi',
      [],
      { apiUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-4', provider: 'openai', name: 'test', enabled: true },
      'system',
      jest.fn(),
      jest.fn(),
      jest.fn()
    );

    expect(typeof result.cancel).toBe('function');
    expect(() => result.cancel()).not.toThrow();
  });
});
