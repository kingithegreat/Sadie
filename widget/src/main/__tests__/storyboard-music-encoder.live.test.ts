/**
 * OPT-IN (HOMEBOT_LIVE=1): prove MS-4 music ducking and MS-9 encoder
 * selection with real FFmpeg processes and real output files.
 *
 *   cd widget && npx cross-env HOMEBOT_LIVE=1 HOMEBOT_KEEP_LIVE_ARTIFACTS=1 \
 *     npx jest storyboard-music-encoder.live --runInBand
 */

import { execFileSync, spawnSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { findFfmpeg, renderVideo } from '../media-render';
import { inspectRender } from '../media-qa';
import {
  renderStoryboardMovie,
  resetNvencProbeCache,
  resolveVideoEncoder,
} from '../movie/storyboard-renderer';

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

jest.setTimeout(300_000);

function run(ffmpeg: string, args: string[]) {
  execFileSync(ffmpeg, args, { stdio: 'pipe' });
}

function meanVolumeInBand(ffmpeg: string, movie: string, start: number, duration: number): number {
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-ss', String(start), '-t', String(duration), '-i', movie,
    '-vn', '-af', 'bandpass=f=220:w=30,volumedetect', '-f', 'null', '-',
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `FFmpeg exited ${result.status}`);
  const match = `${result.stderr || ''}${result.stdout || ''}`.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  if (!match) throw new Error('FFmpeg did not report mean_volume for the sampled music band.');
  return Number(match[1]);
}

