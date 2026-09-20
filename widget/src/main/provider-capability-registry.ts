/**
 * Builds the media-capability registry from saved connections.
 *
 * Network discovery is list-only, Online-gated and cached by a one-way key
 * fingerprint. It never generates media, never logs a credential and never
 * turns an unknown provider into a runnable picker option.
 */

import axios from 'axios';
import { createHash } from 'node:crypto';
import { getSettings } from './config-manager';
import { apiKeyForProvider } from '../shared/cloud-llm';
import { assertProviderOnlineAccess } from './utils/provider-network-policy';
import {
  assembleMediaCapabilityRegistry,
  classifyGoogleMediaModels,
  classifyOpenAIMediaModels,
  mediaModelRef,
  type MediaCapabilityAccount,
  type MediaCapabilityRegistry,
  type MediaCapabilitySource,
  type ProviderListedModel,
} from '../shared/media-capability-registry';

const GOOGLE_MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENAI_MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 12;

type ListCacheEntry = { at: number; models: ProviderListedModel[] };
const listCache = new Map<string, ListCacheEntry>();

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic API',
  'claude-code': 'Claude subscription',
  codex: 'ChatGPT subscription',
  openai: 'OpenAI API',
  'google-ai-studio': 'Google AI Studio',
  'google-gemini': 'Google AI Studio',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  cerebras: 'Cerebras',
  sambanova: 'SambaNova',
  moonshot: 'Moonshot',
  openrouter: 'OpenRouter',
  tokenrouter: 'TokenRouter',
  huggingface: 'Hugging Face',
  together: 'Together AI',
  custom: 'Custom API',
};

/** Providers whose published account catalogue has no image/video generator. */
const TEXT_ONLY_PROVIDERS = new Set(['anthropic', 'claude-code']);

/** Providers known to host some media models, but not yet safely classified. */
const UNVERIFIED_MEDIA_PROVIDERS = new Set([
  'deepseek', 'groq', 'cerebras', 'sambanova', 'moonshot',
  'openrouter', 'tokenrouter', 'huggingface', 'together', 'custom',
]);

function keyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

function cacheModels(cacheKey: string, models: ProviderListedModel[]): void {
  listCache.set(cacheKey, { at: Date.now(), models });
  if (listCache.size > MAX_CACHE_ENTRIES) {
    const oldest = listCache.keys().next().value;
    if (oldest) listCache.delete(oldest);
  }
}

function fromCache(cacheKey: string, forceRefresh: boolean): ProviderListedModel[] | null {
  if (forceRefresh) return null;
  const cached = listCache.get(cacheKey);
  return cached && Date.now() - cached.at < CACHE_TTL_MS ? cached.models : null;
}

export interface ListedModelsResult {
  models: ProviderListedModel[];
  source: Extract<MediaCapabilitySource, 'live' | 'cached'>;
}

/** List every Google model exactly once, preserving provider method metadata. */
export async function listGoogleAccountModels(apiKey: string, forceRefresh = false): Promise<ListedModelsResult> {
  const cacheKey = `google:${keyFingerprint(apiKey)}`;
  const cached = fromCache(cacheKey, forceRefresh);
  if (cached) return { models: cached, source: 'cached' };
  assertProviderOnlineAccess('Google AI Studio');

  const models: ProviderListedModel[] = [];
  let pageToken = '';
  do {
    const response = await axios.get(GOOGLE_MODELS_ENDPOINT, {
      params: { key: apiKey, pageSize: 1000, ...(pageToken ? { pageToken } : {}) },
      timeout: 10000,
      maxRedirects: 0,
    });
    const raw = Array.isArray(response?.data?.models) ? response.data.models : [];
    for (const item of raw) {
      const id = typeof item?.name === 'string' ? item.name.replace(/^models\//, '').trim() : '';
      if (!id) continue;
      models.push({
        id,
        name: typeof item?.displayName === 'string' ? item.displayName : id,
        description: typeof item?.description === 'string' ? item.description : '',
        methods: Array.isArray(item?.supportedGenerationMethods)
          ? item.supportedGenerationMethods.filter((method: unknown): method is string => typeof method === 'string')
          : [],
      });
    }
    pageToken = typeof response?.data?.nextPageToken === 'string' ? response.data.nextPageToken : '';
  } while (pageToken);

  cacheModels(cacheKey, models);
  return { models, source: 'live' };
}

/** OpenAI's endpoint reports availability but no modality metadata. */
export async function listOpenAIAccountModels(apiKey: string, forceRefresh = false): Promise<ListedModelsResult> {
  const cacheKey = `openai:${keyFingerprint(apiKey)}`;
  const cached = fromCache(cacheKey, forceRefresh);
  if (cached) return { models: cached, source: 'cached' };
  assertProviderOnlineAccess('OpenAI');

  const response = await axios.get(OPENAI_MODELS_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 10000,
    maxRedirects: 0,
  });
  const raw = Array.isArray(response?.data?.data) ? response.data.data : [];
  const models = raw.flatMap((item: any): ProviderListedModel[] => {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    return id ? [{ id, name: id, description: typeof item?.owned_by === 'string' ? item.owned_by : '' }] : [];
  });
  cacheModels(cacheKey, models);
  return { models, source: 'live' };
}

