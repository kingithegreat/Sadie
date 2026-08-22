/**
 * model-lifecycle.test.ts
 *
 * Guards the bridge between "vendors retire model IDs" and "a settings file
 * written last year still names one". The picker lists get pruned; saved
 * configs do not — without this map, a retired ID 404s on every request.
 */

import { migrateRetiredModel, RETIRED_MODEL_RENAMES } from '../model-lifecycle';

jest.mock('axios');
import axios from 'axios';
import { EventEmitter } from 'events';
import { fetchAvailableCustomModels } from '../custom-llm-client';

describe('chatTemperature reaches the wire', () => {
  // The knob is the feature: a slider that nothing reads is the defect this
  // repo keeps shipping, so assert the assembled request, not the setting.

  function fakeStream() {
    const s: any = new EventEmitter();
    s.destroy = jest.fn();
    return s;
  }

  async function postedTemperature(temp: number | undefined): Promise<any> {
    (global as any).__testSettings = temp === undefined ? {} : { chatTemperature: temp };
    jest.resetModules();
    jest.doMock('../config-manager', () => ({
      getSettings: () => (global as any).__testSettings,
    }));
    // Resolve axios AFTER resetModules so the mock we read is the same
    // instance the re-imported client posts through.
    const axiosMock = jest.requireMock('axios');
    const s = fakeStream();
    axiosMock.post.mockResolvedValue({ data: s });
    const { streamFromCustomLLM: stream } = await import('../custom-llm-client');
    stream('hi', [], {
      name: 't', apiUrl: 'https://api.openai.com/v1', apiKey: 'sk-test',
      model: 'gpt-4o', provider: 'openai', enabled: true,
    }, 'sys', () => {}, () => {}, () => {});
    await new Promise(r => setTimeout(r, 0));
    s.emit('end');
    const body = axiosMock.post.mock.calls.at(-1)?.[1];
    jest.dontMock('../config-manager');
    return body?.temperature;
  }

  beforeEach(() => { jest.dontMock('../config-manager'); });

  test('a set value is sent, clamped to the 0–2 band', async () => {
    expect(await postedTemperature(1.2)).toBe(1.2);
    expect(await postedTemperature(9)).toBe(2);
    expect(await postedTemperature(-1)).toBe(0);
  });

  test('unset sends the provider default, not a fabricated one', async () => {
    expect(await postedTemperature(undefined)).toBe(0.5);
  });
});

describe('migrateRetiredModel', () => {
  test('renames every retired ID to a current-tier model', () => {
    expect(migrateRetiredModel('gpt-4-turbo')).toEqual({ model: 'gpt-4o', renamedFrom: 'gpt-4-turbo' });
    expect(migrateRetiredModel('gpt-4')).toEqual({ model: 'gpt-4o', renamedFrom: 'gpt-4' });
    expect(migrateRetiredModel('gpt-3.5-turbo')).toEqual({ model: 'gpt-4o-mini', renamedFrom: 'gpt-3.5-turbo' });
    expect(migrateRetiredModel('claude-3-5-sonnet')).toEqual({ model: 'claude-sonnet-5', renamedFrom: 'claude-3-5-sonnet' });
    expect(migrateRetiredModel('claude-3-5-haiku')).toEqual({ model: 'claude-haiku-4-5', renamedFrom: 'claude-3-5-haiku' });
    expect(migrateRetiredModel('claude-3-opus')).toEqual({ model: 'claude-opus-5', renamedFrom: 'claude-3-opus' });
    expect(migrateRetiredModel('claude-3-sonnet')).toEqual({ model: 'claude-sonnet-5', renamedFrom: 'claude-3-sonnet' });
    expect(migrateRetiredModel('claude-3-haiku')).toEqual({ model: 'claude-haiku-4-5', renamedFrom: 'claude-3-haiku' });
  });

  test('strips a dated snapshot suffix before renaming', () => {
    // The IDs that actually sat in user settings files are the dated ones.
    expect(migrateRetiredModel('claude-3-5-sonnet-20241022')).toEqual({ model: 'claude-sonnet-5', renamedFrom: 'claude-3-5-sonnet-20241022' });
    expect(migrateRetiredModel('claude-3-opus-20240229')).toEqual({ model: 'claude-opus-5', renamedFrom: 'claude-3-opus-20240229' });
  });

  test('is idempotent — a migration target stays put on the next load', () => {
    const once = migrateRetiredModel('claude-3-5-sonnet');
    expect(migrateRetiredModel(once.model)).toEqual({ model: once.model });
  });

  test('leaves current and unknown IDs untouched', () => {
    for (const id of ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5', 'o1-mini']) {
      expect(migrateRetiredModel(id)).toEqual({ model: id });
    }
    // A custom endpoint's model names are not ours to second-guess.
    expect(migrateRetiredModel('my-finetune-v2')).toEqual({ model: 'my-finetune-v2' });
  });

  test('handles empty input without inventing a model', () => {
    expect(migrateRetiredModel('')).toEqual({ model: '' });
    expect(migrateRetiredModel(undefined)).toEqual({ model: '' });
  });

  test('no rename target is itself a retired ID', () => {
    for (const target of Object.values(RETIRED_MODEL_RENAMES)) {
      expect(RETIRED_MODEL_RENAMES[target]).toBeUndefined();
    }
  });
});

describe('curated OpenAI model list', () => {
  test('offers no retired IDs in the picker', async () => {
    const models = await fetchAvailableCustomModels({
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
    });
    const ids = models.map(m => m.id);
    // Retired or made pointless by 4o/4o-mini; the picker must not offer them.
    for (const dead of ['gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo']) {
      expect(ids).not.toContain(dead);
    }
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('gpt-4o-mini');
  });

  test('no picker entry for any provider names a retired ID', async () => {
    (axios.get as jest.Mock) = jest.fn();
    for (const provider of ['openai', 'anthropic', 'groq', 'deepseek', 'google-ai-studio']) {
      const models = await fetchAvailableCustomModels({ provider: provider as any, apiUrl: 'https://example.invalid/v1' });
      for (const m of models) {
        expect(migrateRetiredModel(m.id).renamedFrom).toBeUndefined();
      }
    }
  });
});
