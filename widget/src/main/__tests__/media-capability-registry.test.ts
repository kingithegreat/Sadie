import axios from 'axios';

jest.mock('axios');
let settings: Record<string, any> = {};
jest.mock('../config-manager', () => ({ getSettings: () => settings }));
const onlineGate = jest.fn();
jest.mock('../utils/provider-network-policy', () => ({
  assertProviderOnlineAccess: (provider: string) => onlineGate(provider),
}));

import {
  clearMediaCapabilityRegistryCache,
  getMediaCapabilityRegistry,
} from '../provider-capability-registry';
import { classifyGoogleMediaModels } from '../../shared/media-capability-registry';

const googleRecording = require('./fixtures/google-models-list.recording.json');
const openAIRecording = require('./fixtures/openai-models-list.recording.json');

describe('connected-account media capability registry', () => {
  beforeEach(() => {
    settings = {};
    onlineGate.mockReset();
    (axios.get as jest.Mock).mockReset();
    clearMediaCapabilityRegistryCache();
  });

  test('recorded Google models.list drives both pickers and excludes text and retired media IDs', async () => {
    settings = { providerApiKeys: { 'google-ai-studio': 'AIza-recording-key' } };
    (axios.get as jest.Mock).mockResolvedValue({ data: googleRecording });

    const registry = await getMediaCapabilityRegistry();

    expect(onlineGate).toHaveBeenCalledWith('Google AI Studio');
    expect(axios.get).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({ params: expect.objectContaining({ key: 'AIza-recording-key', pageSize: 1000 }) }),
    );
    expect(registry.imageModels.map(model => model.modelId)).toEqual([
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-lite-image',
    ]);
    expect(registry.videoModels.map(model => model.modelId)).toEqual([
      'veo-3.1-generate-preview',
      'gemini-omni-1.1-flash',
    ]);
    expect(registry.videoModels.find(model => model.modelId === 'gemini-omni-1.1-flash')).toMatchObject({
      kind: 'video',
      costClass: 'paid',
      usableIn: ['shot-video'],
      methods: [],
    });
    expect(registry.imageModels.every(model => model.costClass === 'paid' && model.watermark === 'invisible')).toBe(true);
    expect(registry.imageModels.every(model => model.usableIn.includes('storyboard-frame'))).toBe(true);
    expect(registry.videoModels.every(model => model.usableIn.includes('shot-video'))).toBe(true);
    expect(JSON.stringify(registry)).not.toMatch(/imagen-4|veo-2|gemini-3\.8-flash|gemini-2\.5-flash-image/);
  });

  test('removing the Google key removes its media models even while the keyed list is cached', async () => {
    settings = { providerApiKeys: { 'google-ai-studio': 'AIza-recording-key' } };
    (axios.get as jest.Mock).mockResolvedValue({ data: googleRecording });
    expect((await getMediaCapabilityRegistry()).imageModels.length).toBe(2);

    settings = { providerApiKeys: { 'google-ai-studio': '' } };
    const withoutKey = await getMediaCapabilityRegistry();
    expect(withoutKey.accounts).toEqual([]);
    expect(withoutKey.imageModels).toEqual([]);
    expect(withoutKey.videoModels).toEqual([]);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('the Google Gemini alias is one account and uses only its own saved key', async () => {
    settings = { providerApiKeys: { 'google-gemini': 'AIza-native-key', openai: '' } };
    (axios.get as jest.Mock).mockResolvedValue({ data: googleRecording });

    const registry = await getMediaCapabilityRegistry();

    expect(registry.accounts.map(account => account.provider)).toEqual(['google-ai-studio']);
    expect((axios.get as jest.Mock).mock.calls[0][1].params.key).toBe('AIza-native-key');
  });

  test('OpenAI intersects its live account list with undated GPT Image models only', async () => {
    settings = { providerApiKeys: { openai: 'sk-recording-key' } };
    (axios.get as jest.Mock).mockResolvedValue({ data: openAIRecording });

    const registry = await getMediaCapabilityRegistry();

    expect(registry.imageModels.map(model => model.modelId)).toEqual(['gpt-image-2.5-flare']);
    expect(registry.imageModels[0]).toMatchObject({ costClass: 'paid', watermark: 'metadata', usableIn: [] });
    expect(registry.videoModels).toEqual([]);
    expect(JSON.stringify(registry)).not.toMatch(/dall-e|sora|2026-09-08/);
  });

  test('verified non-media accounts are text only and uncertain catalogues stay unverified', async () => {
    settings = {
      providerApiKeys: { anthropic: 'sk-ant-recording', deepseek: 'sk-recording' },
      customLLM: { provider: 'claude-code', model: 'sonnet', enabled: true },
    };

    const registry = await getMediaCapabilityRegistry();

    expect(registry.accounts.map(account => [account.provider, account.status])).toEqual([
      ['anthropic', 'text-only'],
      ['claude-code', 'text-only'],
      ['deepseek', 'unverified'],
    ]);
    expect(registry.accounts.filter(account => account.status === 'text-only')
      .every(account => /Text only/.test(account.statusLabel))).toBe(true);
    expect(registry.accounts.find(account => account.provider === 'deepseek')?.statusLabel)
      .toMatch(/not verified.*yet/i);
    expect(registry.imageModels).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('discovery failure is visible and never replaced by a static media fallback', async () => {
    settings = { providerApiKeys: { 'google-ai-studio': 'AIza-recording-key' } };
    (axios.get as jest.Mock).mockRejectedValue(new Error('offline'));

    const registry = await getMediaCapabilityRegistry({ forceRefresh: true });

    expect(registry.accounts[0]).toMatchObject({ provider: 'google-ai-studio', status: 'error', models: [] });
    expect(registry.imageModels).toEqual([]);
    expect(registry.videoModels).toEqual([]);
  });

  test('Omni requires the exact documented ID, not an arbitrary video name or invented method token', () => {
    const classified = classifyGoogleMediaModels('g', 'Google', [
      { id: 'gemini-omni-1.1-flash', methods: [] },
      { id: 'some-video-model', methods: [] },
    ], 'live');

    expect(classified.map(model => model.modelId)).toEqual(['gemini-omni-1.1-flash']);
    expect(classified[0].methods).toEqual([]);
  });
});
