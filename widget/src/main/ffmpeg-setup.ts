/**
 * ffmpeg-setup.ts — one click instead of a package manager.
 *
 * Media Studio walks a video all the way to a script, narration and captions,
 * then stops at rendering with:
 *
 *   "Rendering needs ffmpeg, which is not installed. Get it from
 *    https://ffmpeg.org/download.html (on Windows: winget install Gyan.FFmpeg)"
 *
 * For the person this app is for, that is the same wall the local-image setup
 * used to be: a download page, a package manager they have never opened, and a
 * PATH they do not know they have. `sd-cpp-setup.ts` already established the
 * answer — do it for them, with progress — and this is that pattern applied to
 * the one remaining manual dependency in the pipeline.
 *
 * Design decisions, and why:
 *
 * - The build is RESOLVED from BtbN/FFmpeg-Builds at run time, not pinned.
 *   That repo's assets carry version tokens (`ffmpeg-n9.0-latest-win64-gpl-9.0
 *   .zip`) that roll forward, so a pinned URL rots. This is the lesson from the
 *   sd.cpp probe, where a hard-coded asset name had already been dead for weeks
 *   with nothing in the repo able to notice.
 *
 * - GPL, not LGPL, because the renderer asks for `libx264` (media-render.ts
 *   passes `-c:v libx264`) and LGPL builds do not carry it. An LGPL download
 *   would install cleanly, verify, and then fail at render time with a codec
 *   error — the worst of both.
 *
 * - STATIC, not `-shared`. The shared zip is half the size and needs its DLLs
 *   laid out beside the exe; the static one is a single self-contained binary.
 *   sd.cpp already paid for this lesson ("it cannot travel alone: sd-cli.exe
 *   loads a dozen ggml*.dll siblings"). 163 MB once beats a class of bug that
 *   only appears on someone else's machine.
 *
 * - We DOWNLOAD it, we do not BUNDLE it. media-render.ts's header notes that
 *   bundling ffmpeg "commits the product to an ffmpeg licensing position; that
 *   is a business call". Fetching a build the user asked for, from upstream, and
 *   invoking it as a separate process is materially different from shipping it
 *   inside the installer — and it leaves that business call open.
 *
 * - Everything network-touching is injectable, so tests drive the real
 *   selection and orchestration with fixtures and never touch the network.
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { execFile } from 'child_process';

// ---- where it lives ---------------------------------------------------------

/**
 * Managed install directory. Mirrors `getSDCppDir()` — userData when Electron
 * is up, the same APPDATA fallback when it is not (tests, early startup).
 */
export function getFfmpegDir(): string {
  try {
    // Required lazily: this module is imported by tests that have no Electron.
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'ffmpeg');
  } catch {
    return path.join(process.env.APPDATA || '', 'HomeBot', 'ffmpeg');
  }
}

/**
 * The managed ffmpeg.exe, if it is there.
 *
 * Searches rather than assuming a layout: BtbN zips currently unpack to
 * `ffmpeg-<version>-win64-gpl/bin/ffmpeg.exe`, and that prefix changes with
 * every release. A recursive look is what survives the next rename.
 */
export function findManagedFfmpeg(dir: string = getFfmpegDir()): string | null {
  const direct = path.join(dir, 'ffmpeg.exe');
  if (fs.existsSync(direct)) return direct;
  return findFileRecursive(dir, /^ffmpeg\.exe$/i, 3);
}

// ---- resolution (pure, tested) ---------------------------------------------

export interface ReleaseAsset { name: string; browser_download_url: string; size: number }

/**
 * Choose the Windows build to download.
 *
 * Must be: win64, a zip, GPL (for libx264) and NOT `-shared` (static). Among
 * those, a numbered release (`n9.0`, `n8.1`) is preferred over `master`, and
 * the highest number wins — master is a rolling dev build and the numbered ones
 * are what upstream calls releases.
 */
export function pickFfmpegAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  const usable = assets.filter(a =>
    /win64/i.test(a.name)
    && /\.zip$/i.test(a.name)
    && /-gpl/i.test(a.name)
    && !/-shared/i.test(a.name)
    && !/lgpl/i.test(a.name));
  if (!usable.length) return null;

  const versioned = usable
    .map(a => ({ a, v: versionOf(a.name) }))
    .filter(x => x.v !== null)
    .sort((x, y) => compareVersions(y.v!, x.v!));
  if (versioned.length) return versioned[0].a;

  return usable.find(a => /master/i.test(a.name)) ?? usable[0];
}

