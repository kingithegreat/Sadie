import * as fs from 'fs';
import { createHash } from 'crypto';
import { checkedAnyTrustedWorkspacePath, checkedTrustedWorkspacePath } from './workspace-trust';
import { atomicProjectWrite } from './workspace-atomic';
import type { WorkspaceDiskSnapshot, WorkspaceSaveOptions, WorkspaceSaveResult } from '../shared/workspace-file-types';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const versionOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Check the existing ancestor as well: a junction must not escape the sandbox. */
export function checkedWorkspacePath(input: string, root?: string): string {
  return root ? checkedTrustedWorkspacePath(root, input) : checkedAnyTrustedWorkspacePath(input);
}

export function readWorkspaceSnapshot(file: string): WorkspaceDiskSnapshot {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('That is a folder, not a file.');
  if (stat.size > MAX_TEXT_BYTES) throw new Error('File is too large to open (maximum 2 MB).');
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(0, 8192).includes(0)) throw new Error('Binary file — cannot open in the editor.');
  const text = bytes.toString('utf8');
  // Refuse lossy decoding; the IDE currently edits UTF-8 only.
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('This file is not UTF-8. Convert it before editing.');
  const bom = text.startsWith('\uFEFF');
  const content = bom ? text.slice(1) : text;
  return { content: content.replace(/\r\n/g, '\n'), version: versionOf(bytes), eol: content.includes('\r\n') ? 'crlf' : 'lf', bom };
}

/** Durable sibling write. Failed writes never truncate the previous file. */
export function atomicWorkspaceWrite(file: string, bytes: Buffer, mode?: number): void {
  atomicProjectWrite(file, bytes, { mode });
}

export function saveWorkspaceSnapshot(file: string, content: string, options: Partial<WorkspaceSaveOptions> = {}): WorkspaceSaveResult {
  if (typeof options.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(options.expectedVersion)) {
    return { success: false, error: 'Reopen this file before saving: its disk version is unavailable.' };
  }
  if (options.eol !== undefined && options.eol !== 'lf' && options.eol !== 'crlf') throw new Error('Choose LF or CRLF line endings.');
  if (options.bom !== undefined && typeof options.bom !== 'boolean') throw new Error('Choose whether to keep the UTF-8 BOM.');
  if (!fs.existsSync(file)) return { success: false, conflict: true, error: 'The file was removed. Your draft is preserved; use Save As to keep it.' };
  const disk = readWorkspaceSnapshot(file);
  if (disk.version !== options.expectedVersion) {
    return { success: false, conflict: true, disk, error: 'This file changed on disk. Compare, reload, or explicitly replace the current disk version.' };
  }
  const eol = options.eol ?? disk.eol;
  const bom = options.bom ?? disk.bom;
  const normalized = content.replace(/\r\n/g, '\n');
  const bytes = Buffer.from((bom ? '\uFEFF' : '') + (eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized), 'utf8');
  if (bytes.length > MAX_TEXT_BYTES) throw new Error('File is too large to save (maximum 2 MB).');
  // These operations are synchronous, so another IPC save cannot interleave.
  // Recheck immediately before replacing; no unguarded force-write path exists.
  if (versionOf(fs.readFileSync(file)) !== disk.version) return { success: false, conflict: true, disk: readWorkspaceSnapshot(file), error: 'The file changed again. Review the latest disk version.' };
  atomicProjectWrite(file, bytes, { expectedExists: true, expectedHash: disk.version, validate: () => { checkedWorkspacePath(file); } });
  return { success: true, version: versionOf(bytes), eol, bom };
}
