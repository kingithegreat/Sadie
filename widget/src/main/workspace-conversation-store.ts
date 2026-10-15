/** One bounded IDE transcript store shared by UI recovery and model hydration. */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { getSettings } from './config-manager';
import { validateTrustedWorkspaceRoot } from './workspace-trust';

export interface WorkspaceTranscriptTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  context?: string[];
  error?: boolean;
}
export interface WorkspaceTranscript { turns: WorkspaceTranscriptTurn[]; persistent?: false }
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_SAVE_BYTES = 1_000_000;
const invalid = () => new Error('The saved conversation is invalid. Its original file was preserved.');

function transcriptFile(root: unknown): string {
  const canonical = validateTrustedWorkspaceRoot(root);
  const digest = createHash('sha256').update(canonical).digest('hex');
  return path.join(app.getPath('userData'), 'ide-conversations', `${digest}.json`);
}
function assertStoreDirectory(file: string): void {
  try {
    const directory = fs.lstatSync(path.dirname(file));
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('The IDE conversation folder is redirected. Its original files were preserved.');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
function statTranscript(file: string): fs.Stats | undefined {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The IDE conversation file is redirected. Its original file was preserved.');
    return stat;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
function validateTurns(value: unknown): WorkspaceTranscriptTurn[] {
  if (!Array.isArray(value) || value.length > 100) throw invalid();
  const ids = new Set<string>();
  return value.map(turn => {
    if (!turn || typeof turn !== 'object' || !['user', 'assistant'].includes(turn.role)
      || typeof turn.id !== 'string' || !turn.id || turn.id.length > 200 || ids.has(turn.id)
      || typeof turn.text !== 'string' || turn.text.length > 100_000
      || (turn.error !== undefined && typeof turn.error !== 'boolean')
      || (turn.context !== undefined && (!Array.isArray(turn.context) || turn.context.length > 30
        || turn.context.some((item: unknown) => typeof item !== 'string' || item.length > 4096)))) throw invalid();
    ids.add(turn.id);
    return { id: turn.id, role: turn.role, text: turn.text, ...(turn.error !== undefined ? { error: turn.error } : {}), ...(turn.context !== undefined ? { context: [...turn.context] } : {}) };
  });
}

export function readWorkspaceTranscript(root: unknown): WorkspaceTranscript {
  const file = transcriptFile(root);
  if (getSettings().saveConversationHistory === false) return { turns: [], persistent: false };
  assertStoreDirectory(file);
  const before = statTranscript(file);
  if (!before) return { turns: [] };
  if (before.size > MAX_READ_BYTES) throw new Error('This conversation exceeds the recovery limit.');
  const descriptor = fs.openSync(file, 'r');
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_READ_BYTES) throw invalid();
    // A concurrent growth cannot turn a stat-bounded read into an unbounded allocation.
    const bytes = Buffer.alloc(MAX_READ_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_READ_BYTES) throw new Error('This conversation exceeds the recovery limit.');
    let saved: unknown;
    try { saved = JSON.parse(bytes.toString('utf8', 0, length)); } catch { throw invalid(); }
    return { turns: validateTurns((saved as { turns?: unknown } | null)?.turns) };
  } finally { fs.closeSync(descriptor); }
}

export function writeWorkspaceTranscript(root: unknown, turns: unknown): { persistent?: false } {
  const file = transcriptFile(root);
  // An explicit clear deletes earlier recovery bytes even while history is off.
  if (Array.isArray(turns) && !turns.length) {
    assertStoreDirectory(file); statTranscript(file);
    try { fs.unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return {};
  }
  if (getSettings().saveConversationHistory === false) return { persistent: false };
  const clean = validateTurns(turns), serialized = JSON.stringify({ turns: clean });
  if (Buffer.byteLength(serialized) > MAX_SAVE_BYTES) throw new Error('Conversation limit reached. Clear older history before continuing.');
  assertStoreDirectory(file); statTranscript(file);
  fs.mkdirSync(path.dirname(file), { recursive: true }); assertStoreDirectory(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  let descriptor: number | undefined, owned: fs.BigIntStats | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    owned = fs.fstatSync(descriptor, { bigint: true });
    fs.writeFileSync(descriptor, serialized);
    fs.closeSync(descriptor); descriptor = undefined;
    assertStoreDirectory(file); statTranscript(file);
    const current = fs.lstatSync(temporary, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== owned.dev || current.ino !== owned.ino || current.birthtimeNs !== owned.birthtimeNs) throw invalid();
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    // Failed exclusive creation and redirected parents must not remove another
    // writer's same-named file while cleaning our own temporary artifact.
    if (owned) try {
      const current = fs.lstatSync(temporary, { bigint: true });
      if (current.isFile() && !current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino && current.birthtimeNs === owned.birthtimeNs) fs.unlinkSync(temporary);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return {};
}

/**
 * Pending or failed pairs stay visible in recovery but are not model history.
 * Legacy transcripts do not distinguish a nonempty partial answer from a finished
 * one; this converter does not claim to recover a stream's completion status.
 */
export function workspaceTranscriptModelMessages(turns: readonly WorkspaceTranscriptTurn[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (let index = 0; index + 1 < turns.length; index++) {
    const user = turns[index], assistant = turns[index + 1];
    if (user.role !== 'user' || assistant.role !== 'assistant') continue;
    index++;
    if (!user.text.trim() || user.error || !assistant.text.trim() || assistant.error) continue;
    messages.push({ role: 'user', content: user.text }, { role: 'assistant', content: assistant.text });
  }
  return messages;
}
