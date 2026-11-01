/**
 * storyboard-video-providers.ts — main-process authority for generated shot
 * clips (PROV-4).
 *
 * The Storyboard Deck may save which video model makes clips; only this module
 * decides whether a clip can actually be generated. Like the frame providers:
 * the model must be listed for the connected account (the media-capability
 * registry), the choice is explicit — there is no fallback to a paid service
 * the owner did not pick — and paid use needs a recorded first-use
 * confirmation, which only the Storyboard UI can write. The confirmation gate
 * sits before every online request, and the cost estimate in that dialog is
 * computed from Google's per-second pricing for the chosen model.
 */

import { getSettings, saveSettings } from '../config-manager';
import { getMediaCapabilityRegistry } from '../provider-capability-registry';
import type { MediaCapabilityModel } from '../../shared/media-capability-registry';
import { GenerationRouter } from './router';
import { veoVideoProvider, veoPerSecondMicroUsd, veoDurationFor, VEO_MAX_DURATION_SEC } from './veo-video-adapter';
import { ShotStatus, type GenerationRequest } from './types';
import { validateMovieVideoFiles } from './image-output';
import * as fs from 'fs';
import * as path from 'path';

export interface ShotClipQuote {
  videoModelRef: string;
  modelLabel: string;
  /** Veo clips come in 4/6/8 second lengths; the render trims to the shot. */
  clipDurationSec: number;
  pricePerSecondUsd: number;
  estimatedUsd: number;
}

export function hasPaidShotVideoConfirmation(videoModelRef: string): boolean {
  return typeof getSettings().paidShotVideoConfirmations?.[videoModelRef] === 'string';
}

export function recordPaidShotVideoConfirmation(videoModelRef: unknown): { ok: boolean; error?: string } {
  const ref = String(videoModelRef ?? '').trim();
  if (!ref) return { ok: false, error: 'Choose a video model before confirming paid use.' };
  const settings = getSettings();
  saveSettings({
    ...settings,
    paidShotVideoConfirmations: { ...(settings.paidShotVideoConfirmations ?? {}), [ref]: new Date().toISOString() },
  });
  return { ok: true };
}

/** The listed shot-video model a saved project choice resolves to, or null. */
export async function resolveStoryboardVideoModel(videoModelRef: string): Promise<MediaCapabilityModel | null> {
  if (!videoModelRef) return null;
  const registry = await getMediaCapabilityRegistry();
  return registry.videoModels.find(
    model => model.provider === 'google-ai-studio' && model.ref === videoModelRef && model.usableIn.includes('shot-video'),
  ) ?? null;
}

/** What one clip for this shot would cost, from Google's per-second pricing. */
export async function quoteStoryboardShotClip(
  videoModelRef: string,
  shotDurationSec: number,
): Promise<ShotClipQuote | { error: string }> {
  const model = await resolveStoryboardVideoModel(videoModelRef);
  if (!model) return { error: 'Choose a connected video model for this storyboard before generating a clip.' };
  const perSecond = veoPerSecondMicroUsd(model.modelId);
  if (!perSecond) return { error: `No verified per-second price is known for ${model.modelId}. The clip was not generated.` };
  const clipDurationSec = veoDurationFor(shotDurationSec);
  if (!clipDurationSec) {
    return { error: `This shot runs ${shotDurationSec} seconds, but Veo makes at most ${VEO_MAX_DURATION_SEC}. Shorten the shot to ${VEO_MAX_DURATION_SEC} seconds or less, then generate the clip.` };
  }
  return {
    videoModelRef,
    modelLabel: model.displayName,
    clipDurationSec,
    pricePerSecondUsd: perSecond / 1_000_000,
    estimatedUsd: Math.round((perSecond * clipDurationSec) / 10_000) / 100,
  };
}

/** Quote + confirmation state for one shot, read from the real saved files. */
export async function prepareStoryboardShotClip(args: { projectId?: unknown; sceneId?: unknown; shotId?: unknown }): Promise<
  { ok: true; quote: ShotClipQuote; confirmed: boolean } | { ok: false; error: string }> {
  const projectId = String(args?.projectId ?? '').trim();
  const sceneId = String(args?.sceneId || 'scene_01').trim();
  const shotId = String(args?.shotId ?? '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectId) || !shotId) {
    return { ok: false, error: 'Choose a valid storyboard project and shot.' };
  }
  const { getStoryboardProjectDir } = await import('./storyboard-renderer');
  const projectDir = getStoryboardProjectDir(projectId);
  if (!fs.existsSync(projectDir)) return { ok: false, error: `Storyboard project not found: ${projectId}` };
  const meta = readJson(path.join(projectDir, 'project.json'));
  const promptData = readJson(path.join(projectDir, 'scenes', sceneId, shotId, 'prompt.json'));
  const quote = await quoteStoryboardShotClip(String(meta.videoModelRef || ''), Number(promptData.durationSec) || 5);
  if ('error' in quote) return { ok: false, error: quote.error };
  return { ok: true, quote, confirmed: hasPaidShotVideoConfirmation(quote.videoModelRef) };
}