/** `ffmpeg-n9.0-latest-win64-gpl-9.0.zip` → [9, 0]. `master` → null. */
function versionOf(name: string): number[] | null {
  const m = /-n(\d+)(?:\.(\d+))?(?:\.(\d+))?-/i.exec(name);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ---- progress ---------------------------------------------------------------

export interface FfmpegSetupProgress {
  /** resolving | downloading | extracting | verifying | done */
  phase: string;
  /** What the user should read right now — always plain language. */
  note: string;
  receivedMB?: number;
  totalMB?: number | null;
}

export type ProgressFn = (p: FfmpegSetupProgress) => void;

// ---- IO seams (injectable for tests) ---------------------------------------

export interface FfmpegSetupIO {
  getJson(url: string): Promise<any>;
  download(url: string, destPath: string, onBytes: (received: number, total: number | null) => void): Promise<void>;
  extractZip(zipPath: string, intoDir: string): Promise<void>;
  freeDiskGB(dir: string): number | null;
  /** True when the binary at this path actually runs. */
  canRun(bin: string): Promise<boolean>;
}

const UA = { 'User-Agent': 'HomeBot video setup' };

export const realIO: FfmpegSetupIO = {
  async getJson(url) {
    const res = await axios.get(url, { timeout: 30_000, headers: UA });
    return res.data;
  },
  async download(url, destPath, onBytes) {
    const tmp = `${destPath}.part`;
    const res = await axios.get(url, {
      responseType: 'stream', timeout: 60_000, headers: UA, maxRedirects: 10,
    });
    const total = Number(res.headers['content-length']) || null;
    let received = 0;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      res.data.on('data', (chunk: Buffer) => { received += chunk.length; onBytes(received, total); });
      res.data.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.data.pipe(out);
    });
    // A truncated download must never be renamed into place — findManagedFfmpeg
    // accepts any ffmpeg.exe, and a half file would "work" until render time.
    if (total && Math.abs(fs.statSync(tmp).size - total) > 1024) {
      fs.unlinkSync(tmp);
      throw new Error('The download stopped early — check the internet connection and try again.');
    }
    fs.renameSync(tmp, destPath);
  },
  async extractZip(zipPath, intoDir) {
    await new Promise<void>((resolve, reject) => {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${intoDir}" -Force`],
        { timeout: 300_000 },
        (err, _o, stderr) => err ? reject(new Error(stderr || err.message)) : resolve());
    });
  },
  freeDiskGB(dir) {
    try {
      const st = (fs as any).statfsSync(dir);
      return (st.bavail * st.bsize) / 1024 ** 3;
    } catch { return null; }
  },
  canRun(bin) {
    return new Promise((resolve) => {
      execFile(bin, ['-version'], { timeout: 10_000 }, (err) => resolve(!err));
    });
  },
};

// ---- the orchestrator -------------------------------------------------------

const RELEASE_API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest';

/** The static zip is ~163 MB and unpacks to about the same again. */
const NEEDED_GB = 1;

let running = false;

export function isFfmpegSetupRunning(): boolean { return running; }

/**
 * Download and unpack ffmpeg. Progress lands on `onProgress` in plain language;
 * the resolved value is the path to the working binary.
 *
 * Verification runs the binary rather than checking the file exists, because
 * "the file is there" and "the file works" have come apart before — a
 * truncated or wrong-architecture download passes the first and fails the
 * second, and only the second is what the render stage needs.
 */
export async function runFfmpegSetup(
  onProgress: ProgressFn,
  io: FfmpegSetupIO = realIO,
  dir: string = getFfmpegDir(),
): Promise<string> {
  if (running) throw new Error('Setup is already running.');
  running = true;
  try {
    if (process.platform !== 'win32') {
      throw new Error('Automatic setup currently supports Windows only.');
    }

    // Already there and working: say so rather than downloading 163 MB again.
    const existing = findManagedFfmpeg(dir);
    if (existing && await io.canRun(existing)) {
      onProgress({ phase: 'done', note: 'Already set up — videos can be made on this PC.' });
      return existing;
    }

    fs.mkdirSync(dir, { recursive: true });

    const free = io.freeDiskGB(dir);
    if (free !== null && free < NEEDED_GB) {
      throw new Error(
        `Not enough disk space — this needs about ${NEEDED_GB} GB free and there is ` +
        `${free.toFixed(1)} GB. Clear some space and try again.`,
      );
    }

    onProgress({ phase: 'resolving', note: 'Finding the latest version…' });
    const release = await io.getJson(RELEASE_API);
    const asset = pickFfmpegAsset(release?.assets ?? []);
    if (!asset) {
      throw new Error(
        'Could not find a Windows download in the latest release — try again later, ' +
        'or use "Show me how" to set it up by hand.',
      );
    }

    const totalMB = Math.round(asset.size / 1048576);
    const note = 'Downloading the video engine…';
    const zipPath = path.join(dir, asset.name);
    onProgress({ phase: 'downloading', note, receivedMB: 0, totalMB });
    await io.download(asset.browser_download_url, zipPath, (r, t) =>
      onProgress({
        phase: 'downloading', note,
        receivedMB: Math.round(r / 1048576),
        totalMB: t ? Math.round(t / 1048576) : totalMB,
      }));

    onProgress({ phase: 'extracting', note: 'Unpacking…' });
    await io.extractZip(zipPath, dir);
    try { fs.unlinkSync(zipPath); } catch { /* a leftover zip is harmless */ }

    onProgress({ phase: 'verifying', note: 'Checking it works…' });
    const bin = findManagedFfmpeg(dir);
    if (!bin) {
      throw new Error(
        'The video engine downloaded but did not unpack as expected — ' +
        'use "Show me how" to finish by hand.',
      );
    }
    if (!await io.canRun(bin)) {
      throw new Error(
        'The video engine downloaded but would not run on this PC — ' +
        'use "Show me how" to set it up by hand.',
      );
    }

    onProgress({ phase: 'done', note: 'Ready — videos can now be made on this PC.' });
    return bin;
  } finally {
    running = false;
  }
}

function findFileRecursive(root: string, match: RegExp, depth: number): string | null {
  if (depth < 0) return null;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isFile() && match.test(e.name)) return p;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = findFileRecursive(path.join(root, e.name), match, depth - 1);
    if (hit) return hit;
  }
  return null;
}
