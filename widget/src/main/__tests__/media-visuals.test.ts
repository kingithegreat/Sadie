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
