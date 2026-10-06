/**
 * Edits the assistant proposes to your open code folder, held until you decide
 * (IDE-3).
 *
 * Until now an agent edit reached the file and the Changes panel showed what it
 * had already done. That is a receipt, not a review. Inside the Workspace
 * folder the write is now held: the panel shows the diff hunk by hunk, and
 * nothing is written until the reviewer accepts something.
 *
 * Two promises, and the whole feature is worthless without them:
 *   - a rejected hunk leaves those lines byte-identical to the file on disk;
 *   - an accepted hunk writes exactly the lines that were on screen.
 * So the text is rebuilt from the same diff the panel rendered (applyHunks),
 * and a file that changed since the proposal is refused rather than patched
 * blind.
 *
 * Only the Workspace folder is held. A write anywhere else behaves exactly as
 * it did, because this is a code-review surface, not a new permission system.
 */

import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { applyHunks, diffText, toHunks, type Hunk } from '../../../src/diff/line-diff';
import { getSettings } from './config-manager';
import { recordChange } from './file-change-log';
import { currentWorkspace, validateWorkspaceRoot, withinRoot } from './workspace-context';
import { checkpointFailureRollback, recordWorkspaceCheckpoint } from './workspace-checkpoints';
import { atomicProjectWrite } from './workspace-atomic';
import { checkedAnyTrustedWorkspacePath, checkedTrustedWorkspacePath } from './workspace-trust';
import { TextDecoder } from 'util';

/** The context width the panel renders with; hunk numbering depends on it. */
export const PROPOSAL_CONTEXT = 3;

export interface EditProposal {
  root?: string;
  streamId?: string;
  reviewRoot?: string;
  id: string;
  path: string;
  tool: string;
  at: number;
  /** The file did not exist when this was proposed. */
  created: boolean;
  before: string;
  after: string;
}

export interface ProposalSummary {
  root?: string;
  streamId?: string;
  id: string;
  path: string;
  tool: string;
  at: number;
  created: boolean;
  stats: { added: number; removed: number; approximate: boolean };
  hunks: Hunk[];
}

const proposals = new Map<string, EditProposal>();

/** Newest first, so the panel shows the edit that just arrived at the top. */
export function listProposals(root?: string): ProposalSummary[] {
  const canonicalRoot = root ? validateWorkspaceRoot(root) : undefined;
  return [...proposals.values()]
    .filter(proposal => !canonicalRoot || withinRoot(canonicalRoot, proposal.path))
    .sort((a, b) => b.at - a.at)
    .map(proposal => {
      const diff = diffText(proposal.before, proposal.after);
      return {
        id: proposal.id, root: proposal.root, streamId: proposal.streamId, path: proposal.path, tool: proposal.tool, at: proposal.at,
        created: proposal.created, stats: diff.stats, hunks: toHunks(diff, PROPOSAL_CONTEXT),
      };
    });
}

export function getProposal(id: string): EditProposal | undefined {
  return proposals.get(id);
}

/** Test seam and window-close cleanup. */
export function __clearProposals(): void {
  proposals.clear();
}

/** The folder open in the Workspace, or null when none is set. */
function workspaceRoot(): string | null {
  try {
    const root = (getSettings() as { projectPath?: unknown } | null)?.projectPath;
    return typeof root === 'string' && root.trim() ? path.resolve(root) : null;
  } catch {
    return null;
  }
}

/** True when a write to this path is a code edit the reviewer should see first. */
export function shouldReviewEdit(resolvedPath: string): boolean {
  const root = currentWorkspace()?.root || workspaceRoot();
  if (!root) return false;
  const target = path.resolve(resolvedPath);
  const relative = path.relative(root, target);
  return relative !== '' && withinRoot(root, target);
}

export interface ProposeResult {
  id: string;
  path: string;
  created: boolean;
  hunkCount: number;
  stats: { added: number; removed: number; approximate: boolean };
  /** No change at all: the proposal is dropped rather than queued. */
  identical: boolean;
}

/** Hold an edit for review. `nextContent` is the whole file as it would be. */
export function proposeEdit(args: { path: string; nextContent: string; tool: string }): ProposeResult {
  const target = path.resolve(args.path);
  let before = '';
  let created = true;
  try {
    const bytes = fs.readFileSync(target);
    if (bytes.includes(0)) throw new Error('This file is binary text and cannot be edited through an AI text proposal. Its bytes were preserved.');
    try { before = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new Error('This file is not valid UTF-8 text. Use its original editor/encoding to edit it; its bytes were preserved.'); }
    created = false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    created = true;
  }
  if (Buffer.from(args.nextContent, 'utf8').toString('utf8') !== args.nextContent) throw new Error('The proposed text contains invalid Unicode and was not queued.');
  const diff = diffText(before, args.nextContent);
  const hunks = toHunks(diff, PROPOSAL_CONTEXT);
  if (!hunks.length) {
    return { id: '', path: target, created, hunkCount: 0, stats: diff.stats, identical: true };
  }
  // Replace a stream's earlier proposal, but retain another stream's proposal
  // for the same file. Applying either invalidates the other's original bytes.
  for (const [id, existing] of proposals) if (path.resolve(existing.path) === target && existing.streamId === currentWorkspace()?.streamId) proposals.delete(id);

  const id = randomUUID();
  proposals.set(id, { id, root: currentWorkspace()?.root, reviewRoot: currentWorkspace()?.root || workspaceRoot() || undefined, streamId: currentWorkspace()?.streamId, path: target, tool: args.tool, at: Date.now(), created, before, after: args.nextContent });
  return { id, path: target, created, hunkCount: hunks.length, stats: diff.stats, identical: false };
}

