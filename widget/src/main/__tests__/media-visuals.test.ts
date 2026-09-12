/**
 * Scene images: the video must survive them failing.
 *
 * Twenty-one network calls will not all succeed forever, and the narration is
 * the thing worth protecting. So the interesting behaviour here is not "does
 * it fetch a picture" — it is what happens when it does not.
 */

import { buildScenePrompt, generateSceneImages, fillMissingImages } from '../media-visuals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-visuals-'));
// A 1x1 png, so the writes are real without being large.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('turning narration into an image prompt', () => {
  it('frames the line as a scene, with the video for context', () => {
    const p = buildScenePrompt('And cried each to his own god.', 'One-Minute Bible: Jonah');
    // The bare caption makes literal, absurd pictures; the title anchors it.
    expect(p).toContain('And cried each to his own god.');
    expect(p).toContain('One-Minute Bible: Jonah');
  });

  it('asks for no lettering, because generators write gibberish text', () => {
    expect(buildScenePrompt('x', 'y')).toMatch(/no text|no letters/i);
  });

  it('takes art direction when given, so a series can look like a series', () => {
    expect(buildScenePrompt('x', 'y', 'stained glass, high contrast')).toContain('stained glass');
  });

  it('caps runaway scene text rather than sending a paragraph', () => {
    const long = 'word '.repeat(200);
    expect(buildScenePrompt(long, 'T').length).toBeLessThan(500);
  });
});

