/**
 * The ways a Storyboard can make its frame images — an explicit, per-project
 * choice. Nothing here routes automatically: a frame is only ever made by the
 * provider the owner picked, so a paid or watermarking service can never be
 * reached as a silent fallback.
 *
 * Ancient Pathways is deliberately absent (it renders animated episodes, not
 * still frames) and so is local SD 1.5 (capped at 512 px, below a 16:9 frame).
 */

export type StoryboardFrameProviderId = 'online' | 'this-pc' | 'imagen';

/** What the owner still has to do before this choice can make frames. */
export type StoryboardFrameProviderNeed = 'online' | 'comfyui' | 'gemini-key' | 'paid-confirmation';

export interface StoryboardFrameProviderOption {
  id: StoryboardFrameProviderId;
  /** GenerationRouter provider that does the work. */
  routerProviderId: 'pollinations' | 'comfyui' | 'imagen-3';
  /** Where · who · the one fact that matters. Shown in the picker. */
  label: string;
  cost: string;
  /** Said before generating whenever it is not null. */
  watermark: string | null;
  paid: boolean;
  mayWatermark: boolean;
  /** Needs setup a normal user should not meet on the happy path. */
  advanced: boolean;
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
    id: 'imagen',
    routerProviderId: 'imagen-3',
    label: 'Imagen · Google cloud · paid per image',
    cost: 'Google charges about US$0.03 per image to the account that owns your Gemini key.',
    watermark: 'Google adds an invisible SynthID watermark to every image. It is not visible in the picture.',
    paid: true,
    mayWatermark: true,
    advanced: false,
  },
];

export function isStoryboardFrameProviderId(value: unknown): value is StoryboardFrameProviderId {
  return typeof value === 'string' && STORYBOARD_FRAME_PROVIDERS.some(option => option.id === value);
}

export function storyboardFrameProvider(id: StoryboardFrameProviderId): StoryboardFrameProviderOption {
  return STORYBOARD_FRAME_PROVIDERS.find(option => option.id === id)!;
}

/** One option plus what the main process found when it checked it just now. */
export interface StoryboardFrameProviderStatus extends StoryboardFrameProviderOption {
  ready: boolean;
  needs: StoryboardFrameProviderNeed | null;
  /** Plain-language reason it cannot make frames yet; null when ready. */
  reason: string | null;
}
