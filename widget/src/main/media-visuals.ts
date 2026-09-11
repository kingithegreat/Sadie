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
import * as crypto from 'crypto';

/** How many images to request at once. Enough to be quick, few enough to be polite. */
const CONCURRENCY = 3;

/** Pause before retrying a failed scene, to let a shared backoff lapse. */
const RETRY_GAP_MS = Number(process.env.HOMEBOT_SCENE_RETRY_GAP_MS ?? 1500);

/**
 * How long one scene's generation may run before it counts as failed.
 *
 * Measured live: a single scene calling the default generator walks up to six
 * providers in sequence (two local backends that are usually not running,
 * then Pollinations, Stable Horde, DALL-E, then Pollinations again) with no
 * ceiling on the total. One slow provider inside that chain used to stall an
 * entire worker slot — and the other two workers in the pool with it — for
 * however long that provider felt like taking. This bounds it so a hang
 * becomes an ordinary per-scene failure, which the existing retry/fallback
 * path already knows how to survive.
 */
const SCENE_TIMEOUT_MS = Number(process.env.HOMEBOT_SCENE_IMAGE_TIMEOUT_MS ?? 45_000);

/**
 * Where to keep previously-generated scenes for reuse.
 *
 * Absent unless the caller opts in — see the `cacheDir` note on
 * `generateSceneImages`. Resolution matches `ffmpeg-setup.ts`'s pattern:
 * Electron's real userData when running inside the app, APPDATA when not
 * (tests, early startup).
 */
export function defaultImageCacheDir(): string {
  try {
    // Required lazily: this module is imported by tests that have no Electron.
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'media-assets', '_scene-image-cache');
  } catch {
    return path.join(process.env.APPDATA || '', 'HomeBot', 'media-assets', '_scene-image-cache');
  }
}

/**
 * Identifies one generation request, independent of which video it belongs to.
 *
 * Two scenes asking the same question — same wording, same frame, same seed —
 * are the same picture. Re-rendering a project after tweaking narration
 * timing regenerates every scene from scratch today even though most of the
 * prompts did not change; this key is what lets an unchanged scene reuse its
 * existing image instead of re-asking a free, unSLA'd, queue-based provider
 * that may not answer for minutes.
 */
export function sceneCacheKey(prompt: string, width: number, height: number, seed?: number): string {
  return crypto.createHash('sha256').update(`${prompt} ${width}x${height} ${seed ?? ''}`).digest('hex');
}

/** Runs `fn`, or rejects with a timeout error first — whichever happens first. */
function withTimeout<T>(fn: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    fn.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

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
  const look = style?.trim() || DEFAULT_LOOK;
  return `${cleaned} — illustration for "${videoTitle}". ${look}`;
}

/**
 * The house style, held identical across every scene of a video.
 *
 * Each scene is generated independently, so without a shared anchor the same
 * subject came back as a different thing shot to shot — one tall ship, then a
 * visibly different tall ship. Naming the medium, the light and the palette
 * pins the parts that must not change; the scene text supplies what does.
 */
const DEFAULT_LOOK = 'cinematic digital painting, dramatic side lighting, muted earthy palette, '
  + 'consistent art direction, film still, no text, no watermark, no letters';

/**
 * A seed that is stable for one video and different between videos.
 *
 * Same seed with different prompts keeps composition and palette related,
 * which is what makes a sequence read as one piece. Derived from the video's
 * own identity so a re-render reproduces the same look rather than rolling
 * fresh visuals every time.
 */
export function seedForVideo(identity: string): number {
  let h = 2166136261;
  for (let i = 0; i < identity.length; i++) {
    h ^= identity.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Positive, and inside the range the backends accept.
  return Math.abs(h) % 1_000_000_000;
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
  /** Held identical across the scenes of one video, so they look related. */
  seed?: number;
  /** Injected in tests; defaults to the real image_generate handler. */
  generate?: (prompt: string, width: number, height: number, seed?: number) => Promise<{ base64: string; source?: string } | null>;
  onProgress?: (done: number, total: number) => void;
  /**
   * Reuse a previous generation for an identical (prompt, size, seed) rather
   * than asking a provider again. Off unless a directory is given: several
   * tests reuse the same short scene text ("a", "b", "c") across cases with
   * deliberately different mock behaviour, and a shared default cache would
   * let one test's cached image silently answer for another's. Real callers
   * (media.ts) opt in with `defaultImageCacheDir()`.
   */
  cacheDir?: string | null;
  /** Per-scene ceiling; defaults to SCENE_TIMEOUT_MS. Set 0 to disable. */
  timeoutMs?: number;
}): Promise<SceneImage[]> {
  const generate = opts.generate ?? defaultGenerator;
  const timeoutMs = opts.timeoutMs ?? SCENE_TIMEOUT_MS;
  fs.mkdirSync(opts.outDir, { recursive: true });
  // Best-effort, like every other cache touch below: an unusable cache
  // directory (wrong permissions, or something already at that path that
  // is not a directory) degrades to "no caching this run", not a thrown
  // error that would fail scenes whose images never depended on it.
  let cacheDir: string | null = null;
  if (opts.cacheDir) {
    try { fs.mkdirSync(opts.cacheDir, { recursive: true }); cacheDir = opts.cacheDir; }
    catch { cacheDir = null; }
  }

  const results: SceneImage[] = opts.scenes.map((_, i) => ({ index: i, path: null }));
  let completed = 0;

  const runOne = async (i: number) => {
    const prompt = buildScenePrompt(opts.scenes[i].text, opts.videoTitle, opts.style);
    const file = path.join(opts.outDir, `scene-${String(i).padStart(2, '0')}.png`);
    const cachePath = cacheDir
      ? path.join(cacheDir, `${sceneCacheKey(prompt, opts.width, opts.height, opts.seed)}.png`)
      : null;

    if (cachePath && fs.existsSync(cachePath)) {
      try {
        fs.copyFileSync(cachePath, file);
        results[i] = { index: i, path: file, source: 'cache' };
        completed++;
        opts.onProgress?.(completed, opts.scenes.length);
        return;
      } catch {
        // Cache read failed (e.g. deleted between the check and the copy) —
        // fall through and generate normally rather than failing the scene.
      }
    }

    try {
      const img = timeoutMs > 0
        ? await withTimeout(generate(prompt, opts.width, opts.height, opts.seed), timeoutMs, `scene ${i} generation`)
        : await generate(prompt, opts.width, opts.height, opts.seed);
      if (img?.base64) {
        const buf = Buffer.from(img.base64, 'base64');
        fs.writeFileSync(file, buf);
        if (cachePath) {
          // Best-effort: a full disk or a permissions hiccup here must not
          // turn a successful generation into a failed scene.
          try { fs.writeFileSync(cachePath, buf); } catch { /* not fatal */ }
        }
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

async function defaultGenerator(prompt: string, width: number, height: number, seed?: number) {
  const { imageGenerateHandler } = await import('./tools/web');
  const res: any = await imageGenerateHandler({ prompt, width, height, seed }, { executionId: 'media-visuals' } as any);
  if (!res?.success) throw new Error(res?.error || 'image_generate failed');
  const base64 = res.result?.image_base64;
  if (!base64) return null;
  return { base64, source: res.result?.source };
}
