/**
 * custom-llm-client.test.ts
 * Tests for src/main/custom-llm-client.ts
 */

// Prevent axios from making real HTTP calls
jest.mock('axios');

import { getModelMetadata } from '../custom-llm-client';

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