maybe('MS-4/MS-9 real storyboard acceptance', () => {
  const priorRoot = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
  let root: string;
  let ffmpeg: string;
  let projectDir: string;
  const narration = 'Controlled narration tone.';
  const engine = 'edge';

  beforeAll(async () => {
    ffmpeg = (await findFfmpeg())!;
    expect(ffmpeg).toBeTruthy();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ms49-live-'));
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = root;
    projectDir = path.join(root, 'music-encoder', 'scenes', 'scene_01');
    const shotDir = path.join(projectDir, 'shot_001');
    fs.mkdirSync(path.join(shotDir, 'image'), { recursive: true });

    const pixels = Buffer.alloc(1920 * 1080 * 3);
    for (let i = 0; i < 1920 * 1080; i++) {
      const x = i % 1920;
      const y = Math.floor(i / 1920);
      pixels[i * 3] = Math.round(30 + 190 * x / 1919);
      pixels[i * 3 + 1] = Math.round(25 + 170 * y / 1079);
      pixels[i * 3 + 2] = (x + y) % 180;
    }
    await sharp(pixels, { raw: { width: 1920, height: 1080, channels: 3 } })
      .png().toFile(path.join(shotDir, 'image', 'frame.png'));
    fs.writeFileSync(path.join(projectDir, 'scene.json'), JSON.stringify({ sceneId: 'scene_01', shots: ['shot_001'] }));
    fs.writeFileSync(path.join(shotDir, 'prompt.json'), JSON.stringify({
      prompt: 'Controlled textured gradient', framing: 'wide', lens: '24mm', movement: 'static', durationSec: 4,
    }));
    fs.writeFileSync(path.join(shotDir, 'script.txt'), narration);

    const projectRoot = path.dirname(path.dirname(projectDir));
    fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify({
      projectId: 'music-encoder', title: 'MS-4/MS-9 live acceptance', musicEnabled: true, musicVolume: 0.22,
    }));

    const cacheDir = path.join(projectRoot, 'renders', '.homebot-narration');
    fs.mkdirSync(cacheDir, { recursive: true });
    const key = createHash('sha256').update(JSON.stringify({
      schema: 'storyboard-narration-1', text: narration, engine, voice: 'adapter-default',
    })).digest('hex');
    const filename = `${key}-${randomUUID()}.wav`;
    const cachedNarration = path.join(cacheDir, filename);
    run(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1.2:sample_rate=48000',
      // FFmpeg's sine source peaks at about -18 dBFS. Leave it there: that is
      // representative of audible narration and safely above the compressor's
      // -30.5 dBFS side-chain threshold.
      '-ac', '2', '-c:a', 'pcm_s16le', cachedNarration,
    ]);
    fs.writeFileSync(path.join(cacheDir, `${key}.json`), JSON.stringify({
      key, filename,
      sha256: createHash('sha256').update(fs.readFileSync(cachedNarration)).digest('hex'),
      engine,
    }));

    const music = path.join(projectRoot, 'controlled-music.wav');
    run(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4:sample_rate=48000',
      '-af', 'volume=0.40', '-ac', '2', '-c:a', 'pcm_s16le', music,
    ]);
  });

  afterAll(() => {
    if (priorRoot === undefined) delete process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
    else process.env.HOMEBOT_MOVIE_PROJECTS_DIR = priorRoot;
    if (process.env.HOMEBOT_KEEP_LIVE_ARTIFACTS === '1') {
      console.info(`[MS-4/MS-9] kept artifacts at ${root}`);
    } else {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('ducks without clipping, passes media QA, renders both encoders, and falls back after a forced probe failure', async () => {
    const projectRoot = path.dirname(path.dirname(projectDir));
    const music = path.join(projectRoot, 'controlled-music.wav');

    const cpuStarted = performance.now();
    const cpu = await renderStoryboardMovie({
      projectId: 'music-encoder', motion: false, burnSubtitles: false,
      narrationEngine: engine as 'edge', music, musicVolume: 0.22,
      encoder: 'cpu', outputName: 'cpu.mp4',
    });
    const cpuMs = performance.now() - cpuStarted;
    expect(cpu).toMatchObject({ ok: true });

    resetNvencProbeCache();
    await expect(resolveVideoEncoder(ffmpeg, 'nvenc')).resolves.toMatchObject({
      encoder: 'h264_nvenc', fellBack: false,
    });
    const nvencStarted = performance.now();
    const nvenc = await renderStoryboardMovie({
      projectId: 'music-encoder', motion: false, burnSubtitles: false,
      narrationEngine: engine as 'edge', music, musicVolume: 0.22,
      encoder: 'nvenc', outputName: 'nvenc.mp4',
    });
    const nvencMs = performance.now() - nvencStarted;
    expect(nvenc).toMatchObject({ ok: true });

    const cpuFacts = await inspectRender(ffmpeg, cpu.moviePath!);
    const nvencFacts = await inspectRender(ffmpeg, nvenc.moviePath!);
    for (const facts of [cpuFacts, nvencFacts]) {
      expect(facts).toMatchObject({ hasVideo: true, hasAudio: true, width: 1920, height: 1080 });
      expect(facts.durationSeconds).toBeCloseTo(4, 1);
      expect(facts.maxVolumeDb).not.toBeNull();
      expect(facts.maxVolumeDb!).toBeLessThan(-0.1);
      expect(Math.max(...facts.frameSamples!.map(sample => sample.stdDev))).toBeGreaterThan(3);
    }

    // The primary job pipeline calls this same function without an override,
    // so its default must actually route through the successfully probed GPU.
    const jobOutput = path.join(projectRoot, 'job-auto.mp4');
    const narrationCache = fs.readdirSync(path.join(projectRoot, 'renders', '.homebot-narration'))
      .find(name => name.endsWith('.wav'))!;
    const jobRender = await renderVideo({
      ffmpeg,
      audioPath: path.join(projectRoot, 'renders', '.homebot-narration', narrationCache),
      outputPath: jobOutput,
      shape: 'long', imagePath: path.join(projectDir, 'shot_001', 'image', 'frame.png'),
      durationSeconds: 1.2, musicPath: music, loudnormStats: false,
    });
    expect(jobRender.videoEncoder).toBe('h264_nvenc');
    await expect(inspectRender(ffmpeg, jobOutput)).resolves.toMatchObject({
      hasVideo: true, hasAudio: true, width: 1920, height: 1080,
    });

    const musicUnderNarrationDb = meanVolumeInBand(ffmpeg, cpu.moviePath!, 0.15, 0.75);
    const musicWithoutNarrationDb = meanVolumeInBand(ffmpeg, cpu.moviePath!, 2.25, 0.75);
    const attenuationDb = musicWithoutNarrationDb - musicUnderNarrationDb;
    expect(attenuationDb).toBeGreaterThan(3);

    resetNvencProbeCache();
    await expect(resolveVideoEncoder(path.join(root, 'forced-missing-ffmpeg.exe'), 'nvenc')).resolves.toMatchObject({
      encoder: 'libx264', fellBack: true,
      warning: expect.stringMatching(/CPU encoder/i),
    });

    console.info('[MS-4/MS-9] evidence', {
      cpuMs: Math.round(cpuMs), nvencMs: Math.round(nvencMs),
      musicUnderNarrationDb, musicWithoutNarrationDb, attenuationDb,
      cpuFacts, nvencFacts,
    });
  });
});
