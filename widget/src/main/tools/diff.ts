/**
 * HomeBot Diff Tool
 *
 * Compares two text strings or two file contents line-by-line.
 * Returns a unified-diff-style result with added/removed lines.
 * Text comparison is pure TypeScript; IDE file reads verify held objects.
 */

import * as os from 'os';
import * as path from 'path';
import { isWithinHomeDir } from '../utils/home-boundary';
import { ToolDefinition, ToolHandler, ToolResult } from './types';
import { currentWorkspace, workspaceToolError } from '../workspace-context';
import { checkedTrustedWorkspacePath } from '../workspace-trust';
import { readBoundedDiffFiles } from '../bounded-diff-files';

const HOME_DIR = os.homedir();
export const DIFF_LIMITS = Object.freeze({ bytes: 256 * 1024, lines: 2000, cells: 1_000_000 });

function boundedLineCount(text: string): number {
  // Check the cheap UTF-16 length first, then exact UTF-8 bytes, before
  // splitting text or allocating the quadratic LCS table.
  if (text.length > DIFF_LIMITS.bytes || Buffer.byteLength(text, 'utf8') > DIFF_LIMITS.bytes) {
    throw new Error(`Diff input exceeds the ${DIFF_LIMITS.bytes}-byte limit. Compare a smaller excerpt.`);
  }
  let lines = 1;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10 && ++lines > DIFF_LIMITS.lines) {
      throw new Error(`Diff input exceeds the ${DIFF_LIMITS.lines}-line limit. Compare a smaller excerpt.`);
    }
  }
  return lines;
}

// ============= TOOL DEFINITIONS =============

export const diffTextDef: ToolDefinition = {
  name: 'diff_text',
  description:
    'Compare two text strings and show the differences line by line in unified diff format. ' +
    'Useful for spotting changes between two versions of text, code, or configs. ' +
    'Inputs are limited to 256 KiB and 2000 lines each, with a bounded comparison budget; use excerpts for larger changes.',
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
    'In the IDE, both paths must be inside the active project; relative paths resolve there. ' +
    'In HomeBot chat, both paths must be inside the user home directory. ' +
    'Files are limited to 256 KiB and 2000 lines each, with a bounded comparison budget.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      file_a: {
        type: 'string',
        description: 'First (original) file path; relative to the active project in the IDE, otherwise absolute'
      },
      file_b: {
        type: 'string',
        description: 'Second (modified) file path; relative to the active project in the IDE, otherwise absolute'
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
  const aCount = boundedLineCount(original), bCount = boundedLineCount(modified);
  if ((aCount + 1) * (bCount + 1) > DIFF_LIMITS.cells) {
    throw new Error(`Diff exceeds the ${DIFF_LIMITS.cells}-cell comparison budget. Compare smaller excerpts.`);
  }
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
    const denied = workspaceToolError('diff_text');
    if (denied) return { success: false, error: denied };
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
    const denied = workspaceToolError('diff_files');
    if (denied) return { success: false, error: denied };
    const workspace = currentWorkspace();
    // Validate both sides before either read. A mixed in/out-of-project diff
    // cannot read its first side and then discover the second is forbidden.
    const fileA = workspace ? checkedTrustedWorkspacePath(workspace.root, args.file_a) : path.resolve(String(args.file_a || ''));
    const fileB = workspace ? checkedTrustedWorkspacePath(workspace.root, args.file_b) : path.resolve(String(args.file_b || ''));

    for (const p of workspace ? [] : [fileA, fileB]) {
      if (!isWithinHomeDir(p, HOME_DIR)) {
        return { success: false, error: `File path must be within home directory: ${p}` };
      }
    }

    const [contentA, contentB] = await readBoundedDiffFiles([fileA, fileB], DIFF_LIMITS.bytes);

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