function readJson(file: string): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; }
}

function newestShotFrame(shotDir: string): string | null {
  const imgDir = path.join(shotDir, 'image');
  if (!fs.existsSync(imgDir)) return null;
  const newest = fs.readdirSync(imgDir)
    .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
    .map(f => ({ f, mtime: fs.statSync(path.join(imgDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || a.f.localeCompare(b.f))[0];
  return newest ? path.join(imgDir, newest.f) : null;
}

export interface GenerateStoryboardShotClipArgs {
  projectId: string;
  sceneId?: string;
  shotId: string;
  /** Animate the shot's saved frame instead of pure text-to-video. */
  useFrame?: boolean;
}

/**
 * Generate one Veo clip for one shot. The cost is estimated and confirmed
 * before any request leaves this process; Online stays a hard gate inside the
 * adapter.
 */
export async function generateStoryboardShotClip(
  args: GenerateStoryboardShotClipArgs,
  deps: { validate?: (shotDir: string, files: string[]) => Promise<void> } = {},
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const projectId = String(args?.projectId ?? '').trim();
  const sceneId = String(args?.sceneId || 'scene_01').trim();
  const shotId = String(args?.shotId ?? '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectId) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(sceneId) || !shotId) {
    return { ok: false, error: 'Choose a valid storyboard project and shot.' };
  }
  const { getStoryboardProjectDir } = await import('./storyboard-renderer');
  const projectDir = getStoryboardProjectDir(projectId);
  if (!fs.existsSync(projectDir)) return { ok: false, error: `Storyboard project not found: ${projectId}` };
  const shotDir = path.join(projectDir, 'scenes', sceneId, shotId);
  if (!fs.existsSync(shotDir)) return { ok: false, error: `Shot directory not found: ${shotId}` };

  const meta = readJson(path.join(projectDir, 'project.json'));
  const promptData = readJson(path.join(shotDir, 'prompt.json'));
  const prompt = String(promptData.prompt || '').trim();
  if (!prompt) return { ok: false, error: 'No prompt available for shot clip generation.' };
  const shotDurationSec = Number(promptData.durationSec) || 5;

  const videoModelRef = String(meta.videoModelRef || '');
  const model = await resolveStoryboardVideoModel(videoModelRef);
  if (!model) {
    return { ok: false, error: 'The saved video model is no longer listed for a connected account. Choose another one in the Storyboard.' };
  }
  const quote = await quoteStoryboardShotClip(videoModelRef, shotDurationSec);
  if ('error' in quote) return { ok: false, error: quote.error };

  // Paid use is confirmed once, in the Storyboard, before the first request.
  // The estimate below is what the confirmation dialog shows.
  if (!hasPaidShotVideoConfirmation(videoModelRef)) {
    return {
      ok: false,
      error: `Confirm paid use first: one ${quote.clipDurationSec}-second clip with ${quote.modelLabel} costs about $${quote.estimatedUsd.toFixed(2)} (Google charges per second of video, no free tier).`,
    };
  }

  const initImage = args.useFrame ? newestShotFrame(shotDir) : null;
  const req: GenerationRequest = {
    kind: 'video',
    prompt,
    modelId: model.modelId,
    width: 1280,
    height: 720,
    durationSec: quote.clipDurationSec,
    ...(initImage ? { initImage } : {}),
    shotId,
    shotDir,
    freeOnly: false,
    allowWatermark: true,
    allowDeferred: false,
  };

  const { decision, result } = await new GenerationRouter().register(veoVideoProvider).generate(req, { freeOnly: false });
  if (result.status !== 'done') {
    const reason = result.status === 'failed' ? result.error : 'Veo accepted the request but returned no clip.';
    return { ok: false, error: reason || decision.summary };
  }
  const clipPath = result.files[0]!;
  const validate = deps.validate ?? validateMovieVideoFiles;
  await validate(shotDir, [clipPath]);

  const statusFile = path.join(shotDir, 'status.json');
  const previous = readJson(statusFile);
  const attempts = Number(previous.attempts);
  fs.writeFileSync(statusFile, JSON.stringify({
    ...previous,
    shotId,
    status: ShotStatus.VIDEO_GENERATED,
    attempts: Number.isFinite(attempts) && attempts > 0 ? attempts + 1 : 1,
    updatedAt: new Date().toISOString(),
    provider: result.provider,
    videoModelRef,
    generatedPrompt: prompt,
    clipDurationSec: quote.clipDurationSec,
    clipCostUsd: quote.estimatedUsd,
  }, null, 2), 'utf-8');

  return {
    ok: true,
    result: {
      projectId, sceneId, shotId,
      provider: result.provider,
      videoClipPath: clipPath,
      clipDurationSec: quote.clipDurationSec,
      costUsd: quote.estimatedUsd,
      message: `Clip for ${shotId} generated with ${quote.modelLabel} (about $${quote.estimatedUsd.toFixed(2)}). The export trims it to the shot's ${shotDurationSec} seconds.`,
    },
  };
}
