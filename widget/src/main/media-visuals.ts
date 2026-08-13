/**
 * media-visuals.ts — a picture for each scene of a video.
 *
 * The renderer takes timed segments; this produces the images that fill them.
 * It reuses HomeBot's existing image_generate tool rather than adding a
 * second image pipeline: that already tries local Stable Diffusion, then
 * Pollinations (free, no key), then Stable Horde, then DALL·E, and getting a
 * picture is not the interesting part of this file.
 *
 * What IS interesting is that a video must never fail because a picture did.
 * Generation is best-effort per scene: a scene whose image fails reuses the
 * previous one, and a video where every image failed still renders on the flat
 * backdrop. Twenty-one network calls will not all succeed forever, and the
 * narration is the thing worth protecting.
 */

import * as fs from 'fs';
import * as path from 'path';

/** How many images to request at once. Enough to be quick, few enough to be polite. */
const CONCURRENCY = 3;

/** Pause before retrying a failed scene, to let a shared backoff lapse. */
const RETRY_GAP_MS = Number(process.env.HOMEBOT_SCENE_RETRY_GAP_MS ?? 1500);

/**
 * Turn a line of narration into an image prompt.
 *
 * The caption text alone makes literal, often absurd pictures — "and cried
 * each to his own god" renders as a crowd of gods. Framing it as a scene, with
 * the video's subject for context and a consistent style, keeps a sequence
 * looking like one video rather than twenty unrelated stock photos.
 */
export function buildScenePrompt(sceneText: string, videoTitle: string, style?: string): string {
  const cleaned = sceneText.replace(/\s+/g, ' ').trim().slice(0, 240);
  const look = style?.trim()
    || 'cinematic digital painting, dramatic lighting, muted earthy palette, no text, no watermark, no letters';
  return `${cleaned} — illustration for "${videoTitle}". ${look}`;
}

export interface SceneImage {
  index: number;
  path: string | null;
  source?: string;
  error?: string;
}

/**
 * Generate one image per scene, in parallel batches, degrading rather than failing.
 *
 * Images are written as .png next to the video's other assets so a person can
 * look at what was produced, replace one by hand, and re-render.
 */
export async function generateSceneImages(opts: {
  scenes: Array<{ text: string }>;
  videoTitle: string;
  outDir: string;
  width: number;
  height: number;
  style?: string;
  /** Injected in tests; defaults to the real image_generate handler. */
  generate?: (prompt: string, width: number, height: number) => Promise<{ base64: string; source?: string } | null>;
  onProgress?: (done: number, total: number) => void;
}): Promise<SceneImage[]> {
  const generate = opts.generate ?? defaultGenerator;
  fs.mkdirSync(opts.outDir, { recursive: true });

  const results: SceneImage[] = opts.scenes.map((_, i) => ({ index: i, path: null }));
  let completed = 0;

  const runOne = async (i: number) => {
    const prompt = buildScenePrompt(opts.scenes[i].text, opts.videoTitle, opts.style);
    try {
      const img = await generate(prompt, opts.width, opts.height);
      if (img?.base64) {
        const file = path.join(opts.outDir, `scene-${String(i).padStart(2, '0')}.png`);
        fs.writeFileSync(file, Buffer.from(img.base64, 'base64'));
        results[i] = { index: i, path: file, source: img.source };
      } else {
        results[i] = { index: i, path: null, error: 'no image returned' };
      }
    } catch (e: any) {
      results[i] = { index: i, path: null, error: e?.message || String(e) };
    }
    completed++;
    opts.onProgress?.(completed, opts.scenes.length);
  };

  // Fixed-size worker pool: a plain Promise.all over 21 scenes would open 21
  // simultaneous generations and get throttled or refused.
  const queue = opts.scenes.map((_, i) => i);
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (next === undefined) return;
        await runOne(next);
      }
    }),
  );

  // One spaced retry for whatever failed.
  //
  // The free backends are the flaky part, and Pollinations in particular holds
  // a shared five-minute backoff after any failure — so a single unlucky
  // request inside a batch silently takes the rest of the batch down with it.
  // Observed: one image out of three, then every scene reusing that neighbour,
  // which is a "multi-scene" video with one picture in it. Retrying serially
  // with a gap recovers most of them.
  const failed = results.filter(r => !r.path).map(r => r.index);
  if (failed.length && failed.length < opts.scenes.length + 1) {
    for (const i of failed) {
      await new Promise(r => setTimeout(r, RETRY_GAP_MS));
      await runOne(i);
    }
  }

  return results;
}

/**
 * Fill gaps so every scene has something to show.
 *
 * A missing image inherits the one before it (or the first that exists), which
 * holds the previous picture a little longer instead of cutting to black. Only
 * when nothing generated at all does this give up and return nulls, which the
 * renderer reads as "use the flat backdrop".
 */
export function fillMissingImages(images: SceneImage[]): Array<string | null> {
  const out: Array<string | null> = images.map(i => i.path);
  let lastSeen: string | null = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i]) lastSeen = out[i];
    else out[i] = lastSeen;
  }
  // Anything before the first success is still null; back-fill from the right.
  let nextSeen: string | null = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]) nextSeen = out[i];
    else out[i] = nextSeen;
  }
  return out;
}

async function defaultGenerator(prompt: string, width: number, height: number) {
  const { imageGenerateHandler } = await import('./tools/web');
  const res: any = await imageGenerateHandler({ prompt, width, height }, { executionId: 'media-visuals' } as any);
  if (!res?.success) throw new Error(res?.error || 'image_generate failed');
  const base64 = res.result?.image_base64;
  if (!base64) return null;
  return { base64, source: res.result?.source };
}
