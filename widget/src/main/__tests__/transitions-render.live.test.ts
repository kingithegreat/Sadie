/**
 * OPT-IN (HOMEBOT_LIVE=1): render a real movie with a crossfade and look at it.
 *
 *   cd widget && npx cross-env HOMEBOT_LIVE=1 npx jest transitions-render.live
 *
 * MS-2's acceptance: a render with a crossfade has the expected total duration
 * and blended frames at the boundary. Two flat-colour shots make the blend
 * unambiguous — at the middle of a red-to-blue dissolve the frame must be
 * neither red nor blue.
 */

import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { renderStoryboardMovie } from '../movie/storyboard-renderer';
import { findFfmpeg } from '../media-render';

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

jest.setTimeout(300_000);

/** Average colour of a frame taken at `seconds`. */
async function frameColour(ffmpeg: string, movie: string, seconds: number, dir: string) {
  const file = path.join(dir, `at-${seconds}.png`);
  execFileSync(ffmpeg, ['-y', '-ss', String(seconds), '-i', movie, '-frames:v', '1', file], { stdio: 'pipe' });
  const { channels } = await sharp(file).stats();
  return { r: channels[0]!.mean, g: channels[1]!.mean, b: channels[2]!.mean };
}

function probeDuration(ffmpeg: string, movie: string): number {
  // ffmpeg, not ffprobe: the managed install may not ship the second binary.
  // Progress goes to STDERR, so spawnSync — execFileSync returns stdout only.
  const run = spawnSync(ffmpeg, ['-i', movie, '-f', 'null', '-'], { encoding: 'utf-8' });
  const text = `${run.stderr || ''}${run.stdout || ''}`;
  const match = text.match(/time=(\d+):(\d+):([\d.]+)/g);
  const last = match?.[match.length - 1]?.match(/time=(\d+):(\d+):([\d.]+)/);
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : NaN;
}

maybe('a rendered crossfade', () => {
  const priorRoot = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
  let root: string;

  const makeProject = (transition: string) => {
    const scene = path.join(root, 'fade-check', 'scenes', 'scene_01');
    fs.mkdirSync(scene, { recursive: true });
    fs.writeFileSync(path.join(scene, 'scene.json'), JSON.stringify({ sceneId: 'scene_01', shots: ['shot_001', 'shot_002'] }));
    // Textured, not flat: the renderer rejects a flat-colour export as a
    // placeholder (and rightly so), but the tint still says which shot it is.
    const tints: Array<[number, number, number]> = [[220, 40, 40], [40, 40, 220]];
    return Promise.all(tints.map(async (tint, index) => {
      const shotDir = path.join(scene, `shot_00${index + 1}`);
      fs.mkdirSync(path.join(shotDir, 'image'), { recursive: true });
      const frame = path.join(shotDir, 'image', 'frame.png');
      const pixels = Buffer.alloc(1920 * 1080 * 3);
      for (let i = 0; i < 1920 * 1080; i++) {
        const shade = (i % 97) / 97;
        pixels[i * 3] = Math.round(tint[0] * (0.55 + 0.45 * shade));
        pixels[i * 3 + 1] = Math.round(tint[1] * (0.55 + 0.45 * shade));
        pixels[i * 3 + 2] = Math.round(tint[2] * (0.55 + 0.45 * shade));
      }
      await sharp(pixels, { raw: { width: 1920, height: 1080, channels: 3 } }).png().toFile(frame);
      fs.writeFileSync(path.join(shotDir, 'prompt.json'), JSON.stringify({
        prompt: `Textured tint ${index + 1}`, framing: 'wide', lens: '24mm', movement: 'static', durationSec: 3,
        ...(index === 0 ? { transition, transitionSec: 1 } : {}),
      }));
      fs.writeFileSync(path.join(shotDir, 'script.txt'), '');
    }));
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-fade-'));
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = root;
  });
  afterEach(() => {
    if (priorRoot === undefined) delete process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
    else process.env.HOMEBOT_MOVIE_PROJECTS_DIR = priorRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('is one second shorter than the shots, and the frames really blend', async () => {
    const ffmpeg = (await findFfmpeg())!;
    expect(ffmpeg).toBeTruthy();
    await makeProject('crossfade');

    const result = await renderStoryboardMovie({ projectId: 'fade-check', motion: false, burnSubtitles: false });
    expect(result.error).toBeUndefined();
    const movie = result.moviePath!;
    expect(fs.existsSync(movie)).toBe(true);

    // 3s + 3s with a 1s dissolve = 5s.
    expect(probeDuration(ffmpeg, movie)).toBeCloseTo(5, 1);

    const dir = path.join(root, 'frames');
    fs.mkdirSync(dir, { recursive: true });
    const start = await frameColour(ffmpeg, movie, 0.5, dir);
    const middle = await frameColour(ffmpeg, movie, 2.5, dir);
    const end = await frameColour(ffmpeg, movie, 4.5, dir);

    // Ends are the shots themselves.
    expect(start.r).toBeGreaterThan(150);
    expect(start.b).toBeLessThan(80);
    expect(end.b).toBeGreaterThan(150);
    expect(end.r).toBeLessThan(80);
    // The middle of the dissolve carries both, which a cut never would.
    expect(middle.r).toBeGreaterThan(40);
    expect(middle.b).toBeGreaterThan(40);
  });

  it('a cut between the same shots keeps the full length and never blends', async () => {
    const ffmpeg = (await findFfmpeg())!;
    await makeProject('cut');
    const result = await renderStoryboardMovie({ projectId: 'fade-check', motion: false, burnSubtitles: false });
    expect(result.error).toBeUndefined();
    expect(probeDuration(ffmpeg, result.moviePath!)).toBeCloseTo(6, 1);

    const dir = path.join(root, 'frames-cut');
    fs.mkdirSync(dir, { recursive: true });
    const middle = await frameColour(ffmpeg, result.moviePath!, 2.9, dir);
    expect(Math.min(middle.r, middle.b)).toBeLessThan(40);
  });
});
