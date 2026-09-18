/**
 * OPT-IN (HOMEBOT_LIVE=1): MS-6's acceptance — each Timeline control changes
 * the exported file, measured.
 *
 *   cd widget && npx cross-env HOMEBOT_LIVE=1 npx jest timeline-finish-render.live
 *
 * "A control that doesn't change the video is a bug for this goal." So every
 * one of them is spliced for real and then read back off the result: colour
 * from the pixels, volume from ffmpeg's own measurement, speed and transition
 * from the duration, mute from whether there is an audio stream at all.
 */

import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { buildTimelineFinishGraph, type TimelineFinish } from '../movie/timeline-finish';
import { findFfmpeg } from '../media-render';

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

jest.setTimeout(300_000);

const W = 640, H = 360, FPS = 30;

function probe(ffmpeg: string, file: string) {
  const run = spawnSync(ffmpeg, ['-i', file, '-f', 'null', '-'], { encoding: 'utf-8' });
  const text = `${run.stderr || ''}`;
  const times = text.match(/time=(\d+):(\d+):([\d.]+)/g) || [];
  const last = times[times.length - 1]?.match(/time=(\d+):(\d+):([\d.]+)/);
  const duration = last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : NaN;
  return { duration, hasAudio: /Stream #\d+:\d+.*Audio/.test(text) };
}

function meanVolumeDb(ffmpeg: string, file: string): number {
  const run = spawnSync(ffmpeg, ['-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf-8' });
  const match = `${run.stderr || ''}`.match(/mean_volume:\s*(-?[\d.]+) dB/);
  return match ? Number(match[1]) : NaN;
}

async function frameColour(ffmpeg: string, file: string, seconds: number, dir: string) {
  const out = path.join(dir, `f-${seconds}-${Math.random().toString(36).slice(2)}.png`);
  execFileSync(ffmpeg, ['-y', '-ss', String(seconds), '-i', file, '-frames:v', '1', out], { stdio: 'pipe' });
  const { channels } = await sharp(out).stats();
  return { r: channels[0]!.mean, g: channels[1]!.mean, b: channels[2]!.mean };
}

maybe('a finished timeline export', () => {
  let dir: string;
  let ffmpeg: string;
  let clips: string[];

  beforeAll(async () => {
    ffmpeg = (await findFfmpeg())!;
    expect(ffmpeg).toBeTruthy();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ms6-'));
    // Two 2s clips with sound: textured, so the placeholder gate elsewhere in
    // the app would accept them, and tinted, so a blend is unmistakable.
    clips = ['0x903030', '0x303090'].map((colour, index) => {
      const clip = path.join(dir, `clip${index}.mp4`);
      execFileSync(ffmpeg, ['-y',
        '-f', 'lavfi', '-i', `color=c=${colour}:s=${W}x${H}:d=2,noise=alls=12:allf=t`,
        '-f', 'lavfi', '-i', `sine=frequency=${300 + index * 200}:duration=2`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-r', String(FPS), clip], { stdio: 'pipe' });
      return clip;
    });
  });

  afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  const finish = (settings: TimelineFinish, name: string): string => {
    const graph = buildTimelineFinishGraph(clips.length, settings);
    const out = path.join(dir, name);
    const args = ['-y', ...clips.flatMap(clip => ['-i', clip]), '-filter_complex', graph.filter, '-map', graph.videoLabel];
    if (graph.audioLabel) args.push('-map', graph.audioLabel, '-c:a', 'aac', '-b:a', '192k');
    else args.push('-an');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
    if (graph.durationSec) args.push('-t', String(graph.durationSec));
    args.push(out);
    execFileSync(ffmpeg, args, { stdio: 'pipe' });
    return out;
  };

  it('joined with no settings: four seconds, sound, and the original colours', async () => {
    const out = finish({ volume: 0.999999 }, 'plain.mp4'); // a no-op finish, to exercise the same path
    const facts = probe(ffmpeg, out);
    expect(facts.duration).toBeCloseTo(4, 0);
    expect(facts.hasAudio).toBe(true);
    const first = await frameColour(ffmpeg, out, 0.5, dir);
    expect(first.r).toBeGreaterThan(first.b);
  });

  it('the colour grade changes the picture', async () => {
    const plain = await frameColour(ffmpeg, finish({ volume: 0.999999 }, 'plain2.mp4'), 0.5, dir);
    const warm = await frameColour(ffmpeg, finish({ colorGrade: 'warm_nile' }, 'warm.mp4'), 0.5, dir);
    const cold = await frameColour(ffmpeg, finish({ colorGrade: 'nocturne' }, 'cold.mp4'), 0.5, dir);
    // Warm Nile pushes red up against blue; Nocturne does not.
    expect(warm.r - warm.b).toBeGreaterThan(plain.r - plain.b + 5);
    expect(cold.r - cold.b).toBeLessThan(warm.r - warm.b);
  });

  it('master volume is quieter, and mute leaves no audio track at all', () => {
    const loud = meanVolumeDb(ffmpeg, finish({ volume: 1 , speed: 1.0000001 }, 'loud.mp4'));
    const quiet = meanVolumeDb(ffmpeg, finish({ volume: 0.25 }, 'quiet.mp4'));
    expect(quiet).toBeLessThan(loud - 6);

    const muted = finish({ mute: true }, 'muted.mp4');
    expect(probe(ffmpeg, muted).hasAudio).toBe(false);
  });

  it('speed changes how long the export runs', () => {
    expect(probe(ffmpeg, finish({ speed: 2 }, 'fast.mp4')).duration).toBeCloseTo(2, 0);
    expect(probe(ffmpeg, finish({ speed: 0.5 }, 'slow.mp4')).duration).toBeCloseTo(8, 0);
  });

  it('a cross dissolve shortens the export and blends the two clips', async () => {
    const out = finish({ transition: 'crossfade', transitionSec: 1, clipDurations: [2, 2] }, 'dissolve.mp4');
    expect(probe(ffmpeg, out).duration).toBeCloseTo(3, 0);
    // Mid-dissolve both tints are present; a cut would show only one.
    const middle = await frameColour(ffmpeg, out, 1.5, dir);
    expect(Math.min(middle.r, middle.b)).toBeGreaterThan(30);
    expect(Math.abs(middle.r - middle.b)).toBeLessThan(35);
  });
});
