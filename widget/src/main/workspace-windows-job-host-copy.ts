import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

const MAX_HOST_BYTES = 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export interface StagedWorkspaceWindowsJobHost {
  /** The private per-run copy to launch. Never the installed asset path. */
  readonly path: string;
  /**
   * Call immediately after spawn() returns. Windows CreateProcess is synchronous,
   * so the image section is mapped by then and the file can no longer be written
   * in place. Confirms the launched path is still the very file whose bytes were
   * verified (same held file identity, unchanged metadata and digest).
   */
  confirmLaunched(): void;
  /** Close the held handle and remove the private copy (best effort). */
  release(): void;
}

function readHeld(descriptor: number, size: number): Buffer {
  const bytes = Buffer.alloc(size + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  if (offset !== size) throw new Error('The private Job host copy changed while it was verified.');
  return bytes.subarray(0, offset);
}

/**
 * Codex P1 (TOCTOU): verifying the installed host and then letting spawn()
 * reopen that installed pathname allows a same-user process to swap the file
 * between the hash and the launch. Instead: read the installed host once, hash
 * THOSE bytes, write exactly those bytes to a fresh private per-run directory,
 * re-verify the copy through a held handle, and launch only that copy.
 */
export function stageVerifiedWorkspaceWindowsJobHost(installedHost: string, expectedSha256: string, options: { directory?: string } = {}): StagedWorkspaceWindowsJobHost {
  if (!HASH.test(expectedSha256)) throw new Error('The managed Job host build hash is missing or invalid.');
  // One bounded held read of the installed host; nothing reopens it afterwards.
  const source = fs.openSync(installedHost, 'r');
  let bytes: Buffer;
  try {
    const held = fs.fstatSync(source);
    if (!held.isFile() || held.size < 512 || held.size > MAX_HOST_BYTES) throw new Error('The managed Job console host is not a bounded regular file.');
    bytes = readHeld(source, held.size);
  } finally { fs.closeSync(source); }
  if (bytes.toString('ascii', 0, 2) !== 'MZ' || sha(bytes) !== expectedSha256) throw new Error('The managed Job console host hash does not match its preparation.');

  // mkdtemp: unpredictable, newly created, owner-only (0700; on Windows it
  // inherits the per-user TEMP ACL). 'wx' refuses any pre-existing file.
  const directory = fs.mkdtempSync(path.join(options.directory || os.tmpdir(), 'homebot-job-host-'));
  const file = path.join(directory, 'OwnedWindowsJobHost.exe');
  let reader: number | undefined;
  let identity: { dev: number; ino: number; size: number; mtimeMs: number };
  const release = () => {
    if (reader !== undefined) { try { fs.closeSync(reader); } catch { /* already closed */ } reader = undefined; }
    try { fs.chmodSync(file, 0o600); } catch { /* absent */ }
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* a still-running image cannot be removed; nothing else depends on it */ }
  };
  try {
    const writer = fs.openSync(file, 'wx', 0o700);
    try {
      let offset = 0;
      while (offset < bytes.length) offset += fs.writeSync(writer, bytes, offset, bytes.length - offset, offset);
      fs.fsyncSync(writer);
    } finally { fs.closeSync(writer); }
    // Read-only attribute on Windows; write access must not stay open or
    // CreateProcess would refuse the image with a sharing violation.
    fs.chmodSync(file, 0o500);
    reader = fs.openSync(file, 'r');
    const held = fs.fstatSync(reader), named = fs.lstatSync(file);
    if (!held.isFile() || named.isSymbolicLink() || held.dev !== named.dev || held.ino !== named.ino) throw new Error('The private Job host copy was replaced while it was staged.');
    if (sha(readHeld(reader, held.size)) !== expectedSha256) throw new Error('The private Job host copy does not match the verified host.');
    identity = { dev: held.dev, ino: held.ino, size: held.size, mtimeMs: held.mtimeMs };
  } catch (error) { release(); throw error; }

  return {
    path: file,
    confirmLaunched: () => {
      if (reader === undefined) throw new Error('The private Job host copy was already released.');
      const held = fs.fstatSync(reader), named = fs.lstatSync(file);
      const same = held.dev === identity.dev && held.ino === identity.ino && held.size === identity.size && held.mtimeMs === identity.mtimeMs
        && !named.isSymbolicLink() && named.dev === identity.dev && named.ino === identity.ino;
      if (!same || sha(readHeld(reader, held.size)) !== expectedSha256) throw new Error('The launched Job host is not the verified private copy. No project execution was released.');
    },
    release,
  };
}
