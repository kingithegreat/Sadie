/**
 * custom-llm-client.test.ts
 * Tests for src/main/custom-llm-client.ts
 */

// Prevent axios from making real HTTP calls
jest.mock('axios');

import {
  getModelMetadata,
  validateCustomLLMConfig,
  autoConfigureCustomLLM,
  fetchAvailableCustomModels,
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
    expect(meta.contextWindow).toBe(4096);
    expect(meta.maxTokens).toBe(2000);
    expect(meta.supportsTools).toBe(false);
    expect(meta.supportsVision).toBe(false);
    expect(meta.supportsStreaming).toBe(true);
  });

  test('returns defaults for empty string', () => {
    const meta = getModelMetadata('');
    expect(meta.contextWindow).toBe(4096);
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
    const r = validateCustomLLMConfig({ apiUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4', provider: 'openai' });
    expect(r.valid).toBe(true);
    expect(r.error).toBeUndefined();
  });

  test('valid for well-formed anthropic config', () => {
    const r = validateCustomLLMConfig({ apiUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant', model: 'claude-3-5-sonnet-20241022', provider: 'anthropic' });
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
    const result = autoConfigureCustomLLM({ apiUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'gpt-4o', provider: 'openrouter' });
    expect(result.provider).toBe('openrouter');
  });

  test('adds metadata for known model when metadata not present', () => {
    const result = autoConfigureCustomLLM({ apiUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-4o', provider: 'openai' });
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.contextWindow).toBe(128000);
  });

  test('preserves existing metadata if already defined', () => {
    const existing = { contextWindow: 999, maxTokens: 1, supportsTools: false, supportsVision: false, supportsStreaming: false };
    const result = autoConfigureCustomLLM({ apiUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-4o', provider: 'openai', metadata: existing });
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
});
