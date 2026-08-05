/**
 * anthropic-model-freshness.test.ts
 *
 * Guards the two ways the Anthropic provider can break for a paying customer
 * without any test failing:
 *   1. A retired/dated model ID in the curated list → 404 on every request.
 *   2. Sending `temperature` to a model that removed sampling params → 400.
 *
 * Both shipped simultaneously before this suite existed.
 */

jest.mock('axios');

import { EventEmitter } from 'events';
import axios from 'axios';
import {
  acceptsSamplingParams,
  fetchAvailableCustomModels,
  streamFromCustomLLM,
} from '../custom-llm-client';
import type { CustomLLMConfig } from '../../shared/types';

function makeFakeStream() {
  const s: any = new EventEmitter();
  s.destroy = jest.fn();
  return s;
}

/** Run one anthropic request and hand back the JSON body that axios received. */
async function bodyFor(model: string): Promise<any> {
  const fakeStream = makeFakeStream();
  (axios.post as jest.Mock).mockResolvedValue({ data: fakeStream });

  const cfg: CustomLLMConfig = {
    name: 'test',
    apiUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-test',
    model,
    provider: 'anthropic',
    enabled: true,
  };

  streamFromCustomLLM('hello', [], cfg, 'system', () => {}, () => {}, () => {});
  await new Promise(r => setTimeout(r, 0));
  fakeStream.emit('end');

  return (axios.post as jest.Mock).mock.calls[0][1];
}

beforeEach(() => { (axios.post as jest.Mock).mockReset(); });

describe('curated Anthropic model list', () => {
  test('contains no dated snapshot IDs', async () => {
    const models = await fetchAvailableCustomModels({
      provider: 'anthropic',
      apiUrl: 'https://api.anthropic.com/v1',
    });
    expect(models.length).toBeGreaterThan(0);
    // A dated ID (…-20250514) pins a snapshot that eventually retires and 404s.
    // Undated aliases track the current model in that tier.
    for (const m of models) {
      expect(m.id).not.toMatch(/\d{8}/);
    }
  });

  test('contains none of the known-retired IDs that previously shipped', async () => {
    const retired = [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307',
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
    ];
    const models = await fetchAvailableCustomModels({
      provider: 'anthropic',
      apiUrl: 'https://api.anthropic.com/v1',
    });
    const ids = models.map(m => m.id);
    for (const dead of retired) expect(ids).not.toContain(dead);
  });

  test('every listed model has tool support and a real context window', async () => {
    // getModelMetadata falls through to supportsTools:false for unrecognised
    // IDs, which would silently disable tool calling rather than error.
    const { getModelMetadata } = await import('../custom-llm-client');
    const models = await fetchAvailableCustomModels({
      provider: 'anthropic',
      apiUrl: 'https://api.anthropic.com/v1',
    });
    for (const m of models) {
      const meta = getModelMetadata(m.id);
      expect(meta.supportsTools).toBe(true);
      expect(meta.contextWindow).toBeGreaterThan(100000);
    }
  });
});

describe('acceptsSamplingParams', () => {
  test.each([
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-fable-5',
    'claude-opus-4-7',
    'claude-opus-4-8',
  ])('%s rejects sampling params', (model) => {
    expect(acceptsSamplingParams(model)).toBe(false);
  });

  test.each([
    'claude-haiku-4-5',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-opus-4-5',
    'claude-3-5-sonnet-20241022',
  ])('%s still accepts sampling params', (model) => {
    expect(acceptsSamplingParams(model)).toBe(true);
  });

  test('unknown or custom model IDs default to accepting', () => {
    // Self-hosted Anthropic-compatible endpoints must keep working.
    expect(acceptsSamplingParams('my-local-claude-clone')).toBe(true);
    expect(acceptsSamplingParams('')).toBe(true);
  });

  test('does not confuse claude-opus-4-5 with the 4-7/4-8 family', () => {
    expect(acceptsSamplingParams('claude-opus-4-5')).toBe(true);
  });
});

describe('anthropic request body', () => {
  test('omits temperature for models that reject it', async () => {
    const body = await bodyFor('claude-opus-5');
    expect(body.model).toBe('claude-opus-5');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
  });

  test('still sends temperature for models that accept it', async () => {
    const body = await bodyFor('claude-haiku-4-5');
    expect(body.model).toBe('claude-haiku-4-5');
    expect(typeof body.temperature).toBe('number');
  });

  test('sends max_tokens sized from the model metadata, not the 4096 default', async () => {
    const body = await bodyFor('claude-sonnet-5');
    expect(body.max_tokens).toBeGreaterThan(4096);
  });
});
