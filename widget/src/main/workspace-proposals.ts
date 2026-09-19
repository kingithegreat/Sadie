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

/** The context width the panel renders with; hunk numbering depends on it. */
export const PROPOSAL_CONTEXT = 3;

export interface EditProposal {
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
export function listProposals(): ProposalSummary[] {
  return [...proposals.values()]
    .sort((a, b) => b.at - a.at)
    .map(proposal => {
      const diff = diffText(proposal.before, proposal.after);
      return {
        id: proposal.id, path: proposal.path, tool: proposal.tool, at: proposal.at,
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
  const root = workspaceRoot();
  if (!root) return false;
  const target = path.resolve(resolvedPath);
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
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
    before = fs.readFileSync(target, 'utf-8');
    created = false;
  } catch {
    created = true;
  }
  const diff = diffText(before, args.nextContent);
  const hunks = toHunks(diff, PROPOSAL_CONTEXT);
  if (!hunks.length) {
    return { id: '', path: target, created, hunkCount: 0, stats: diff.stats, identical: true };
  }
  // One pending proposal per file: a second edit to the same file replaces the
  // first, so the reviewer never sees two stale answers for one question.
  for (const [id, existing] of proposals) if (path.resolve(existing.path) === target) proposals.delete(id);

  const id = randomUUID();
  proposals.set(id, { id, path: target, tool: args.tool, at: Date.now(), created, before, after: args.nextContent });
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
  const accepted = [...new Set((Array.isArray(hunkIndexes) ? hunkIndexes : [])
    .map(Number).filter(index => Number.isInteger(index) && index >= 0))];
  if (!accepted.length) return { success: false, error: 'Choose at least one change to accept.' };

  let onDisk = '';
  let exists = true;
  try {
    onDisk = fs.readFileSync(proposal.path, 'utf-8');
  } catch {
    exists = false;
  }
  if (exists === proposal.created || (exists && digest(onDisk) !== digest(proposal.before))) {
    proposals.delete(proposal.id);
    return { success: false, error: 'This file changed since the edit was proposed, so it was not applied. Ask again to get a fresh diff.' };
  }

  const diff = diffText(proposal.before, proposal.after);
  const next = applyHunks(diff, accepted, PROPOSAL_CONTEXT);
  if (next === proposal.before) return { success: false, error: 'Those hunks leave the file unchanged.' };

  try {
    fs.mkdirSync(path.dirname(proposal.path), { recursive: true });
    fs.writeFileSync(proposal.path, next, 'utf-8');
  } catch (err) {
    return { success: false, error: `Could not write the file: ${(err as Error).message}` };
  }
  // The applied edit belongs in the change log like any other write, so the
  // review history stays complete.
  try { recordChange({ path: proposal.path, before: proposal.before, existed: !proposal.created, tool: `${proposal.tool} (accepted)` }); } catch { /* logging must not fail a write */ }
  proposals.delete(proposal.id);
  return { success: true, path: proposal.path, applied: accepted.length };
}
