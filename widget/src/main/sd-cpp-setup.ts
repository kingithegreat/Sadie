/**
 * sd-cpp-setup.ts — one click instead of two manual downloads.
 *
 * The existing "setup" for local image generation opens a folder and tells the
 * user to download `sd.exe` from a GitHub releases page and a `.gguf` from
 * HuggingFace, by hand, and drop them in. For the person this app is for —
 * someone who has never heard of a GitHub release — that is not setup, it is a
 * wall. This module does both downloads itself, with progress the UI can show.
 *
 * Design decisions:
 *
 * - The BINARY is resolved from the stable-diffusion.cpp latest release at run
 *   time, not pinned: asset names carry a commit hash (`sd-master-<hash>-bin-
 *   win-avx2-x64.zip`) so a pinned URL would rot within weeks. The AVX2 CPU
 *   build is chosen deliberately over CUDA — slower, but it runs on every
 *   64-bit machine, needs no driver match, and is a tenth the download. A
 *   GPU-picking upgrade can come later; "works the first time" wins now.
 *
 * - The MODEL comes from the HuggingFace API listing of a known repo, choosing
 *   a mid-size quantisation. Filenames there also change (Q4_0 vs Q4_K_M...),
 *   so discovery beats pinning again.
 *
 * - Everything network-touching is injectable, so the tests exercise the real
 *   selection and orchestration logic with fixture JSON and fake downloads —
 *   nothing in CI touches the network.
 *
 * - Downloads stream to a `.part` file and rename on completion, so a killed
 *   app never leaves a truncated file that findSDCppModel() would mistake for
 *   a real one (the finder accepts any *.gguf; a half file would "work" until
 *   render time and fail confusingly there).
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { execFile } from 'child_process';
import { getSDCppDir, findSDCppBinary, findSDCppModel } from './tools/web';

// ---- resolution (pure, tested) ---------------------------------------------

export interface ReleaseAsset { name: string; browser_download_url: string; size: number }
export interface RepoFile { path: string; size: number }

/**
 * Choose the Windows CPU build from a release's asset list.
 * Preference: avx2 (baseline for any CPU from the last decade), then plain
 * avx, then noavx as a last resort. CUDA/ROCm/Vulkan builds are deliberately
 * skipped — see the header.
 */
export function pickBinaryAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  const winZips = assets.filter(a => /win/i.test(a.name) && /x64/.test(a.name) && /\.zip$/i.test(a.name)
    && !/cuda|rocm|vulkan|sycl|hip/i.test(a.name));
  // 'cpu' is the current upstream token for the portable build (2026 releases
  // ship win-cpu-x64); the avx names are older schemes, kept for robustness.
  for (const want of [/-cpu-/i, /avx2/i, /avx(?!2|512)/i, /noavx/i]) {
    const hit = winZips.find(a => want.test(a.name));
    if (hit) return hit;
  }
  return winZips[0] ?? null;
}

/**
 * Choose a model file from a repo listing.
 * Wants a real checkpoint: .gguf, not a VAE/text-encoder side file, at least
 * half a gigabyte (anything smaller is a component, not a model), at most
 * 4.5 GB (this is a default download for ordinary machines). Prefers Q4 — the
 * accepted size/quality middle ground — then smallest acceptable.
 */
export function pickModelFile(files: RepoFile[]): RepoFile | null {
  const MIN = 500 * 1024 * 1024;
  const MAX = 4.5 * 1024 * 1024 * 1024;
  const ggufs = files.filter(f => /\.gguf$/i.test(f.path)
    && !/vae|clip|encoder|t5/i.test(f.path)
    && f.size >= MIN && f.size <= MAX);
  if (!ggufs.length) return null;
  const q4 = ggufs.filter(f => /q4/i.test(f.path)).sort((a, b) => a.size - b.size);
  if (q4.length) return q4[0];
  return ggufs.sort((a, b) => a.size - b.size)[0];
}

// ---- progress ---------------------------------------------------------------

export interface SetupProgress {
  /** resolving | binary | model | extracting | verifying | done | error */
  phase: string;
  /** What the user should read right now — always plain language. */
  note: string;
  receivedMB?: number;
  totalMB?: number | null;
}

export type ProgressFn = (p: SetupProgress) => void;

// ---- IO seams (injectable for tests) ---------------------------------------

export interface SetupIO {
  getJson(url: string): Promise<any>;
  /** Stream url to destPath, reporting bytes as they arrive. */
  download(url: string, destPath: string, onBytes: (received: number, total: number | null) => void): Promise<void>;
  /** Extract a zip and return the directory it was extracted into. */
  extractZip(zipPath: string, intoDir: string): Promise<void>;
  freeDiskGB(dir: string): number | null;
}

const UA = { 'User-Agent': 'HomeBot local image setup' };

