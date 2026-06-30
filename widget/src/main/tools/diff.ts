/**
 * HomeBot Diff Tool
 *
 * Compares two text strings or two file contents line-by-line.
 * Returns a unified-diff-style result with added/removed lines.
 * No external dependencies — pure TypeScript implementation.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const HOME_DIR = os.homedir();

// ============= TOOL DEFINITIONS =============

export const diffTextDef: ToolDefinition = {
  name: 'diff_text',
  description:
    'Compare two text strings and show the differences line by line in unified diff format. ' +
    'Useful for spotting changes between two versions of text, code, or configs.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      original: {
        type: 'string',
        description: 'The original (before) text'
      },
      modified: {
        type: 'string',
        description: 'The modified (after) text'
      },
      context_lines: {
        type: 'number',
        description: 'Number of unchanged context lines to show around each change (default: 3)',
        default: 3
      }
    },
    required: ['original', 'modified']
  }
};

export const diffFilesDef: ToolDefinition = {
  name: 'diff_files',
  description:
    'Compare two files and return a unified diff. ' +
    'Both paths must be inside the user home directory.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      file_a: {
        type: 'string',
        description: 'Absolute path to the first (original) file'
      },
      file_b: {
        type: 'string',
        description: 'Absolute path to the second (modified) file'
      },
      context_lines: {
        type: 'number',
        description: 'Number of context lines (default: 3)',
        default: 3
      }
    },
    required: ['file_a', 'file_b']
  }
};

// ============= DIFF ENGINE =============

interface DiffLine {
  type: 'equal' | 'add' | 'remove';
  lineNo_a: number | null;
  lineNo_b: number | null;
  content: string;
}

/**
 * Minimal Myers longest-common-subsequence diff over lines.
 * Returns a flat sequence of DiffLine entries.
 */
function diffLines(aLines: string[], bLines: string[]): DiffLine[] {
  // Build LCS table
  const m = aLines.length;
  const n = bLines.length;

  // dp[i][j] = LCS length of aLines[0..i-1] vs bLines[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aLines[i - 1] === bLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      result.unshift({ type: 'equal', lineNo_a: i, lineNo_b: j, content: aLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', lineNo_a: null, lineNo_b: j, content: bLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'remove', lineNo_a: i, lineNo_b: null, content: aLines[i - 1] });
      i--;
    }
  }
  return result;
}

function buildUnifiedDiff(
  diffs: DiffLine[],
  labelA: string,
  labelB: string,
  contextLines: number
): string {
  const lines: string[] = [`--- ${labelA}`, `+++ ${labelB}`];

  // Find change indices
  const changeIndices = new Set<number>();
  diffs.forEach((d, idx) => {
    if (d.type !== 'equal') {
      for (let k = Math.max(0, idx - contextLines); k <= Math.min(diffs.length - 1, idx + contextLines); k++) {
        changeIndices.add(k);
      }
    }
  });

  let inHunk = false;
  for (let idx = 0; idx < diffs.length; idx++) {
    if (!changeIndices.has(idx)) {
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      lines.push('@@ change @@');
      inHunk = true;
    }
    const d = diffs[idx];
    if (d.type === 'equal') lines.push(' ' + d.content);
    else if (d.type === 'add') lines.push('+' + d.content);
    else lines.push('-' + d.content);
  }

  return lines.join('\n');
}

function computeDiff(
  original: string,
  modified: string,
  labelA: string,
  labelB: string,
  contextLines: number
) {
  const aLines = original.split('\n');
  const bLines = modified.split('\n');
  const diffs = diffLines(aLines, bLines);

  const added = diffs.filter((d) => d.type === 'add').length;
  const removed = diffs.filter((d) => d.type === 'remove').length;
  const unchanged = diffs.filter((d) => d.type === 'equal').length;
  const identical = added === 0 && removed === 0;

  const unified = buildUnifiedDiff(diffs, labelA, labelB, contextLines);

  return {
    identical,
    added_lines: added,
    removed_lines: removed,
    unchanged_lines: unchanged,
    unified_diff: unified.slice(0, 32768)
  };
}

// ============= TOOL HANDLERS =============

export const diffTextHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const original = String(args.original ?? '');
    const modified = String(args.modified ?? '');
    const contextLines = Math.min(Math.max(0, Number(args.context_lines) || 3), 10);

    const result = computeDiff(original, modified, 'original', 'modified', contextLines);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: `diff_text failed: ${err.message}` };
  }
};

export const diffFilesHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const fileA = path.resolve(String(args.file_a || ''));
    const fileB = path.resolve(String(args.file_b || ''));

    for (const p of [fileA, fileB]) {
      if (!p.toLowerCase().startsWith(HOME_DIR.toLowerCase())) {
        return { success: false, error: `File path must be within home directory: ${p}` };
      }
    }

    const [contentA, contentB] = await Promise.all([
      fs.promises.readFile(fileA, 'utf8'),
      fs.promises.readFile(fileB, 'utf8')
    ]);

    const contextLines = Math.min(Math.max(0, Number(args.context_lines) || 3), 10);
    const result = computeDiff(contentA, contentB, fileA, fileB, contextLines);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: `diff_files failed: ${err.message}` };
  }
};

// ============= EXPORTS =============

export const diffToolDefs: ToolDefinition[] = [diffTextDef, diffFilesDef];

export const diffToolHandlers: Record<string, ToolHandler> = {
  diff_text: diffTextHandler,
  diff_files: diffFilesHandler
};
