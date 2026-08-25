/**
 * The real download, into the real place the app looks.
 *
 * OPT-IN. Skipped unless HOMEBOT_LIVE=1:
 *
 *   npx cross-env HOMEBOT_LIVE=1 npx jest --config=jest.config.ts \
 *     --testPathPattern=ffmpeg-setup.live --runInBand
 *
 * Every other test of this feature injects the network and the filesystem, so
 * all of them would still pass if the real release moved, the real zip nested
 * differently, or the binary refused to run on this machine. That is exactly
 * how the sd.cpp setup shipped already broken three ways — its unit tests were
 * green throughout, because upstream drift is invisible to a fixture.
 *
 * This one downloads ~161 MB from GitHub, unpacks it, runs it, and then asks
 * the question that actually matters: does `findFfmpeg` — the function the
 * render stage calls — return it? A setup that installs an engine the renderer
 * cannot see has changed nothing.
 */

import * as fs from 'fs';
import { execFile } from 'child_process';
import { runFfmpegSetup, findManagedFfmpeg, getFfmpegDir } from '../ffmpeg-setup';
import { findFfmpeg } from '../media-render';

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

const run = (bin: string, args: string[]) =>
  new Promise<{ code: number; out: string }>((resolve) => {
    execFile(bin, args, { timeout: 120_000, maxBuffer: 1024 * 1024 * 8 }, (err, stdout, stderr) => {
      resolve({ code: err ? 1 : 0, out: `${stdout}${stderr}` });
    });
  });

maybe('ffmpeg setup, for real', () => {
  jest.setTimeout(20 * 60_000);

  let installed = '';

  test('downloads and unpacks into the directory the app reads', async () => {
    const dir = getFfmpegDir();
    // eslint-disable-next-line no-console
    console.log('[LIVE] installing into', dir);

    const phases: string[] = [];
    installed = await runFfmpegSetup((p) => {
      const line = p.receivedMB != null && p.totalMB
        ? `${p.phase}: ${p.note} ${p.receivedMB}/${p.totalMB} MB`
        : `${p.phase}: ${p.note}`;
      if (phases[phases.length - 1] !== p.phase) console.log('[LIVE]', line);
      phases.push(p.phase);
    });

    expect(fs.existsSync(installed)).toBe(true);
    expect(findManagedFfmpeg(dir)).toBe(installed);
    console.log('[LIVE] installed at', installed,
      Math.round(fs.statSync(installed).size / 1048576), 'MB');
  });

  test('the binary actually runs, and carries the codec the renderer needs', async () => {
    const version = await run(installed, ['-version']);
    expect(version.code).toBe(0);
    console.log('[LIVE]', version.out.split('\n')[0]);

    // media-render.ts passes `-c:v libx264`. An LGPL build would reach this
    // point and fail here — which is the whole reason the picker demands GPL.
    const encoders = await run(installed, ['-hide_banner', '-encoders']);
    expect(encoders.out).toMatch(/\blibx264\b/);
    expect(encoders.out).toMatch(/\baac\b/);
  });

  test('the render stage can find it — the wiring, not the download', async () => {
    // This is the assertion the whole feature turns on. findFfmpeg is what
    // tools/media.ts calls; if it cannot see the managed copy, "Set it up for
    // me" succeeds and rendering still reports the engine missing.
    const found = await findFfmpeg(findManagedFfmpeg());
    expect(found).toBe(installed);
  });

  test('running setup again is a no-op, not a second 161 MB download', async () => {
    const started = Date.now();
    const again = await runFfmpegSetup(() => {});
    expect(again).toBe(installed);
    // Anything near a real download would be minutes, not seconds.
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});
