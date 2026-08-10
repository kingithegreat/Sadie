/**
 * Line diff for the review UI — "what did HomeBot just change in my file?"
 *
 * HomeBot writes to the user's files. Until now there was no way to see what
 * it changed: not before, not during, not after. That is the difference
 * between an assistant you let near your code and one you don't, so this is
 * trust infrastructure rather than editor polish.
 *
 * Why not reuse main/tools/diff.ts: that one builds a full (m+1)x(n+1) LCS
 * table, which is O(m*n) memory. A 5,000-line file is 25 million cells — fine
 * for a chat tool diffing snippets on demand, not for a panel that renders on
 * every file change. This one trims the common prefix/suffix first (the usual
 * case is a handful of changed lines in a large file) and falls back to a
 * coarse whole-block replace when the remaining middle is still too large to
 * diff cheaply.
 *
 * Pure and dependency-free: lives in root src so the required CI gate covers
 * it, same placement as the quiz parser and the CRM core.
 */

export type DiffLineType = 'equal' | 'add' | 'remove';

export interface DiffLine {
  type: DiffLineType;
  /** 1-based line number in the BEFORE text, null for added lines. */
  before: number | null;
  /** 1-based line number in the AFTER text, null for removed lines. */
  after: number | null;
  text: string;
}

export interface DiffStats {
  added: number;
  removed: number;
  /** True when the middle was too large to diff precisely — see MAX_LCS_CELLS. */
  approximate: boolean;
}

export interface FileDiff {
  lines: DiffLine[];
  stats: DiffStats;
}

/**
 * Cap on LCS table cells. 4,000,000 is roughly a 2,000 x 2,000 line change,
 * which is far beyond any edit a human reviews line by line; past that the
 * table costs more than the answer is worth and we degrade to a block replace
 * rather than freeze the UI.
 */
const MAX_LCS_CELLS = 4_000_000;

/** Split into lines without inventing a trailing empty line for "a\n". */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const normalised = text.replace(/\r\n/g, '\n');
  const lines = normalised.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function lcsDiff(a: string[], b: string[], offsetA: number, offsetB: number): DiffLine[] {
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      out.unshift({ type: 'equal', before: offsetA + i, after: offsetB + j, text: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      out.unshift({ type: 'add', before: null, after: offsetB + j, text: b[j - 1] });
      j--;
    } else {
      out.unshift({ type: 'remove', before: offsetA + i, after: null, text: a[i - 1] });
      i--;
    }
  }
  return out;
}

/** Coarse fallback: every remaining before-line removed, after-line added. */
function blockReplace(a: string[], b: string[], offsetA: number, offsetB: number): DiffLine[] {
  const out: DiffLine[] = [];
  a.forEach((text, k) => out.push({ type: 'remove', before: offsetA + k + 1, after: null, text }));
  b.forEach((text, k) => out.push({ type: 'add', before: null, after: offsetB + k + 1, text }));
  return out;
}

/**
 * Diff two versions of a file's text.
 *
 * Trims the identical prefix and suffix before running LCS, which is what
 * makes a small edit in a large file cheap — the expensive algorithm only
 * ever sees the region that actually changed.
 */
export function diffText(before: string, after: string): FileDiff {
  const a = splitLines(before);
  const b = splitLines(after);

  // Common prefix.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  // Common suffix (never overlapping the prefix).
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const cells = (midA.length + 1) * (midB.length + 1);
  const approximate = cells > MAX_LCS_CELLS;
  const middle = approximate
    ? blockReplace(midA, midB, start, start)
    : lcsDiff(midA, midB, start, start);

  const lines: DiffLine[] = [];
  for (let k = 0; k < start; k++) {
    lines.push({ type: 'equal', before: k + 1, after: k + 1, text: a[k] });
  }
  lines.push(...middle);
  for (let k = 0; k < a.length - endA; k++) {
    lines.push({ type: 'equal', before: endA + k + 1, after: endB + k + 1, text: a[endA + k] });
  }

  return {
    lines,
    stats: {
      added: lines.filter(l => l.type === 'add').length,
      removed: lines.filter(l => l.type === 'remove').length,
      approximate,
    },
  };
}

export interface Hunk {
  /** 1-based start line in the BEFORE text. */
  beforeStart: number;
  /** 1-based start line in the AFTER text. */
  afterStart: number;
  lines: DiffLine[];
}

/**
 * Collapse a full diff to changed regions plus `context` unchanged lines
 * around each. Reviewing a one-line change should not mean scrolling a
 * thousand identical lines.
 */
export function toHunks(diff: FileDiff, context = 3): Hunk[] {
  const { lines } = diff;
  const changed = lines
    .map((l, idx) => (l.type === 'equal' ? -1 : idx))
    .filter(idx => idx >= 0);
  if (changed.length === 0) return [];

  // Merge change indices whose context windows touch or overlap.
  const ranges: Array<[number, number]> = [];
  for (const idx of changed) {
    const lo = Math.max(0, idx - context);
    const hi = Math.min(lines.length - 1, idx + context);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }

  return ranges.map(([lo, hi]) => {
    const slice = lines.slice(lo, hi + 1);
    const firstBefore = slice.find(l => l.before !== null)?.before ?? 1;
    const firstAfter = slice.find(l => l.after !== null)?.after ?? 1;
    return { beforeStart: firstBefore, afterStart: firstAfter, lines: slice };
  });
}
