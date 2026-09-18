/**
 * OPT-IN (HOMEBOT_LIVE=1): measure the judder in a slow camera move.
 *
 *   cd widget && npx cross-env HOMEBOT_LIVE=1 npx jest motion-smoothness.live
 *
 * MS-8's acceptance is an A/B on the same shot. zoompan computes its crop
 * offset in whole pixels of its input, so a 1.5 px/frame pan lands on 1 px for
 * one frame and 2 px for the next — the pan is not moving at a constant speed,
 * which is what reads as judder. Supersampling the frame first makes the step a
 * quarter of an output pixel (storyboard-renderer.ts MOTION_SUPERSAMPLE).
 *
 * The measurement: pan across a left-to-right brightness ramp and take the mean
 * brightness of every frame. On a ramp, mean brightness is a straight function
 * of how far the crop has travelled, so the frame-to-frame differences ARE the
 * per-frame motion. Even steps mean even motion.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { buildKenBurnsFilter, MOTION_SUPERSAMPLE } from '../movie/storyboard-renderer';
import { findFfmpeg } from '../media-render';

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

jest.setTimeout(300_000);

const WIDTH = 1920, HEIGHT = 1080, FPS = 30, SECONDS = 2;

/** A smooth left-to-right ramp: mean brightness says where the crop is. */
async function rampImage(file: string): Promise<void> {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const value = Math.round(20 + 200 * (x / (WIDTH - 1)));
      const at = (y * WIDTH + x) * 3;
      pixels[at] = value; pixels[at + 1] = value; pixels[at + 2] = value;
    }
  }
  await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(file);
}

/** Per-frame mean brightness of the filtered frames, in order. */
async function frameBrightness(dir: string): Promise<number[]> {
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.png')).sort();
  const means: number[] = [];
  for (const name of files) {
    const { channels } = await sharp(path.join(dir, name)).stats();
    means.push(channels[0]!.mean);
  }
  return means;
}

/** How uneven the steps are: 0 is perfectly even motion. */
function judder(values: number[]): number {
  const steps = values.slice(1).map((value, index) => value - values[index]!);
  const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
  const variance = steps.reduce((sum, step) => sum + (step - mean) ** 2, 0) / steps.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

maybe('a slow pan', () => {
  it('moves evenly with supersampling, and visibly unevenly without it — A/B', async () => {
    const ffmpeg = (await findFfmpeg())!;
    expect(ffmpeg).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-motion-'));
    try {
      const image = path.join(dir, 'ramp.png');
      await rampImage(image);

      const smooth = buildKenBurnsFilter('pan right', SECONDS, FPS);
      expect(smooth).toContain(`scale=iw*${MOTION_SUPERSAMPLE}:ih*${MOTION_SUPERSAMPLE}`);
      // The pan exactly as it was before MS-8, written out rather than patched
      // from the new one: no supersample, and each frame adds to the last.
      const frames = SECONDS * FPS;
      const stepped = `zoompan=z='1.15':x='if(lte(on,1),(iw-iw/zoom)/2,min(x+1.5,iw-iw/zoom))'`
        + `:y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`;

      // PNG frames, not an encoded clip: at 1.5 px per frame the brightness
      // change is ~0.16 of a level, and h264 noise alone is bigger than that.
      // The first attempt measured the codec instead of the motion.
      const render = (filter: string, name: string) => {
        const frames = path.join(dir, name);
        fs.mkdirSync(frames, { recursive: true });
        const started = Date.now();
        execFileSync(ffmpeg, ['-y', '-loop', '1', '-i', image, '-vf', filter,
          '-frames:v', String(SECONDS * FPS), '-r', String(FPS), path.join(frames, 'f%04d.png')], { stdio: 'pipe' });
        return { frames, seconds: (Date.now() - started) / 1000 };
      };

      const before = render(stepped, 'stepped');
      const after = render(smooth, 'smooth');

      const steppedJudder = judder(await frameBrightness(before.frames));
      const smoothJudder = judder(await frameBrightness(after.frames));

      // Recorded for the plan's "render-time cost" requirement.
      console.log(`[MS-8] judder stepped=${steppedJudder.toFixed(3)} smooth=${smoothJudder.toFixed(3)} · ` +
        `render ${before.seconds.toFixed(1)}s -> ${after.seconds.toFixed(1)}s (${(after.seconds / before.seconds).toFixed(1)}x) ` +
        `for ${SECONDS}s at ${WIDTH}x${HEIGHT}`);

      // The old path steps unevenly; the new one is even to within a rounding
      // error (measured 0.639 -> 0.004 on this machine).
      expect(steppedJudder).toBeGreaterThan(0.2);
      expect(smoothJudder).toBeLessThan(0.05);
      expect(smoothJudder).toBeLessThan(steppedJudder / 5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
