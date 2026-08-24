/**
 * home-boundary.ts — the comparison half of every home-directory sandbox.
 *
 * Every path guard in the app (path-guard.resolveWithinHome, filesystem's
 * validatePath, and the tool-local validators in terminal / git / codebase /
 * diff / documents) needs the same predicate: "is this RESOLVED absolute path
 * inside the home directory?" Getting it wrong in one copy is how a sibling
 * directory like `C:\Users\adam` used to pass a `C:\Users\adenk` prefix check —
 * `startsWith` alone does not know where the last component ends.
 *
 * Rules:
 *  - Case-insensitive (Windows filesystems are case-insensitive).
 *  - Accepts both separators, because some callers normalise to forward
 *    slashes before checking.
 *  - The caller must pass an ALREADY-RESOLVED path; expansion of `~` and
 *    shortcut forms stays the caller's job (they differ per surface).
 */

import * as path from 'path';

export function isWithinHomeDir(resolvedPath: string, homeDirPath: string): boolean {
  if (!resolvedPath || !homeDirPath) return false;
  const resolved = resolvedPath.toLowerCase();
  const home = homeDirPath.toLowerCase();
  if (!resolved || !home) return false;
  if (resolved === home) return true;
  const primarySep = home.includes('\\') ? '\\' : path.sep;
  return (
    resolved.startsWith(home + primarySep) ||
    resolved.startsWith(home + '/') ||
    resolved.startsWith(home + '\\')
  );
}
