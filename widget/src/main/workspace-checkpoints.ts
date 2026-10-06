/** Bounded file-specific rollback. A later edit is always a visible conflict. */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { canonicalWorkspacePath, validateWorkspaceRoot, withinRoot } from './workspace-context';
import { checkedTrustedWorkspacePath } from './workspace-trust';
import type { WorkspaceCheckpointRunRestoreResult } from '../shared/workspace-ai-types';
import { atomicProjectWrite, removeProjectFile } from './workspace-atomic';
export const byteHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
interface Checkpoint { id: string; root: string; path: string; at: number; tool: string; before: string | null; afterHash: string; runId?: string; interleaved?: boolean }
const directory = () => path.join(app.getPath('userData'), 'ide-checkpoints');
const store = (root: string) => path.join(directory(), `${byteHash(Buffer.from(root))}.json`);
function read(root: string): Checkpoint[] {
  const file = store(root);
  if (!fs.existsSync(file)) return [];
  if (fs.statSync(file).size > 32 * 1024 * 1024) throw new Error('Recovery history exceeds the storage limit. Its original file was preserved.');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value) || value.length > 30 || value.some(row => !row || typeof row.id !== 'string' || typeof row.path !== 'string' || typeof row.root !== 'string' || typeof row.afterHash !== 'string' || !(row.before === null || typeof row.before === 'string'))) throw new Error('Recovery history is invalid. Its original file was preserved.');
  return value;
}
function write(root: string, rows: Checkpoint[]) {
  fs.mkdirSync(directory(), { recursive: true });
  atomicProjectWrite(store(root), Buffer.from(JSON.stringify(rows)), { mode: 0o600 });
}
/** Main apply is synchronous, so failure can restore its prior metadata receipt. */
export function checkpointFailureRollback(rootInput: string): () => void {
  const root = validateWorkspaceRoot(rootInput), file = store(root); read(root);
  const previous = fs.existsSync(file) ? fs.readFileSync(file) : null;
  return () => { if (previous) atomicProjectWrite(file, previous, { mode: 0o600 }); else if (fs.existsSync(file)) fs.unlinkSync(file); };
}
export function recordWorkspaceCheckpoint(rootInput: string, file: string, before: Buffer | null, after: Buffer | null, tool: string, runId?: string) {
  const root = validateWorkspaceRoot(rootInput), target = checkedTrustedWorkspacePath(root, file);
  if (!withinRoot(root, target) || (before?.length || 0) > 2 * 1024 * 1024 || (after?.length || 0) > 2 * 1024 * 1024) throw new Error('This change is outside the checkpoint size/scope limit.');
  const row: Checkpoint = { id: randomUUID(), root, path: target, at: Date.now(), tool, runId, before: before?.toString('base64') ?? null, afterHash: after ? byteHash(after) : 'missing' };
  const existing = read(root);
  if (runId) {
    const previous = existing.find(item => item.runId === runId && item.path === target);
    if (previous) {
      row.before = previous.before;
      row.interleaved = previous.interleaved || previous.afterHash !== (before ? byteHash(before) : 'missing');
    }
    const sameRun = existing.filter(item => item.runId === runId && item.path !== target);
    if (sameRun.length >= 30) throw new Error('This run exceeds the 30-file recovery limit. Start a new approved run before accepting more files.');
    if (Buffer.byteLength(JSON.stringify([row, ...sameRun])) > 24 * 1024 * 1024) throw new Error('This run exceeds the recovery storage budget. No new file was changed.');
  }
  const remainder = existing.filter(item => !(runId && item.runId === runId && item.path === target));
  const rows = [row, ...remainder.filter(item => runId && item.runId === runId), ...remainder.filter(item => !runId || item.runId !== runId)].slice(0, 30);
  while (Buffer.byteLength(JSON.stringify(rows)) > 24 * 1024 * 1024) rows.pop();
  write(root, rows);
  return row.id;
}
export function listWorkspaceCheckpointRuns(rootInput: unknown) {
  const root = validateWorkspaceRoot(rootInput), runs = new Map<string, { id: string; at: number; paths: string[] }>();
  for (const row of read(root)) {
    const id = row.runId || row.id, run = runs.get(id) || { id, at: row.at, paths: [] };
    if (!run.paths.includes(row.path)) run.paths.push(row.path);
    runs.set(id, run);
  }
  return [...runs.values()];
}
function runRows(root: string, id: unknown) {
  const rows = read(root).filter(row => (row.runId || row.id) === id).reverse(), files = new Map<string, Checkpoint>();
  if (!rows.length) throw new Error('This run is no longer available.');
  for (const row of rows) {
    if (row.root !== root || checkedTrustedWorkspacePath(root, row.path) !== row.path) throw new Error('This run contains an unavailable project path.');
    const first = files.get(row.path);
    files.set(row.path, first ? { ...row, before: first.before } : row);
  }
  return [...files.values()];
}
export function compareWorkspaceCheckpointRun(rootInput: unknown, id: unknown) {
  const root = validateWorkspaceRoot(rootInput);
  const files = runRows(root, id).map(row => {
    const current = fs.existsSync(row.path) ? fs.readFileSync(row.path) : null;
    if ((current?.length || 0) > 2 * 1024 * 1024) throw new Error('A current file exceeds the checkpoint comparison limit.');
    const currentHash = current ? byteHash(current) : 'missing';
    return { path: row.path, before: row.before === null ? null : Buffer.from(row.before, 'base64').toString('utf8'), current: current?.toString('utf8') ?? null, currentHash, conflict: !!row.interleaved || currentHash !== row.afterHash };
  });
  return { runId: String(id), files };
}
/** Preflight the entire run; if any later edit conflicts, nothing changes. */
export function restoreWorkspaceCheckpointRun(rootInput: unknown, id: unknown, options?: { confirmedHashes?: Record<string, string> }): WorkspaceCheckpointRunRestoreResult {
  const root = validateWorkspaceRoot(rootInput), rows = runRows(root, id);
  const snapshot = rows.map(row => {
    const current = fs.existsSync(row.path) ? fs.readFileSync(row.path) : null;
    if ((current?.length || 0) > 2 * 1024 * 1024) throw new Error('A current file exceeds the restoration limit.');
    return { row, current, hash: current ? byteHash(current) : 'missing', before: row.before === null ? null : Buffer.from(row.before, 'base64') };
  });
  const conflicts = snapshot.filter(item => (item.row.interleaved || item.hash !== item.row.afterHash) && options?.confirmedHashes?.[item.row.path] !== item.hash).map(item => ({ path: item.row.path, currentHash: item.hash }));
  if (conflicts.length) return { success: false, conflict: true, conflicts, error: 'Later edits were preserved. Compare this run and explicitly approve the displayed versions before restoring.' };
  if (snapshot.reduce((sum, item) => sum + (item.current?.toString('base64').length || 0) + 1000, 0) > 20 * 1024 * 1024) return { success: false, error: 'This run exceeds the safe recovery-copy budget. No files were restored.' };
  const recoveryRunId = `restore-${randomUUID()}`;
  // Every overwritten version is durably preserved before the first file changes.
  for (const item of snapshot) recordWorkspaceCheckpoint(root, item.row.path, item.current, item.before, 'run restore', recoveryRunId);
  const restored: string[] = [];
  for (const item of snapshot) {
    const latest = fs.existsSync(item.row.path) ? fs.readFileSync(item.row.path) : null;
    if ((latest ? byteHash(latest) : 'missing') !== item.hash) return { success: false, conflict: true, restored, recoveryRunId, error: 'A file changed during restoration. Remaining files were preserved; restored versions have a recovery run.' };
    try {
      const validate = () => { if (checkedTrustedWorkspacePath(root, item.row.path) !== item.row.path) throw new Error('This checkpoint path moved.'); };
      if (item.before === null) { if (latest) removeProjectFile(item.row.path, item.hash, validate); }
      else {
        fs.mkdirSync(path.dirname(item.row.path), { recursive: true });
        atomicProjectWrite(item.row.path, item.before, { expectedExists: !!latest, expectedHash: latest ? item.hash : undefined, validate });
      }
      restored.push(item.row.path);
    } catch (error) { return { success: false, restored, recoveryRunId, error: `Could not restore all files: ${(error as Error).message}. Recovery copies were retained.` }; }
  }
  return { success: true, restored, recoveryRunId };
}
export function listWorkspaceCheckpoints(rootInput: unknown) {
  const root = validateWorkspaceRoot(rootInput);
  return read(root).map(({ before, ...row }) => ({ ...row, created: before === null }));
}
export function compareWorkspaceCheckpoint(rootInput: unknown, id: unknown) {
  const root = validateWorkspaceRoot(rootInput), row = read(root).find(item => item.id === id);
  if (!row || row.root !== root || checkedTrustedWorkspacePath(root, row.path) !== row.path) throw new Error('The checkpoint is unavailable in this project.');
  const current = fs.existsSync(row.path) ? fs.readFileSync(row.path) : null;
  if ((current?.length || 0) > 2 * 1024 * 1024) throw new Error('The current file is too large to compare safely.');
  return { path: row.path, before: row.before === null ? null : Buffer.from(row.before, 'base64').toString('utf8'), current: current?.toString('utf8') ?? null, currentHash: current ? byteHash(current) : 'missing' };
}
export function restoreWorkspaceCheckpoint(rootInput: unknown, id: unknown, options?: { overwrite?: boolean; expectedCurrentHash?: string }) {
  const root = validateWorkspaceRoot(rootInput), row = read(root).find(item => item.id === id);
  if (!row || row.root !== root) throw new Error('This checkpoint is no longer available for this project.');
  const target = checkedTrustedWorkspacePath(root, row.path);
  if (!withinRoot(root, target) || target !== row.path) throw new Error('This file moved outside the checkpoint scope.');
  const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const hash = current ? byteHash(current) : 'missing';
  if ((row.interleaved || hash !== row.afterHash) && !(options?.overwrite === true && options.expectedCurrentHash === hash)) {
    return { success: false, conflict: true, path: target, currentHash: hash, error: 'This file has later edits. They were preserved. Compare it before explicitly restoring.' };
  }
  const before = row.before === null ? null : Buffer.from(row.before, 'base64');
  // Preserve the overwritten current version as a new recovery checkpoint first.
  recordWorkspaceCheckpoint(root, target, current, before, 'checkpoint restore');
  const validate = () => { if (checkedTrustedWorkspacePath(root, target) !== target) throw new Error('This checkpoint path moved.'); };
  if (before === null) { if (current) removeProjectFile(target, hash, validate); }
  else atomicProjectWrite(target, before, { expectedExists: !!current, expectedHash: current ? hash : undefined, validate });
  return { success: true, path: target, removed: before === null };
}
