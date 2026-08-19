/**
 * One-click video engine setup.
 *
 * Media Studio could write a script, record narration and cut captions, then
 * stopped dead at rendering with "on Windows: winget install Gyan.FFmpeg" —
 * a package manager, aimed at the user the product explicitly says is not
 * technical. This is the sd.cpp answer applied to the last manual dependency.
 *
 * Two things are pinned here that have each already cost a session:
 *
 *   - THE PICKER RUNS AGAINST THE REAL ASSET LIST. The fixture below is the
 *     actual output of BtbN/FFmpeg-Builds' latest release, probed live while
 *     writing this. The sd.cpp setup shipped against remembered asset names and
 *     was broken three ways by upstream drift before anyone ran it.
 *   - THE DOWNLOAD HAS TO REACH RENDERING. A managed ffmpeg lands in userData,
 *     not on PATH, so `findFfmpeg` has to be handed it. If it is not, setup
 *     succeeds and rendering still reports the engine missing — the exact
 *     "capability exists, nothing calls it" failure this codebase keeps hitting.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  pickFfmpegAsset,
  runFfmpegSetup,
  findManagedFfmpeg,
  type FfmpegSetupIO,
  type ReleaseAsset,
} from '../ffmpeg-setup';
import { findFfmpeg } from '../media-render';

/** Real asset names from the BtbN/FFmpeg-Builds `latest` release. */
const REAL_ASSETS: ReleaseAsset[] = [
  ['ffmpeg-master-latest-win64-gpl-shared.zip', 77],
  ['ffmpeg-master-latest-win64-gpl.zip', 171],
  ['ffmpeg-master-latest-win64-lgpl-shared.zip', 68],
  ['ffmpeg-master-latest-win64-lgpl.zip', 148],
  ['ffmpeg-n8.1-latest-win64-gpl-8.1.zip', 168],
  ['ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip', 80],
  ['ffmpeg-n8.1-latest-win64-lgpl-8.1.zip', 146],
  ['ffmpeg-n9.0-latest-win64-gpl-9.0.zip', 169],
  ['ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip', 76],
  ['ffmpeg-n9.0-latest-win64-lgpl-9.0.zip', 147],
  ['ffmpeg-master-latest-linux64-gpl.tar.xz', 100],
].map(([name, mb]) => ({
  name: name as string,
  browser_download_url: `https://example.invalid/${name}`,
  size: (mb as number) * 1048576,
}));

describe('choosing the build', () => {
  test('picks the newest static GPL win64 zip from the real asset list', () => {
    const picked = pickFfmpegAsset(REAL_ASSETS);
    expect(picked?.name).toBe('ffmpeg-n9.0-latest-win64-gpl-9.0.zip');
  });

  test('never picks LGPL — the renderer asks for libx264, which LGPL lacks', () => {
    // An LGPL build installs and verifies fine, then fails at render time with
    // an unknown-encoder error. Worse than not installing at all.
    const picked = pickFfmpegAsset(REAL_ASSETS);
    expect(picked?.name).not.toMatch(/lgpl/i);
  });

  test('never picks a -shared build — the exe cannot travel without its DLLs', () => {
    const picked = pickFfmpegAsset(REAL_ASSETS);
    expect(picked?.name).not.toMatch(/-shared/);
  });

  test('prefers a numbered release over the rolling master build', () => {
    const onlyMasterAndN8 = REAL_ASSETS.filter(a => /master|n8\.1/.test(a.name));
    expect(pickFfmpegAsset(onlyMasterAndN8)?.name).toBe('ffmpeg-n8.1-latest-win64-gpl-8.1.zip');
  });

  test('falls back to master when no numbered release is published', () => {
    const masterOnly = REAL_ASSETS.filter(a => /master/.test(a.name));
    expect(pickFfmpegAsset(masterOnly)?.name).toBe('ffmpeg-master-latest-win64-gpl.zip');
  });

  test('reports nothing rather than guessing when there is no usable asset', () => {
    expect(pickFfmpegAsset([])).toBeNull();
    expect(pickFfmpegAsset(REAL_ASSETS.filter(a => /linux/.test(a.name)))).toBeNull();
  });
});