export const realIO: SetupIO = {
  async getJson(url) {
    const res = await axios.get(url, { timeout: 30_000, headers: UA });
    return res.data;
  },
  async download(url, destPath, onBytes) {
    const tmp = `${destPath}.part`;
    const res = await axios.get(url, {
      responseType: 'stream', timeout: 60_000, headers: UA,
      maxRedirects: 10,
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
    // A truncated download must never be renamed into place.
    if (total && Math.abs(fs.statSync(tmp).size - total) > 1024) {
      fs.unlinkSync(tmp);
      throw new Error('The download stopped early — check the internet connection and try again.');
    }
    fs.renameSync(tmp, destPath);
  },
  async extractZip(zipPath, intoDir) {
    // Windows-only product (electron-builder targets win/nsis); Expand-Archive
    // ships with every supported Windows and saves a zip dependency.
    await new Promise<void>((resolve, reject) => {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${intoDir}" -Force`],
        { timeout: 120_000 },
        (err, _o, stderr) => err ? reject(new Error(stderr || err.message)) : resolve());
    });
  },
  freeDiskGB(dir) {
    try {
      const st = (fs as any).statfsSync(dir);
      return (st.bavail * st.bsize) / 1024 ** 3;
    } catch { return null; }
  },
};

// ---- the orchestrator -------------------------------------------------------

const RELEASE_API = 'https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/latest';
const MODEL_REPO_API = 'https://huggingface.co/api/models/second-state/stable-diffusion-v1-5-GGUF/tree/main';
const MODEL_DL_BASE = 'https://huggingface.co/second-state/stable-diffusion-v1-5-GGUF/resolve/main/';

/** Roughly binary zip (~50MB) + model (~2.2GB) + extraction slack. */
const NEEDED_GB = 5;

let running = false;

export function isSetupRunning(): boolean { return running; }

/**
 * Do the whole setup. Progress lands on `onProgress` in plain language; the
 * resolved value is a summary for the same audience. Throws with
 * plain-language messages — the UI shows them verbatim.
 */
export async function runAutoSetup(onProgress: ProgressFn, io: SetupIO = realIO): Promise<string> {
  if (running) throw new Error('Setup is already running.');
  running = true;
  try {
    if (process.platform !== 'win32') {
      throw new Error('Automatic setup currently supports Windows only.');
    }

    const dir = getSDCppDir();
    const modelsDir = path.join(dir, 'models');
    fs.mkdirSync(modelsDir, { recursive: true });

    const free = io.freeDiskGB(dir);
    if (free !== null && free < NEEDED_GB) {
      throw new Error(
        `Not enough disk space — this needs about ${NEEDED_GB} GB free and there is ` +
        `${free.toFixed(1)} GB. Clear some space and try again.`,
      );
    }

    onProgress({ phase: 'resolving', note: 'Finding the latest version…' });
    const release = await io.getJson(RELEASE_API);
    const asset = pickBinaryAsset(release?.assets ?? []);
    if (!asset) {
      throw new Error('Could not find a Windows download in the latest release — try again later, or use "Show me how" to set up by hand.');
    }

    const alreadyBinary = findSDCppBinary();
    if (!alreadyBinary) {
      const zipPath = path.join(dir, asset.name);
      onProgress({ phase: 'binary', note: 'Downloading the image engine…', receivedMB: 0, totalMB: Math.round(asset.size / 1048576) });
      await io.download(asset.browser_download_url, zipPath, (r, t) =>
        onProgress({ phase: 'binary', note: 'Downloading the image engine…', receivedMB: Math.round(r / 1048576), totalMB: t ? Math.round(t / 1048576) : null }));

      onProgress({ phase: 'extracting', note: 'Unpacking…' });
      await io.extractZip(zipPath, dir);
      try { fs.unlinkSync(zipPath); } catch { /* a leftover zip is harmless */ }

      // Builds sometimes nest the exe. It cannot travel alone: sd-cli.exe
      // loads a dozen ggml*.dll siblings, so the whole containing directory
      // comes up, not just the exe.
      if (!findSDCppBinary()) {
        const found = findFileRecursive(dir, /^(sd|sd-cli|stable-diffusion|main)(\.exe)?$/i, 4);
        if (found && path.dirname(found) !== dir) {
          for (const f of fs.readdirSync(path.dirname(found))) {
            fs.copyFileSync(path.join(path.dirname(found), f), path.join(dir, f));
          }
        }
      }
      if (!findSDCppBinary()) {
        throw new Error('The engine downloaded but did not unpack as expected — use "Show me how" to finish by hand.');
      }
    }

    const alreadyModel = findSDCppModel();
    if (!alreadyModel) {
      onProgress({ phase: 'resolving', note: 'Finding a picture model…' });
      const files: RepoFile[] = ((await io.getJson(MODEL_REPO_API)) ?? [])
        .map((f: any) => ({ path: String(f.path || ''), size: Number(f.size) || 0 }));
      const model = pickModelFile(files);
      if (!model) {
        throw new Error('Could not find a suitable picture model to download — use "Show me how" to set up by hand.');
      }
      const dest = path.join(modelsDir, path.basename(model.path));
      onProgress({ phase: 'model', note: 'Downloading the picture model — this is the big one…', receivedMB: 0, totalMB: Math.round(model.size / 1048576) });
      await io.download(MODEL_DL_BASE + model.path, dest, (r, t) =>
        onProgress({ phase: 'model', note: 'Downloading the picture model — this is the big one…', receivedMB: Math.round(r / 1048576), totalMB: t ? Math.round(t / 1048576) : Math.round(model.size / 1048576) }));
    }

    onProgress({ phase: 'verifying', note: 'Checking everything is in place…' });
    if (!findSDCppBinary() || !findSDCppModel()) {
      throw new Error('Something did not land where expected — use "Show me how" to finish by hand.');
    }

    onProgress({ phase: 'done', note: 'Ready — images can now be made on this PC.' });
    return 'Ready — images can now be made on this PC.';
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
    if (e.isDirectory()) {
      const hit = findFileRecursive(p, match, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}
