/** Neutral file primitives: never truncate a live document before replacement. */
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
export interface AtomicProjectWriteOptions { mode?: number; expectedExists?: boolean; expectedHash?: string; validate?: () => void }
const hashBytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function assertSnapshot(file: string, options: AtomicProjectWriteOptions) {
  options.validate?.();
  if (options.expectedExists === undefined) return;
  const exists = fs.existsSync(file);
  if (exists !== options.expectedExists) throw new Error('This file changed before the operation completed. Its newer version was preserved.');
  if (exists && (typeof options.expectedHash !== 'string' || hashBytes(fs.readFileSync(file)) !== options.expectedHash)) throw new Error('This file changed before the operation completed. Its newer version was preserved.');
}
function syncDirectory(directory: string) {
  if (process.platform === 'win32') return;
  let descriptor: number | undefined;
  try { descriptor = fs.openSync(directory, 'r'); fs.fsyncSync(descriptor); }
  catch { /* Not every filesystem supports syncing a directory. */ }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
export function atomicProjectWrite(file: string, bytes: Buffer, options: AtomicProjectWriteOptions = {}): void {
  assertSnapshot(file, options);
  const mode = options.mode ?? (fs.existsSync(file) ? fs.statSync(file).mode : 0o600);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, bytes); fs.fchmodSync(descriptor, mode & 0o7777); fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    assertSnapshot(file, options);
    if (options.expectedExists === false) {
      // link is an atomic create-if-absent operation. rename would clobber a
      // file another program created between our check and the commit.
      fs.linkSync(temporary, file); fs.unlinkSync(temporary);
    } else fs.renameSync(temporary, file);
    syncDirectory(path.dirname(file));
  } finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* preserve original error */ } }
    if (fs.existsSync(temporary)) { try { fs.unlinkSync(temporary); } catch { /* preserve original document and original error */ } }
  }
}
export function removeProjectFile(file: string, expectedHash: string, validate?: () => void) {
  assertSnapshot(file, { expectedExists: true, expectedHash, validate });
  fs.unlinkSync(file); syncDirectory(path.dirname(file));
}