describe('the setup run', () => {
  let dir: string;
  const realPlatform = process.platform;

  const asWindows = () =>
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ffmpeg-'));
    asWindows();
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Unpacks to a nested bin/ directory, the way the real zip does. */
  const io = (over: Partial<FfmpegSetupIO> = {}): FfmpegSetupIO => ({
    getJson: async () => ({ assets: REAL_ASSETS }),
    download: async (_u, dest) => { fs.writeFileSync(dest, 'zip'); },
    extractZip: async (_z, into) => {
      const bin = path.join(into, 'ffmpeg-n9.0-latest-win64-gpl-9.0', 'bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'ffmpeg.exe'), 'binary');
    },
    freeDiskGB: () => 50,
    canRun: async () => true,
    ...over,
  });

  test('downloads, unpacks and returns the binary it found', async () => {
    const phases: string[] = [];
    const bin = await runFfmpegSetup(p => phases.push(p.phase), io(), dir);

    expect(fs.existsSync(bin)).toBe(true);
    expect(path.basename(bin)).toBe('ffmpeg.exe');
    expect(phases).toEqual(
      expect.arrayContaining(['resolving', 'downloading', 'extracting', 'verifying', 'done']),
    );
  });

  test('finds the exe even though the zip nests it under a versioned folder', async () => {
    await runFfmpegSetup(() => {}, io(), dir);
    // The folder name carries the version and changes every release, so the
    // finder searches rather than assuming a path.
    expect(findManagedFfmpeg(dir)).toContain('ffmpeg.exe');
  });

  test('a binary that unpacks but will not run is a failure, not a success', async () => {
    // "The file is there" and "the file works" have come apart before. Only the
    // second is what the render stage actually needs.
    await expect(runFfmpegSetup(() => {}, io({ canRun: async () => false }), dir))
      .rejects.toThrow(/would not run/i);
  });

  test('a zip that unpacks to nothing is reported, not silently accepted', async () => {
    await expect(runFfmpegSetup(() => {}, io({ extractZip: async () => {} }), dir))
      .rejects.toThrow(/did not unpack/i);
  });

  test('refuses when the release carries no Windows build', async () => {
    await expect(runFfmpegSetup(() => {}, io({ getJson: async () => ({ assets: [] }) }), dir))
      .rejects.toThrow(/Could not find a Windows download/i);
  });

  test('refuses on low disk rather than half-filling the drive', async () => {
    await expect(runFfmpegSetup(() => {}, io({ freeDiskGB: () => 0.2 }), dir))
      .rejects.toThrow(/disk space/i);
  });

  test('an existing working install is not downloaded again', async () => {
    const bin = path.join(dir, 'ffmpeg.exe');
    fs.writeFileSync(bin, 'binary');
    const download = jest.fn();

    const got = await runFfmpegSetup(() => {}, io({ download }), dir);

    expect(got).toBe(bin);
    expect(download).not.toHaveBeenCalled();
  });

  test('reports progress in megabytes so a long download is not a blank spinner', async () => {
    const seen: Array<{ receivedMB?: number; totalMB?: number | null }> = [];
    await runFfmpegSetup(p => { if (p.phase === 'downloading') seen.push(p); }, io({
      download: async (_u, dest, onBytes) => {
        onBytes(50 * 1048576, 169 * 1048576);
        fs.writeFileSync(dest, 'zip');
      },
    }), dir);

    expect(seen.some(p => p.receivedMB === 50 && p.totalMB === 169)).toBe(true);
  });
});

describe('the download has to reach rendering', () => {
  // A managed engine lands in userData, never on PATH. If findFfmpeg is not
  // handed it, "Set it up for me" completes and rendering still says the engine
  // is missing — setup that changes nothing, which is the failure mode this
  // whole feature exists to remove.
  let managed: string;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ffreach-'));
    managed = path.join(dir, 'ffmpeg.exe');
    fs.writeFileSync(managed, 'binary');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** Everything runs — so the result is decided purely by search order. */
  const anythingRuns = async () => true;

  test('the managed copy is found and returned', async () => {
    expect(await findFfmpeg(managed, anythingRuns)).toBe(managed);
  });

  test('the managed copy beats whatever is on PATH', async () => {
    // If the user asked HomeBot to install a working engine, that one wins over
    // a system build that may be older or missing libx264.
    const found = await findFfmpeg(managed, anythingRuns);
    expect(found).toBe(managed);
    expect(found).not.toBe('ffmpeg');
  });

  test('a managed path that is not on disk is skipped, not returned', async () => {
    // Guards the obvious wrong fix: trusting the path because setup claimed to
    // have run, rather than because the file is there.
    const found = await findFfmpeg(path.join(dir, 'gone.exe'), anythingRuns);
    expect(found).toBe('ffmpeg');
  });

  test('with no managed copy the previous search order is unchanged', async () => {
    expect(await findFfmpeg(null, anythingRuns)).toBe('ffmpeg');
    expect(await findFfmpeg(undefined, anythingRuns)).toBe('ffmpeg');
  });

  test('nothing usable anywhere reports null rather than a bad path', async () => {
    expect(await findFfmpeg(managed, async () => false)).toBeNull();
  });
});
