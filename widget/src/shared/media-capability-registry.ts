/**
 * Media generation capabilities for each connected account.
 *
 * This is deliberately separate from the chat-model catalogue. A model that
 * can understand an image is not necessarily able to create one, and a model
 * name alone is not entitlement evidence. Main builds this registry from the
 * connected account's own model-list response; renderer consumers only render
 * these already-classified records.
 */

export type MediaCapabilityKind = 'image' | 'video';
export type MediaCostClass = 'free' | 'plan-limits' | 'paid';
export type MediaWatermarkClass = 'none' | 'metadata' | 'invisible' | 'may-watermark' | 'unknown';
export type MediaCapabilitySource = 'live' | 'cached' | 'subscription' | 'declared';
export type MediaAccountStatus = 'ready' | 'text-only' | 'unverified' | 'error';

export interface ProviderListedModel {
  id: string;
  name?: string;
  description?: string;
  /** Provider method names, preserved exactly as returned by the list API. */
  methods?: string[];
}

export interface MediaCapabilityModel {
  /** Stable cross-process identity; never contains a credential. */
  ref: string;
  provider: string;
  accountId: string;
  accountLabel: string;
  modelId: string;
  displayName: string;
  kind: MediaCapabilityKind;
  costClass: MediaCostClass;
  costLabel: string;
  watermark: MediaWatermarkClass;
  watermarkLabel: string;
  source: MediaCapabilitySource;
  /** Where HomeBot has a working adapter today. Discovery alone is not wiring. */
  usableIn: Array<'storyboard-frame' | 'shot-video'>;
  methods: string[];
}

export interface MediaCapabilityAccount {
  id: string;
  provider: string;
  label: string;
  connection: 'api-key' | 'subscription';
  source: MediaCapabilitySource;
  status: MediaAccountStatus;
  statusLabel: string;
  models: MediaCapabilityModel[];
}

export interface MediaCapabilityRegistry {
  accounts: MediaCapabilityAccount[];
  imageModels: MediaCapabilityModel[];
  videoModels: MediaCapabilityModel[];
  refreshedAt: string;
}

export function mediaModelRef(provider: string, kind: MediaCapabilityKind, modelId: string): string {
  return `${provider}:${kind}:${encodeURIComponent(modelId)}`;
}

/**
 * Google models verified against the vendor's image/video documentation on
 * 2026-09-20. A live list response is necessary but not sufficient: Gemini
 * text models also report generateContent, so only documented media IDs pass.
 * Gemini Omni is listed for the Interactions API (see
 * https://ai.google.dev/gemini-api/docs/omni) and is selection-only until
 * PROV-4 supplies that adapter. The deprecated gemini-2.5-flash-image is
 * intentionally excluded; Google's deprecation page lists its 2026-10-02
 * shutdown (https://ai.google.dev/gemini-api/docs/deprecations).
 * Retired Imagen and Veo 2/3 IDs are intentionally absent.
 */
const GOOGLE_IMAGE_MODELS = new Set([
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image',
]);
const GOOGLE_VIDEO_MODELS = new Set([
  'veo-3.1-generate-preview',
  'veo-3.1-fast-generate-preview',
  'veo-3.1-lite-generate-preview',
  'gemini-omni-1.1-flash',
]);

function normalizedId(value: string): string {
  return value.replace(/^models\//, '').trim();
}

function uniqueMethods(value: unknown): string[] {
  return Array.from(new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []));
}

function baseModel(
  accountId: string,
  accountLabel: string,
  provider: string,
  listed: ProviderListedModel,
  kind: MediaCapabilityKind,
  source: MediaCapabilitySource,
): Omit<MediaCapabilityModel, 'costClass' | 'costLabel' | 'watermark' | 'watermarkLabel' | 'usableIn'> {
  const modelId = normalizedId(listed.id);
  return {
    ref: mediaModelRef(provider, kind, modelId),
    provider,
    accountId,
    accountLabel,
    modelId,
    displayName: listed.name?.trim() || modelId,
    kind,
    source,
    methods: uniqueMethods(listed.methods),
  };
}

