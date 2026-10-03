/** Shared, Electron-free executable discovery for diagnostics and rendering. */
import { execFile } from 'child_process';
import * as fs from 'fs';

/** Where ffmpeg might be, beyond PATH — the usual Windows install locations. */
const EXTRA_FFMPEG_PATHS = [
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
];

function canRun(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 10_000 }, (err) => resolve(!err));
  });
}

/**
 * Locate ffmpeg, or report that it is missing.
 *
 * HOMEBOT_FFMPEG is honoured first so a test or a portable install can point at
 * a binary without touching PATH.
 *
 * `managedPath` is the copy HomeBot downloaded for the user via "Set it up for
 * me" — passed in rather than looked up here so this module stays free of
 * Electron and testable. It is checked BEFORE PATH deliberately: if the user
 * asked HomeBot to install a working ffmpeg, that one should win over whatever
 * broken or codec-poor build happens to be on PATH.
 *
 * Production callers provide the managed path when it can be found; silently
 * skipping the copy we just downloaded would leave setup disconnected from use.
 */
export async function findFfmpeg(
  managedPath?: string | null,
  /**
   * How to decide a binary is usable. Injectable so the search ORDER can be
   * asserted without needing a real ffmpeg on the test machine. Capability
   * checks also supply their bounded runnable probe; rendering uses the real
   * default probe.
   */
  probe: (bin: string) => Promise<boolean> = canRun,
): Promise<string | null> {
  const explicit = process.env.HOMEBOT_FFMPEG?.trim();
  if (explicit && fs.existsSync(explicit) && await probe(explicit)) return explicit;
  if (managedPath && fs.existsSync(managedPath) && await probe(managedPath)) return managedPath;
  if (await probe('ffmpeg')) return 'ffmpeg';
  for (const candidate of EXTRA_FFMPEG_PATHS) {
    if (fs.existsSync(candidate) && await probe(candidate)) return candidate;
  }
  return null;
}
