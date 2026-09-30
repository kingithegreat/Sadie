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

export function isWithinHomeDir(resolvedPath: string, homeDirPath: string): boolean {
  if (!resolvedPath || !homeDirPath) return false;
  const resolved = resolvedPath.toLowerCase();
  const home = homeDirPath.toLowerCase();
  if (!resolved || !home) return false;
  // A root profile (`D:\`, `\\server\share\`, `/`) keeps its trailing separator
  // after path.resolve. Compare against the home WITHOUT it, then require a
  // separator, so `D:\` + child is inside while a same-prefix sibling
  // (`C:\Users\adenk-other` for `C:\Users\adenk\`) still is not.
  const base = home.replace(/[\\/]+$/, '');
  if (resolved === home || (base && resolved === base)) return true;
  return resolved.startsWith(base + '/') || resolved.startsWith(base + '\\');
}
