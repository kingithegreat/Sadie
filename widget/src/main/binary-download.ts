/**
 * binary-download.ts — fetching a released binary, once.
 *
 * `sd-cpp-setup.ts` and `ffmpeg-setup.ts` each need the same four things:
 * read a GitHub release listing, stream a large zip to disk with progress,
 * unpack it, and check there is room first. The second one was written by
 * copying the first, and `check-duplicate-exports.mjs` caught it — three
 * identical exports across the two files, with `ReleaseAsset` byte-for-byte
 * the same and the IO implementations near enough.
 *
 * The guard offers a suppression list in CLAIMS.md for deliberate mirrors.
 * This is not one of those: it is the case the guard describes as "two
 * independent builds of the same thing", so the answer is to have one.
 *
 * What stays OUT of here is anything specific to what is being installed —
 * which asset to pick, where it goes, how to tell it worked. Those differ per
 * binary and belong to the module that owns it.
 */

import * as fs from 'fs';
import axios from 'axios';
import { execFile } from 'child_process';

/** One downloadable file attached to a GitHub release. */
export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

/** A progress reporter over whatever shape the caller reports. */
export type ProgressFn<T> = (p: T) => void;

/** The network and disk seams, injectable so tests never touch either. */
export interface DownloadIO {
  getJson(url: string): Promise<any>;
  /** Stream url to destPath, reporting bytes as they arrive. */
  download(url: string, destPath: string, onBytes: (received: number, total: number | null) => void): Promise<void>;
  extractZip(zipPath: string, intoDir: string): Promise<void>;
  freeDiskGB(dir: string): number | null;
}

/**
 * The real implementation.
 *
 * `userAgent` is per-caller because GitHub's API wants one and it is the only
 * place either setup identifies itself. `extractTimeoutMs` differs because the
 * archives differ by an order of magnitude in size.
 */
export function makeDownloadIO(userAgent: string, extractTimeoutMs = 120_000): DownloadIO {
  const headers = { 'User-Agent': userAgent };
  return {
    async getJson(url) {
      const res = await axios.get(url, { timeout: 30_000, headers });
      return res.data;
    },

    async download(url, destPath, onBytes) {
      const tmp = `${destPath}.part`;
      const res = await axios.get(url, {
        responseType: 'stream', timeout: 60_000, headers, maxRedirects: 10,
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
      // A truncated download must never be renamed into place. Both finders
      // accept any file of the right name, so a half file would "work" until
      // the binary is actually run, and fail confusingly there.
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
          { timeout: extractTimeoutMs },
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
}