export function rejectProposal(id: string): { success: boolean; error?: string } {
  if (!proposals.delete(String(id))) return { success: false, error: 'That proposed change is no longer waiting.' };
  return { success: true };
}

const digest = (text: string) => createHash('sha256').update(text, 'utf-8').digest('hex');

export interface ApplyResult {
  success: boolean;
  path?: string;
  /** Hunks written; the rest of the proposal is discarded with it. */
  applied?: number;
  error?: string;
}

/**
 * Write the accepted hunks. The file must still be what it was when the edit
 * was proposed — otherwise the diff on screen describes a file that no longer
 * exists, and applying it would silently revert whatever changed in between.
 */
export function applyProposal(id: string, hunkIndexes: number[]): ApplyResult {
  const proposal = proposals.get(String(id));
  if (!proposal) return { success: false, error: 'That proposed change is no longer waiting.' };
  let target = '';
  const validate = () => {
    const checked = proposal.reviewRoot ? checkedTrustedWorkspacePath(proposal.reviewRoot, proposal.path) : checkedAnyTrustedWorkspacePath(proposal.path);
    if (target && checked !== target) throw new Error('This file moved since the edit was proposed. Its current version was preserved.');
    return checked;
  };
  try { target = validate(); } catch (error) { return { success: false, error: (error as Error).message }; }
  const accepted = [...new Set((Array.isArray(hunkIndexes) ? hunkIndexes : [])
    .map(Number).filter(index => Number.isInteger(index) && index >= 0))];
  if (!accepted.length) return { success: false, error: 'Choose at least one change to accept.' };

  let onDisk = '';
  let exists = true;
  try {
    onDisk = fs.readFileSync(target, 'utf-8');
  } catch {
    exists = false;
  }
  if (exists === proposal.created || (exists && digest(onDisk) !== digest(proposal.before))) {
    proposals.delete(proposal.id);
    return { success: false, error: 'This file changed since the edit was proposed, so it was not applied. Ask again to get a fresh diff.' };
  }

  const diff = diffText(proposal.before, proposal.after);
  const totalHunks = toHunks(diff, PROPOSAL_CONTEXT).length;
  if (accepted.some(index => index >= totalHunks)) return { success: false, error: 'One of those changes no longer exists. Refresh the review.' };
  // Full acceptance is the exact proposed bytes, not the diff engine's
  // newline-normalized reconstruction. Partial acceptance preserves disk EOL.
  let next = accepted.length === totalHunks ? proposal.after : applyHunks(diff, accepted, PROPOSAL_CONTEXT);
  if (accepted.length !== totalHunks && proposal.before.includes('\r\n')) next = next.replace(/\r?\n/g, '\r\n');
  if (next === proposal.before) return { success: false, error: 'Those hunks leave the file unchanged.' };

  let rollbackCheckpoint: (() => void) | undefined;
  try {
    const originalBytes = exists ? fs.readFileSync(target) : null;
    if (originalBytes && createHash('sha256').update(originalBytes).digest('hex') !== digest(proposal.before)) throw new Error('This file changed before acceptance. Its newer version was preserved.');
    if (proposal.root) {
      rollbackCheckpoint = checkpointFailureRollback(proposal.root);
      recordWorkspaceCheckpoint(proposal.root, target, originalBytes, Buffer.from(next, 'utf-8'), proposal.tool, proposal.streamId);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    atomicProjectWrite(target, Buffer.from(next, 'utf-8'), { expectedExists: exists, expectedHash: exists ? digest(proposal.before) : undefined, validate });
  } catch (err) {
    try { rollbackCheckpoint?.(); } catch { /* the original document is still preserved; keep the recovery receipt */ }
    return { success: false, error: `Could not write the file: ${(err as Error).message}` };
  }
  // The applied edit belongs in the change log like any other write, so the
  // review history stays complete.
  try { recordChange({ path: proposal.path, before: proposal.before, existed: !proposal.created, tool: `${proposal.tool} (accepted)` }); } catch { /* logging must not fail a write */ }
  proposals.delete(proposal.id);
  return { success: true, path: proposal.path, applied: accepted.length };
}
