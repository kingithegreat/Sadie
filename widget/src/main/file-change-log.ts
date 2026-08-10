/**
 * file-change-log.ts — a record of what HomeBot changed, so it can be reviewed.
 *
 * The app writes to the user's files. Until now nothing captured the previous
 * content, so there was no way to answer "what did it just change?" — not
 * before, not during, not after. That is the difference between an assistant
 * you let near your work and one you don't.
 *
 * Deliberately in-memory and bounded. This is a review aid for the current
 * session, not an undo history or a version-control system: persisting file
 * bodies to disk would quietly duplicate the user's data somewhere they did
 * not choose, and git already exists for real history.
 */

import * as fs from 'fs';

export interface FileChange {
  id: string;
  path: string;
  /** File content before the write. Empty string when the file was created. */
  before: string;
  after: string;
  /** Which tool made the change — write_file, edit_file, ... */
  tool: string;
  at: number;
  /** True when the file did not exist beforehand. */
  created: boolean;
}

/** Most recent changes kept. Older ones fall off the end. */
const MAX_CHANGES = 50;

/**
 * Files larger than this are recorded as a change but WITHOUT their content:
 * holding two copies of a 10MB file in memory to render a diff nobody will
 * read line by line is a bad trade. The entry still tells the user the file
 * was touched.
 */
const MAX_CONTENT_BYTES = 1_000_000;

const changes: FileChange[] = [];
let counter = 0;

/** Read a file's current text, or null if it does not exist / is too big. */
export function captureBefore(resolvedPath: string): { text: string; existed: boolean; tooLarge: boolean } {
  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) return { text: '', existed: false, tooLarge: false };
    if (stat.size > MAX_CONTENT_BYTES) return { text: '', existed: true, tooLarge: true };
    return { text: fs.readFileSync(resolvedPath, 'utf-8'), existed: true, tooLarge: false };
  } catch {
    // Missing file is the common case (a create), not an error.
    return { text: '', existed: false, tooLarge: false };
  }
}

/**
 * Record a completed change. Callers pass the text captured BEFORE the write;
 * the after-text is read here so it reflects what actually landed on disk
 * rather than what the tool intended to write.
 */
export function recordChange(opts: {
  path: string;
  before: string;
  existed: boolean;
  tool: string;
}): void {
  try {
    let after = '';
    try {
      const stat = fs.statSync(opts.path);
      if (stat.size <= MAX_CONTENT_BYTES) after = fs.readFileSync(opts.path, 'utf-8');
    } catch { /* deleted immediately after writing — record the removal */ }

    // A no-op write (same bytes) is noise in a review list.
    if (opts.existed && after === opts.before) return;

    counter += 1;
    changes.unshift({
      id: `chg-${counter}`,
      path: opts.path,
      before: opts.before,
      after,
      tool: opts.tool,
      at: Date.now(),
      created: !opts.existed,
    });
    if (changes.length > MAX_CHANGES) changes.length = MAX_CHANGES;
  } catch (e) {
    // Recording must never break the write it is observing.
    console.error('[CHANGES] Could not record file change:', e);
  }
}

/** Newest first. Content omitted — the list view only needs the summary. */
export function listChanges(): Array<Omit<FileChange, 'before' | 'after'>> {
  return changes.map(({ before: _b, after: _a, ...rest }) => rest);
}

export function getChange(id: string): FileChange | null {
  return changes.find(c => c.id === id) ?? null;
}

export function clearChanges(): void {
  changes.length = 0;
  counter = 0;
}
