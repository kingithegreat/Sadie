import * as os from 'os';
import * as path from 'path';

/**
 * Confine a user/LLM-supplied filesystem path to the user's home directory.
 *
 * Without this a malicious LLM tool-call or a compromised renderer could read
 * arbitrary files (~/.ssh/id_rsa, browser cookie stores, etc.) and return
 * them. Every IPC handler or tool that takes a filesystem path from an
 * untrusted source must pass it through here before touching disk.
 *
 * Accepts a leading `~` (expanded to the home directory). Comparison is
 * case-insensitive because Windows filesystems are case-insensitive.
 */
export function resolveWithinHome(filePath: string): { resolved: string } | { error: string } {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { error: 'Access denied: path must be within home directory' };
  }
  const resolved = path.resolve(filePath.replace(/^~/, os.homedir()));
  const homeDir = os.homedir();
  const homeWithSep = homeDir.toLowerCase() + path.sep;
  if (
    resolved.toLowerCase() !== homeDir.toLowerCase() &&
    !resolved.toLowerCase().startsWith(homeWithSep)
  ) {
    return { error: 'Access denied: path must be within home directory' };
  }
  return { resolved };
}