function connectedProviders(settings: any): string[] {
  const providers = new Set<string>();
  for (const [provider, key] of Object.entries(settings?.providerApiKeys || {})) {
    if (typeof key === 'string' && key.trim()) providers.add(provider);
  }
  for (const provider of ['anthropic', 'openai', 'google-ai-studio', 'deepseek', 'groq', 'cerebras', 'sambanova', 'moonshot', 'openrouter', 'tokenrouter', 'huggingface', 'together']) {
    if (apiKeyForProvider(settings, provider)) providers.add(provider);
  }
  // Both names read the same Gemini key. One account must not appear twice.
  if (providers.has('google-gemini')) {
    providers.delete('google-gemini');
    providers.add('google-ai-studio');
  }
  const cli = settings?.customLLM?.provider;
  if (cli === 'claude-code' || cli === 'codex') providers.add(cli);
  return Array.from(providers).sort();
}

function plainAccount(provider: string, status: 'text-only' | 'unverified'): MediaCapabilityAccount {
  const label = PROVIDER_LABELS[provider] || provider;
  return {
    id: `account:${provider}`,
    provider,
    label,
    connection: provider === 'claude-code' || provider === 'codex' ? 'subscription' : 'api-key',
    source: 'declared',
    status,
    statusLabel: status === 'text-only'
      ? 'Text only — this account has no image or video generation models.'
      : 'Media models are not verified for this account yet.',
    models: [],
  };
}

function errorAccount(provider: string, message: string): MediaCapabilityAccount {
  return {
    id: `account:${provider}`,
    provider,
    label: PROVIDER_LABELS[provider] || provider,
    connection: 'api-key',
    source: 'declared',
    status: 'error',
    statusLabel: message,
    models: [],
  };
}

function safeDiscoveryMessage(provider: string, err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code === 'ONLINE_ACCESS_DISABLED') return 'Online is off. Turn it on to refresh this account’s media models.';
  const status = (err as any)?.response?.status;
  if (status === 400 || status === 401 || status === 403) return `${PROVIDER_LABELS[provider] || provider} rejected the saved key.`;
  return `Could not refresh ${PROVIDER_LABELS[provider] || provider} media models. Try again.`;
}

async function discoverAccount(provider: string, settings: any, forceRefresh: boolean): Promise<MediaCapabilityAccount> {
  const id = `account:${provider}`;
  const label = PROVIDER_LABELS[provider] || provider;
  if (provider === 'codex') {
    const model = {
      ref: mediaModelRef('codex', 'image', 'codex-image'), provider: 'codex', accountId: id, accountLabel: label,
      modelId: 'codex-image', displayName: 'ChatGPT plan image generation', kind: 'image' as const,
      costClass: 'plan-limits' as const, costLabel: 'Uses your ChatGPT plan limits; no per-image API charge.',
      watermark: 'metadata' as const, watermarkLabel: 'OpenAI attaches content-provenance metadata.',
      source: 'subscription' as const, usableIn: ['storyboard-frame' as const], methods: [],
    };
    return { id, provider, label, connection: 'subscription', source: 'subscription', status: 'ready', statusLabel: '1 image model through your signed-in plan.', models: [model] };
  }
  if (TEXT_ONLY_PROVIDERS.has(provider)) return plainAccount(provider, 'text-only');
  if (UNVERIFIED_MEDIA_PROVIDERS.has(provider)) return plainAccount(provider, 'unverified');

  const apiKey = provider === 'google-ai-studio'
    ? (apiKeyForProvider(settings, 'google-ai-studio') || apiKeyForProvider(settings, 'google-gemini'))
    : apiKeyForProvider(settings, provider);
  if (!apiKey) return errorAccount(provider, 'The connection has no saved key.');
  try {
    if (provider === 'google-ai-studio') {
      const listed = await listGoogleAccountModels(apiKey, forceRefresh);
      const models = classifyGoogleMediaModels(id, label, listed.models, listed.source);
      return { id, provider, label, connection: 'api-key', source: listed.source,
        status: models.length ? 'ready' : 'text-only',
        statusLabel: models.length ? `${models.length} media ${models.length === 1 ? 'model' : 'models'} listed for this key.` : 'Text only — this key listed no supported image or video models.',
        models };
    }
    if (provider === 'openai') {
      const listed = await listOpenAIAccountModels(apiKey, forceRefresh);
      const models = classifyOpenAIMediaModels(id, label, listed.models, listed.source);
      return { id, provider, label, connection: 'api-key', source: listed.source,
        status: models.length ? 'ready' : 'text-only',
        statusLabel: models.length ? `${models.length} media ${models.length === 1 ? 'model' : 'models'} listed for this key.` : 'Text only — this key listed no supported image or video models.',
        models };
    }
    return plainAccount(provider, 'unverified');
  } catch (err) {
    return errorAccount(provider, safeDiscoveryMessage(provider, err));
  }
}

export async function getMediaCapabilityRegistry(options: { forceRefresh?: boolean } = {}): Promise<MediaCapabilityRegistry> {
  const settings = getSettings() as any;
  const providers = connectedProviders(settings);
  const accounts = await Promise.all(providers.map(provider => discoverAccount(provider, settings, options.forceRefresh === true)));
  return assembleMediaCapabilityRegistry(accounts);
}

/** Tests use this to prove a changed key/list is not hidden by an earlier run. */
export function clearMediaCapabilityRegistryCache(): void {
  listCache.clear();
}