export function classifyGoogleMediaModels(
  accountId: string,
  accountLabel: string,
  listedModels: ProviderListedModel[],
  source: Extract<MediaCapabilitySource, 'live' | 'cached'>,
): MediaCapabilityModel[] {
  const found: MediaCapabilityModel[] = [];
  const seen = new Set<string>();
  for (const listed of listedModels) {
    const id = normalizedId(listed.id || '');
    if (!id || seen.has(id)) continue;
    const methods = uniqueMethods(listed.methods);
    if (GOOGLE_IMAGE_MODELS.has(id) && methods.includes('generateContent')) {
      seen.add(id);
      found.push({
        ...baseModel(accountId, accountLabel, 'google-ai-studio', listed, 'image', source),
        costClass: 'paid',
        costLabel: 'Paid through your Google API project; no free image tier.',
        watermark: 'invisible',
        watermarkLabel: 'Google adds an invisible SynthID watermark.',
        usableIn: ['storyboard-frame'],
      });
      continue;
    }
    // The Models API exposes API method names, while Omni is documented on
    // the separate CreateInteraction endpoint and its list response does not
    // provide a verified method token. For this exact documented ID, presence
    // in the connected key's live catalogue is the entitlement signal;
    // generation remains intentionally unwired until PROV-4.
    if (GOOGLE_VIDEO_MODELS.has(id) && (
      methods.includes('predictLongRunning')
      || methods.includes('generateContent')
      || id === 'gemini-omni-1.1-flash'
    )) {
      seen.add(id);
      found.push({
        ...baseModel(accountId, accountLabel, 'google-ai-studio', listed, 'video', source),
        costClass: 'paid',
        costLabel: 'Paid per generated second through your Google API project.',
        watermark: 'invisible',
        watermarkLabel: 'Google applies SynthID provenance to generated video.',
        // PROV-4 adds the generation adapter. The picker can save this choice now.
        usableIn: ['shot-video'],
      });
    }
  }
  return found;
}

/**
 * OpenAI's /v1/models response exposes IDs and ownership, not modalities.
 * Therefore a live ID is intersected with the documented GPT Image family.
 * Dated snapshots are excluded: the UI saves undated aliases so a future
 * retirement does not turn a saved picker choice into a guaranteed 404.
 * DALL-E and Sora are deliberately not offered.
 */
export function classifyOpenAIMediaModels(
  accountId: string,
  accountLabel: string,
  listedModels: ProviderListedModel[],
  source: Extract<MediaCapabilitySource, 'live' | 'cached'>,
): MediaCapabilityModel[] {
  const found: MediaCapabilityModel[] = [];
  const seen = new Set<string>();
  for (const listed of listedModels) {
    const id = normalizedId(listed.id || '');
    if (!/^gpt-image-[a-z0-9.-]+$/i.test(id) || /-\d{4}-\d{2}-\d{2}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    found.push({
      ...baseModel(accountId, accountLabel, 'openai', listed, 'image', source),
      costClass: 'paid',
      costLabel: 'Paid usage through your OpenAI API account.',
      watermark: 'metadata',
      watermarkLabel: 'OpenAI image provenance can include C2PA metadata.',
      // OpenAI images are generated through the image_generate tool, whose paid
      // route is gpt-image-2.5 (see tools/web.ts). That is not a storyboard frame
      // provider: storyboard-frame-providers.ts serves frames through Google only,
      // so offering these in the frame picker would be the broken option this
      // entry exists to avoid. Stays empty until an OpenAI frame provider exists.
      usableIn: [],
    });
  }
  return found;
}

export function assembleMediaCapabilityRegistry(accounts: MediaCapabilityAccount[], now = new Date()): MediaCapabilityRegistry {
  const models = accounts.flatMap(account => account.models);
  return {
    accounts,
    imageModels: models.filter(model => model.kind === 'image'),
    videoModels: models.filter(model => model.kind === 'video'),
    refreshedAt: now.toISOString(),
  };
}
