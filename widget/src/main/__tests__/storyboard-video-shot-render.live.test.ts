/**
 * PROV-4 done-when, measured: a 3-shot render where the middle shot is a video
 * clip has the correct total duration and moving content in that shot.
 *
 * OPT-IN, real ffmpeg. Skipped unless HOMEBOT_LIVE=1 and an ffmpeg is
 * reachable (PATH or HOMEBOT_FFMPEG). The "Veo clip" is a real local MP4 with
 * strong motion (testsrc2); the live paid Veo request itself is Aden's.
 *
 *   cd widget
 *   npx cross-env HOMEBOT_LIVE=1 HOMEBOT_FFMPEG=C:\ffmpeg\bin\ffmpeg.exe \
 *     npx jest storyboard-video-shot-render.live
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

jest.setTimeout(60_000);

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}: ${stderr}`)); else resolve({ stdout, stderr });
    });
  });
}

let root = '';
let ffmpeg = '';
// eslint-disable-next-line

beforeAll(async () => {
  const { findManagedFfmpeg } = await import('../ffmpeg-setup');
  const { findFfmpeg } = await import('../media-render');
  ffmpeg = (await findFfmpeg(findManagedFfmpeg())) ?? '';
  if (!ffmpeg) throw new Error('No ffmpeg found. Set HOMEBOT_FFMPEG or install it, or run without HOMEBOT_LIVE=1.');
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-shot-live-'));
  process.env.HOMEBOT_MOVIE_PROJECTS_DIR = root;
});
afterAll(() => {
  delete process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function flatPng(color: string, size: string, file: string) {
  return run(ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:d=1`, '-frames:v', '1', file]);
}

/** Extracts one frame at t from an mp4 into a PNG. */
function extractFrame(video: string, t: number, file: string) {
  return run(ffmpeg, ['-y', '-ss', String(t), '-i', video, '-frames:v', '1', file]);
}

/** Mean absolute difference between two PNGs, via ffmpeg PSNR/SSIM on a null muxer. */
async function frameDifference(a: string, b: string): Promise<number> {
  const { stderr } = await run(ffmpeg, ['-i', a, '-i', b, '-filter_complex', 'psnr', '-f', 'null', '-']);
  const match = /average:([0-9.]+|inf)/.exec(stderr);
  if (!match) throw new Error(`No PSNR in ffmpeg output: ${stderr.slice(-300)}`);
  return match[1] === 'inf' ? 0 : Number(match[1]);
}

maybe('storyboard video shots reach the export (PROV-4)', () => {
  test('a 3-shot render with one Veo clip keeps its duration and shows moving content in that shot', async () => {
    const projectDir = path.join(root, 'veo-live');
    const scenes = path.join(projectDir, 'scenes', 'scene_01');

    const still1 = path.join(scenes, 'shot_001', 'image', 'shot_001.png');
    const still3 = path.join(scenes, 'shot_003', 'image', 'shot_003.png');
    fs.mkdirSync(path.join(scenes, 'shot_001', 'image'), { recursive: true });
    fs.mkdirSync(path.join(scenes, 'shot_003', 'image'), { recursive: true });
    fs.mkdirSync(path.join(scenes, 'shot_001', 'image'), { recursive: true });
    fs.mkdirSync(path.join(scenes, 'shot_003', 'image'), { recursive: true });
    await flatPng('0x202040', '640x360', still1);
    await flatPng('0x402020', '640x360', still3);

    // The stand-in for a paid Veo 3.1 clip: real moving content.
    fs.mkdirSync(path.join(scenes, 'shot_002', 'video'), { recursive: true });
    const clip = path.join(scenes, 'shot_002', 'video', 'shot_002.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);

    for (const n of ['shot_001', 'shot_002', 'shot_003']) {
      writeJson(path.join(scenes, n, 'prompt.json'), { prompt: `Scene ${n}`, durationSec: 1, framing: 'wide' });
    }
    writeJson(path.join(scenes, 'scene.json'), { sceneId: 'scene_01', shots: ['shot_001', 'shot_002', 'shot_003'] });
    writeJson(path.join(projectDir, 'project.json'), { projectId: 'veo-live', name: 'Veo live', burnSubtitles: false });

    const { renderStoryboardMovie } = await import('../movie/storyboard-renderer');
    const res = await renderStoryboardMovie({ projectId: 'veo-live', motion: false });
    if (!res.ok) console.error('RENDER_FAIL:', res.error);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    expect(res.moviePath).toBeTruthy();

    // Correct total duration: 3 shots x 1s, measured from the file.
    const { inspectRender } = await import('../media-qa');
    const facts = await inspectRender(ffmpeg, res.moviePath!);
    expect(facts.hasVideo).toBe(true);
    expect(facts.durationSeconds ?? 0).toBeGreaterThan(2.85);
    expect(facts.durationSeconds ?? 99).toBeLessThan(3.15);

    // Moving content in the video shot, measured: two frames inside the
    // clip's window (1s..2s) must differ clearly. The still shots must NOT
    // (flat image, motion off) — that makes the assertion two-sided.
    const f1a = path.join(root, 'f1a.png'); const f1b = path.join(root, 'f1b.png');
    const f2a = path.join(root, 'f2a.png'); const f2b = path.join(root, 'f2b.png');
    const f3a = path.join(root, 'f3a.png'); const f3b = path.join(root, 'f3b.png');
    await extractFrame(res.moviePath!, 0.30, f1a);
    await extractFrame(res.moviePath!, 0.70, f1b);
    await extractFrame(res.moviePath!, 1.30, f2a);
    await extractFrame(res.moviePath!, 1.70, f2b);
    await extractFrame(res.moviePath!, 2.30, f3a);
    await extractFrame(res.moviePath!, 2.70, f3b);
    const still1Diff = await frameDifference(f1a, f1b);
    const clipDiff = await frameDifference(f2a, f2b);
    const still3Diff = await frameDifference(f3a, f3b);
    // High PSNR = nearly-identical frames (the stills); the moving clip's
    // frames are genuinely different pictures (low PSNR). Asserting the clip
    // against both neighbours makes "moving content in that shot" measured,
    // not assumed.
    expect(clipDiff).toBeGreaterThan(15);
    expect(clipDiff).toBeGreaterThan(still1Diff);
    expect(clipDiff).toBeGreaterThan(still3Diff);
  });
});
