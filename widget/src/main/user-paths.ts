/**
 * Where this machine's user profile lives.
 *
 * One resolution order, used everywhere, so a clone on someone else's Windows
 * profile behaves the same as it does on the developer's:
 *
 *   USERPROFILE  the Windows profile root — correct on the platform HomeBot ships on
 *   HOME         set by Git Bash/MSYS and on the POSIX side; the right second guess
 *   os.homedir() never empty, so callers never have to handle "no home directory"
 *
 * The old `process.env.HOME || process.env.USERPROFILE || ''` had two problems:
 * it preferred HOME (which on Windows is whatever a shell happened to export),
 * and its empty-string fallback made every path guard deny outright.
 */

import * as os from 'os';
import * as path from 'path';

/** The current user's home directory. Never empty. */
export function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

/** Join path segments onto the current user's home directory. */
export function userPath(...segments: string[]): string {
  return path.join(homeDir(), ...segments);
}

/** The current user's Desktop. */
export function desktopDir(): string {
  return userPath('Desktop');
}
