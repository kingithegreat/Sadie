/** Bounded file-specific rollback. A later edit is always a visible conflict. */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { canonicalWorkspacePath, validateWorkspaceRoot, withinRoot } from './workspace-context';
export const byteHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
interface Checkpoint { id: string; root: string; path: string; at: number; tool: string; before: string | null; afterHash: string }
const directory = () => path.join(app.getPath('userData'), 'ide-checkpoints');
const store = (root: string) => path.join(directory(), `${byteHash(Buffer.from(root))}.json`);
function read(root: string): Checkpoint[] {
  try { const bytes = fs.readFileSync(store(root)); if (bytes.length > 32 * 1024 * 1024) return []; const value = JSON.parse(bytes.toString()); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function write(root: string, rows: Checkpoint[]) {
  fs.mkdirSync(directory(), { recursive: true });
  const file = store(root), temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(rows), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
export function recordWorkspaceCheckpoint(rootInput: string, file: string, before: Buffer | null, after: Buffer | null, tool: string) {
  const root = validateWorkspaceRoot(rootInput), target = canonicalWorkspacePath(file);
  if (!withinRoot(root, target) || (before?.length || 0) > 2 * 1024 * 1024 || (after?.length || 0) > 2 * 1024 * 1024) throw new Error('This change is outside the checkpoint size/scope limit.');
  const row: Checkpoint = { id: randomUUID(), root, path: target, at: Date.now(), tool, before: before?.toString('base64') ?? null, afterHash: after ? byteHash(after) : 'missing' };
  const rows = [row, ...read(root)].slice(0, 30);
  while (Buffer.byteLength(JSON.stringify(rows)) > 24 * 1024 * 1024) rows.pop();
  write(root, rows);
  return row.id;
}
export function listWorkspaceCheckpoints(rootInput: unknown) {
  const root = validateWorkspaceRoot(rootInput);
  return read(root).map(({ before, ...row }) => ({ ...row, created: before === null }));
}
export function compareWorkspaceCheckpoint(rootInput: unknown, id: unknown) {
  const root = validateWorkspaceRoot(rootInput), row = read(root).find(item => item.id === id);
  if (!row || row.root !== root || !withinRoot(root, canonicalWorkspacePath(row.path))) throw new Error('The checkpoint is unavailable in this project.');
  const current = fs.existsSync(row.path) ? fs.readFileSync(row.path) : null;
  if ((current?.length || 0) > 2 * 1024 * 1024) throw new Error('The current file is too large to compare safely.');
  return { path: row.path, before: row.before === null ? null : Buffer.from(row.before, 'base64').toString('utf8'), current: current?.toString('utf8') ?? null, currentHash: current ? byteHash(current) : 'missing' };
}
export function restoreWorkspaceCheckpoint(rootInput: unknown, id: unknown, options?: { overwrite?: boolean; expectedCurrentHash?: string }) {
  const root = validateWorkspaceRoot(rootInput), row = read(root).find(item => item.id === id);
  if (!row || row.root !== root) throw new Error('This checkpoint is no longer available for this project.');
  const target = canonicalWorkspacePath(row.path);
  if (!withinRoot(root, target) || target !== row.path) throw new Error('This file moved outside the checkpoint scope.');
  const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const hash = current ? byteHash(current) : 'missing';
  if (hash !== row.afterHash && !(options?.overwrite === true && options.expectedCurrentHash === hash)) {
    return { success: false, conflict: true, path: target, currentHash: hash, error: 'This file has later edits. They were preserved. Compare it before explicitly restoring.' };
  }
  const before = row.before === null ? null : Buffer.from(row.before, 'base64');
  // Preserve the overwritten current version as a new recovery checkpoint first.
  recordWorkspaceCheckpoint(root, target, current, before, 'checkpoint restore');
  if (before === null) { if (current) fs.unlinkSync(target); }
  else { const temporary = `${target}.${randomUUID()}.restore`; fs.writeFileSync(temporary, before); fs.renameSync(temporary, target); }
  return { success: true, path: target, removed: before === null };
}