describe('generating one image per scene', () => {
  it('writes a file per scene and reports the source', async () => {
    const dir = tmp();
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }, { text: 'b' }],
      videoTitle: 'T', outDir: dir, width: 512, height: 512,
      generate: async () => ({ base64: PNG_1PX, source: 'test' }),
    });
    expect(res.map(r => !!r.path)).toEqual([true, true]);
    for (const r of res) expect(fs.existsSync(r.path!)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The renderer feeds every scene of one video to a SINGLE ffmpeg concat
   * demuxer, which probes the first file, picks one decoder, and then cannot
   * decode any scene stored in a different format — measured on the 2026-09-12
   * nightly artifacts as `[mjpeg] No JPEG data found in image`, the odd frames
   * dropped, and a 10.0s narration rendered as a 6.3s video.
   *
   * Providers do not agree on a format: Pollinations returns JPEG while the
   * local fallback plate is a real PNG, so a mixed render was the normal case,
   * not an edge case. Correct file extensions do NOT help — one concat gets one
   * decoder, so the bytes themselves have to agree.
   */
  it('stores every scene in one real format, whatever the provider sent', async () => {
    const dir = tmp();
    // A JPEG (SOI + EXIF, exactly what Pollinations returns) alongside a PNG.
    const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66]).toString('base64');
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }, { text: 'b' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: async (prompt) => ({ base64: prompt.includes('b —') ? PNG_1PX : JPEG_BYTES }),
    });

    const magics = res
      .filter(r => r.path)
      .map(r => fs.readFileSync(r.path!).subarray(0, 4).toString('hex'));
    expect(magics.length).toBe(2);
    // One decoder must be able to read all of them.
    expect(new Set(magics).size).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records a failure per scene instead of throwing', async () => {
    const dir = tmp();
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: async (prompt) => (prompt.includes('b —') ? null : { base64: PNG_1PX }),
    });
    expect(res.filter(r => r.path).length).toBe(2);
    expect(res.find(r => !r.path)!.error).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('survives the generator throwing', async () => {
    const dir = tmp();
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: async () => { throw new Error('rate limited'); },
    });
    expect(res[0].path).toBeNull();
    expect(res[0].error).toMatch(/rate limited/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports progress, because 21 generations is a long silence', async () => {
    const dir = tmp();
    const seen: number[] = [];
    await generateSceneImages({
      scenes: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: async () => ({ base64: PNG_1PX }),
      onProgress: (done) => seen.push(done),
    });
    expect(seen).toEqual([1, 2, 3, 4]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('reusing a previous generation by prompt hash', () => {
  // Cache is opt-in via cacheDir precisely so these are the only tests that
  // exercise it — every other test above shares scene text like "a"/"b"/"c"
  // across cases with deliberately different mock behaviour, and a shared
  // default cache would let one test's cached image answer for another's.

  it('skips the network call on an identical (prompt, size, seed)', async () => {
    const dir = tmp();
    const cacheDir = tmp();
    let calls = 0;
    const opts = {
      scenes: [{ text: 'a lighthouse at dawn' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64, seed: 7,
      generate: async () => { calls++; return { base64: PNG_1PX, source: 'test' }; },
      cacheDir,
    };
    const first = await generateSceneImages(opts);
    expect(calls).toBe(1);
    expect(first[0].source).toBe('test');

    const dir2 = tmp();
    const second = await generateSceneImages({ ...opts, outDir: dir2 });
    expect(calls).toBe(1); // no second network call
    expect(second[0].source).toBe('cache');
    expect(fs.existsSync(second[0].path!)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('does not cache across a different prompt, size, or seed', async () => {
    const dir = tmp();
    const cacheDir = tmp();
    let calls = 0;
    const generate = async () => { calls++; return { base64: PNG_1PX }; };

    await generateSceneImages({
      scenes: [{ text: 'a ship at sea' }], videoTitle: 'T', outDir: dir,
      width: 64, height: 64, seed: 1, generate, cacheDir,
    });
    await generateSceneImages({
      scenes: [{ text: 'a ship at sea' }], videoTitle: 'T', outDir: dir,
      width: 64, height: 64, seed: 2, generate, cacheDir, // different seed
    });
    expect(calls).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('stays off unless a cacheDir is given, so existing callers are unaffected', async () => {
    const dir = tmp();
    let calls = 0;
    const opts = {
      scenes: [{ text: 'no cache configured' }], videoTitle: 'T', outDir: dir,
      width: 64, height: 64,
      generate: async () => { calls++; return { base64: PNG_1PX }; },
    };
    await generateSceneImages(opts);
    await generateSceneImages(opts);
    expect(calls).toBe(2); // both real calls — no cache to hit
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a cache write failure does not turn a successful generation into a failed scene', async () => {
    const dir = tmp();
    // A file where the cache directory should be: mkdirSync on it throws,
    // and so does writing "<file>/<hash>.png" inside it.
    const notADir = path.join(tmp(), 'not-a-directory');
    fs.writeFileSync(notADir, 'x');
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }], videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: async () => ({ base64: PNG_1PX }),
      cacheDir: notADir,
    });
    expect(res[0].path).toBeTruthy();
    expect(fs.existsSync(res[0].path!)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(notADir, { force: true });
  });
});

describe('bounding how long one scene may take', () => {
  it('treats a hung generator as a failure once the timeout elapses, not forever', async () => {
    const dir = tmp();
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }], videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: () => new Promise(() => {}), // never resolves
      timeoutMs: 20,
    });
    expect(res[0].path).toBeNull();
    expect(res[0].error).toMatch(/timed out/);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 10_000);

  it('does not penalize a generator that answers well inside the timeout', async () => {
    const dir = tmp();
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }], videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: async () => ({ base64: PNG_1PX }),
      timeoutMs: 5_000,
    });
    expect(res[0].path).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('can be disabled with timeoutMs: 0, for callers that manage their own', async () => {
    const dir = tmp();
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }], videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: async () => ({ base64: PNG_1PX }),
      timeoutMs: 0,
    });
    expect(res[0].path).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('filling the gaps', () => {
  it('holds the previous picture rather than cutting to black', () => {
    const filled = fillMissingImages([
      { index: 0, path: 'a.png' },
      { index: 1, path: null },
      { index: 2, path: 'c.png' },
    ]);
    expect(filled).toEqual(['a.png', 'a.png', 'c.png']);
  });

  it('back-fills scenes before the first success', () => {
    const filled = fillMissingImages([
      { index: 0, path: null },
      { index: 1, path: 'b.png' },
    ]);
    expect(filled).toEqual(['b.png', 'b.png']);
  });

  it('gives up honestly when nothing generated', () => {
    // All null tells the renderer to use the flat backdrop, which still
    // produces a watchable video with the narration and captions.
    expect(fillMissingImages([{ index: 0, path: null }, { index: 1, path: null }]))
      .toEqual([null, null]);
  });
});

describe('retrying what failed', () => {
  // The free backends are flaky, and Pollinations holds a shared five-minute
  // backoff after any failure — one unlucky request took the rest of the batch
  // with it, producing a "multi-scene" video with a single picture in it.
  beforeAll(() => { process.env.HOMEBOT_SCENE_RETRY_GAP_MS = '1'; });

  it('gives a failed scene a second chance', async () => {
    const dir = tmp();
    let call = 0;
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }, { text: 'b' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64,
      // Everything fails first time round; the retry pass succeeds.
      generate: async () => (++call <= 2 ? null : { base64: PNG_1PX }),
    });
    expect(res.every(r => !!r.path)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('retries only once, so a dead backend cannot stall a render', async () => {
    const dir = tmp();
    let call = 0;
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: async () => { call++; return null; },
    });
    // 3 scenes + 3 retries, and then it stops.
    expect(call).toBe(6);
    expect(res.every(r => !r.path)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * A video should look like one video.
 *
 * Each scene is generated independently, so with a random seed the same
 * subject came back as a visibly different thing shot to shot — one tall
 * ship, then another tall ship. Holding the seed and the style anchor
 * constant across a video pins composition and palette; the scene text still
 * supplies what changes.
 */
describe('keeping the scenes of one video consistent', () => {
  const { seedForVideo } = require('../media-visuals');

  it('gives every scene of a video the same seed', async () => {
    const dir = tmp();
    const seen: Array<number | undefined> = [];
    await generateSceneImages({
      scenes: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64, seed: 4242,
      generate: async (_p, _w, _h, seed) => { seen.push(seed); return { base64: PNG_1PX }; },
    });
    expect(seen).toEqual([4242, 4242, 4242]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is stable for one video and different between videos', () => {
    // Stable so a re-render reproduces the look rather than rolling fresh
    // visuals; different so two videos are not twins.
    expect(seedForVideo('media_123')).toBe(seedForVideo('media_123'));
    expect(seedForVideo('media_123')).not.toBe(seedForVideo('media_124'));
  });

  it('produces a seed the backends will accept', () => {
    for (const id of ['media_1', 'media_999999', 'x', '']) {
      const s = seedForVideo(id);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1_000_000_000);
    }
  });

  it('pins medium, light and palette in the default look', () => {
    const p = buildScenePrompt('a storm at sea', 'Jonah');
    expect(p).toMatch(/cinematic|painting/i);
    expect(p).toMatch(/lighting/i);
    expect(p).toMatch(/palette/i);
  });
});

describe('synthesizing fallback plates when generation fails or times out', () => {
  it('generates fallback plates when generator fails with fallbackPlates enabled', async () => {
    const dir = tmp();
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }, { text: 'b' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: async () => null,
      fallbackPlates: true,
    });
    expect(res.every(r => !!r.path)).toBe(true);
    for (const r of res) {
      expect(r.source).toBe('fallback-plate');
      expect(fs.existsSync(r.path!)).toBe(true);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('generates fallback plates when generator times out with fallbackPlates enabled', async () => {
    const dir = tmp();
    const res = await generateSceneImages({
      scenes: [{ text: 'a' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: () => new Promise(r => setTimeout(r, 200)),
      timeoutMs: 30,
      fallbackPlates: true,
    });
    expect(res[0].path).toBeTruthy();
    expect(res[0].source).toBe('fallback-plate');
    expect(fs.existsSync(res[0].path!)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('parallelising scene generations', () => {
  it('runs multiple scene generations concurrently', async () => {
    const dir = tmp();
    let inFlight = 0;
    let maxInFlight = 0;
    await generateSceneImages({
      scenes: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64,
      generate: async () => {
        inFlight++;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await new Promise(r => setTimeout(r, 20));
        inFlight--;
        return { base64: PNG_1PX };
      },
    });
    expect(maxInFlight).toBeGreaterThan(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serializes scene generations when concurrency: 1 is explicitly passed', async () => {
    const dir = tmp();
    let inFlight = 0;
    let maxInFlight = 0;
    await generateSceneImages({
      scenes: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
      videoTitle: 'T', outDir: dir, width: 64, height: 64,
      concurrency: 1,
      generate: async () => {
        inFlight++;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await new Promise(r => setTimeout(r, 20));
        inFlight--;
        return { base64: PNG_1PX };
      },
    });
    expect(maxInFlight).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detects local sd-cpp installation presence via hasLocalSDCpp', async () => {
    const { hasLocalSDCpp } = require('../media-visuals');
    expect(typeof (await hasLocalSDCpp())).toBe('boolean');
  });
});

