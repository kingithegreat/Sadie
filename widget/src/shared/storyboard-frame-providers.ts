/**
 * The ways a Storyboard can make its frame images — an explicit, per-project
 * choice. Nothing here routes automatically: a frame is only ever made by the
 * provider the owner picked, so a paid or watermarking service can never be
 * reached as a silent fallback.
 *
 * Ancient Pathways is deliberately absent (it renders animated episodes, not
 * still frames) and so is local SD 1.5 (capped at 512 px, below a 16:9 frame).
 * Imagen was removed when Google retired it (10 November 2025). The owner chose
 * Google's replacement, Gemini 3.1 Flash Image, as a paid option (2026-09-16):
 * it has no free tier, so it needs a first-use confirmation like any paid option.
 */

export type StoryboardFrameProviderId = 'online' | 'this-pc' | 'gemini' | 'chatgpt-plan' | `gemini:${string}`;

/** What the owner still has to do before this choice can make frames. */
export type StoryboardFrameProviderNeed = 'online' | 'comfyui' | 'gemini-key' | 'codex' | 'paid-confirmation' | 'model-list';

export interface StoryboardFrameProviderOption {
  id: StoryboardFrameProviderId;
  /** GenerationRouter provider that does the work. */
  routerProviderId: 'pollinations' | 'comfyui' | 'gemini-image' | 'codex-image';
  /** Where · who · the one fact that matters. Shown in the picker. */
  label: string;
  cost: string;
  /** Said before generating whenever it is not null. */
  watermark: string | null;
  paid: boolean;
  mayWatermark: boolean;
  /** Needs setup a normal user should not meet on the happy path. */
  advanced: boolean;
  /** Exact provider model selected from this account's live model list. */
  modelId?: string;
  accountId?: string;
}

export const STORYBOARD_FRAME_PROVIDERS: readonly StoryboardFrameProviderOption[] = [
  {
    id: 'online',
    routerProviderId: 'pollinations',
    label: 'Online · free third-party service · may add a watermark',
    cost: 'No charge. A free public service with rate limits; your prompt is sent to it.',
    watermark: 'This service may add a small watermark to images, and it would appear in your movie.',
    paid: false,
    mayWatermark: true,
    advanced: false,
  },
  {
    id: 'this-pc',
    routerProviderId: 'comfyui',
    label: 'This PC · ComfyUI · private, no watermark',
    cost: 'No charge. Runs on this computer; nothing is sent online.',
    watermark: null,
    paid: false,
    mayWatermark: false,
    advanced: true,
  },
  {
    // Compatibility identity for saved projects. Main only exposes this after
    // the same exact model appears in the connected key's model list.
    id: 'gemini',
    routerProviderId: 'gemini-image',
    label: 'Gemini 3.1 Flash Image · Google AI Studio · paid',
    cost: 'Paid image generation charged by Google to your API project. There is no free image tier.',
    watermark: 'Google adds an invisible SynthID watermark. It does not show in your movie.',
    paid: true,
    mayWatermark: true,
    advanced: false,
    modelId: 'gemini-3.1-flash-image',
    accountId: 'account:google-ai-studio',
  },
  {
    // Aden, 2026-09-17: image generation through the ChatGPT plan he already pays for.
    id: 'chatgpt-plan',
    routerProviderId: 'codex-image',
    label: 'ChatGPT plan · Codex on this PC · uses your plan limits, no per-image charge',
    cost: 'No per-image charge: each frame uses your ChatGPT plan’s Codex limits (image turns use them several times faster than chat). Needs the Codex CLI signed in with ChatGPT; your prompt is sent to OpenAI.',
    watermark: 'OpenAI attaches C2PA content credentials to generated images. They are metadata and do not show in your movie.',
    paid: false,
    mayWatermark: true,
    advanced: false,
  },
];

export function isStoryboardFrameProviderId(value: unknown): value is StoryboardFrameProviderId {
  return typeof value === 'string' && (
    STORYBOARD_FRAME_PROVIDERS.some(option => option.id === value)
    // `gemini` is a saved-project compatibility alias. New choices always
    // carry the exact live-listed model after the colon.
    || value === 'gemini'
    || /^gemini:[a-z0-9][a-z0-9._-]*$/i.test(value)
  );
}

export function storyboardFrameProvider(id: StoryboardFrameProviderId): StoryboardFrameProviderOption {
  const fixed = STORYBOARD_FRAME_PROVIDERS.find(option => option.id === id);
  if (fixed) return fixed;
  const modelId = id === 'gemini' ? 'gemini-3.1-flash-image' : id.slice('gemini:'.length);
  return {
    id,
    routerProviderId: 'gemini-image',
    label: `${modelId} · Google AI Studio · paid`,
    cost: 'Paid image generation charged by Google to your API project. There is no free image tier.',
    watermark: 'Google adds an invisible SynthID watermark. It does not show in your movie.',
    paid: true,
    mayWatermark: true,
    advanced: false,
    modelId,
    accountId: 'account:google-ai-studio',
  };
}

/** One option plus what the main process found when it checked it just now. */
export interface StoryboardFrameProviderStatus extends StoryboardFrameProviderOption {
  ready: boolean;
  needs: StoryboardFrameProviderNeed | null;
  /** Plain-language reason it cannot make frames yet; null when ready. */
  reason: string | null;
}
