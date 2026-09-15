/**
 * Main-process authority for the Storyboard frame provider choice.
 *
 * The renderer may request a provider; only this module decides whether it can
 * run. A frame request is routed through a router that holds the chosen
 * provider alone, so there is no fallback to a paid or watermarking service the
 * owner did not pick. Paid providers additionally need a recorded first-use
 * confirmation, which only the Storyboard UI can write (no chat tool can).
 */

import { getSettings, saveSettings } from '../config-manager';
import {
  STORYBOARD_FRAME_PROVIDERS,
  isStoryboardFrameProviderId,
  storyboardFrameProvider,
  type StoryboardFrameProviderId,
  type StoryboardFrameProviderOption,
  type StoryboardFrameProviderStatus,
} from '../../shared/storyboard-frame-providers';
import { GenerationRouter, evaluate } from './router';
import { pollinationsProvider } from './pollinations-adapter';
import { comfyUIProvider } from './comfyui-adapter';
import type { GenerationProvider, GenerationRequest } from './types';
import { resolveStudioOutputSpec, type StudioAspectRatio } from '../../shared/media-output';

/** Storyboard frames, 16:9. Kept for availability probes and legacy callers. */
export const STORYBOARD_FRAME_SIZE = { width: 1024, height: 576 } as const;

/**
 * Frame size per export shape, at one pixel budget (~590k, the same as the old
 * fixed 1024x576) so a 4 GB card is no worse off in portrait than in landscape,
 * and every side is a multiple of 64 for the diffusion models.
 *
 * Frames used to be 16:9 whatever the project exported, so a portrait export
 * cropped the middle 32% out of every shot - which is also what made the flat
 * image QA reject centred portrait crops in the live multi-output test.
 */
export const STORYBOARD_FRAME_SIZES: Record<StudioAspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1024, height: 576 },
  '9:16': { width: 576, height: 1024 },
  '1:1': { width: 768, height: 768 },
};

export interface StoryboardFrameShape {
  width: number;
  height: number;
  /** The shape the frames are drawn for. */
  aspectRatio: StudioAspectRatio;
  /** Other shapes this project exports, which must crop from these frames. */
  croppedAspects: StudioAspectRatio[];
}

/**
 * The shape to draw frames in for a storyboard project.
 *
 * One image cannot natively fit two shapes, so with several variants the first
 * one wins and the rest are reported as cropped - said out loud rather than
 * discovered in the export.
 */
export function storyboardFrameShape(outputSpec?: unknown): StoryboardFrameShape {
  // resolveStudioOutputSpec throws on settings it does not recognise. Frame
  // generation must not die with it: fall back to landscape, as before.
  let variants: ReturnType<typeof resolveStudioOutputSpec>['variants'];
  try {
    variants = resolveStudioOutputSpec(outputSpec ?? undefined).variants;
  } catch {
    variants = [];
  }
  const aspects: StudioAspectRatio[] = [];
  for (const v of variants) {
    if (!aspects.includes(v.aspectRatio)) aspects.push(v.aspectRatio);
  }
  const primary = aspects[0] ?? '16:9';
  return { ...STORYBOARD_FRAME_SIZES[primary], aspectRatio: primary, croppedAspects: aspects.slice(1) };
}

const ADAPTERS: Record<StoryboardFrameProviderOption['routerProviderId'], GenerationProvider> = {
  pollinations: pollinationsProvider,
  comfyui: comfyUIProvider,
};

/** The request policy a chosen option runs under. */
export function storyboardFrameRequestPolicy(option: StoryboardFrameProviderOption) {
  return { freeOnly: !option.paid, allowWatermark: option.mayWatermark, allowDeferred: false };
}

/** A router holding the chosen provider alone: no cross-provider fallback. */
export function routerForStoryboardFrame(id: StoryboardFrameProviderId): GenerationRouter {
  return new GenerationRouter().register(ADAPTERS[storyboardFrameProvider(id).routerProviderId]);
}

export function hasPaidFrameConfirmation(id: StoryboardFrameProviderId): boolean {
  return typeof getSettings().paidFrameConfirmations?.[id] === 'string';
}

export function recordPaidFrameConfirmation(id: unknown): { ok: boolean; error?: string } {
  if (!isStoryboardFrameProviderId(id) || !storyboardFrameProvider(id).paid) {
    return { ok: false, error: 'Only a paid frame provider needs this confirmation.' };
  }
  const settings = getSettings();
  saveSettings({ ...settings, paidFrameConfirmations: { ...(settings.paidFrameConfirmations ?? {}), [id]: new Date().toISOString() } });
  return { ok: true };
}

function probeRequest(option: StoryboardFrameProviderOption): GenerationRequest {
  return { kind: 'image', prompt: 'availability check', ...STORYBOARD_FRAME_SIZE, shotId: 'availability_check',
    shotDir: '', ...storyboardFrameRequestPolicy(option) };
}

/** Check one option now. Never generates and never sends a prompt anywhere. */
export async function describeStoryboardFrameProvider(option: StoryboardFrameProviderOption): Promise<StoryboardFrameProviderStatus> {
  const blocked = (needs: StoryboardFrameProviderStatus['needs'], reason: string): StoryboardFrameProviderStatus =>
    ({ ...option, ready: false, needs, reason });
  let score;
  try {
    const req = probeRequest(option);
    score = evaluate(ADAPTERS[option.routerProviderId], await ADAPTERS[option.routerProviderId].probe(req), req, req.freeOnly);
  } catch (err) {
    if ((err as { code?: string }).code === 'ONLINE_ACCESS_DISABLED') return blocked('online', 'Online is off. Turn on Online in Settings to use this.');
    return blocked(null, 'This option could not be checked right now. Try again.');
  }
  if (!score.eligible) {
    if (option.id === 'this-pc') return blocked('comfyui', 'ComfyUI is not running on this PC.');
    return blocked(null, 'This option cannot make frames right now.');
  }
  if (option.paid && !hasPaidFrameConfirmation(option.id)) {
    return blocked('paid-confirmation', 'Confirm paid use before the first image.');
  }
  return { ...option, ready: true, needs: null, reason: null };
}

export async function describeStoryboardFrameProviders(): Promise<StoryboardFrameProviderStatus[]> {
  return Promise.all(STORYBOARD_FRAME_PROVIDERS.map(describeStoryboardFrameProvider));
}
