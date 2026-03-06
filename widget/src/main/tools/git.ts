/**
 * SADIE Git Tool
 *
 * Provides safe, read-mostly git operations (status, log, diff, branch, stash).
 * Write operations (commit, push) require user confirmation and are gated
 * to paths inside the user's home directory.
 */

import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execAsync = promisify(exec);
const HOME_DIR = os.homedir();

// ---- Safety: restrict repo paths to home directory ----
function validateRepoPath(repoPath: string): { valid: boolean; resolved: string; error?: string } {
  const resolved = path.resolve(repoPath || process.cwd());
  if (!resolved.toLowerCase().startsWith(HOME_DIR.toLowerCase())) {
    return { valid: false, resolved, error: `Repo path must be within home directory (${HOME_DIR})` };
  }
  return { valid: true, resolved };
}

async function git(args: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, { cwd, timeout: 15000, windowsHide: true });
  return stdout.trim();
}

// ============= TOOL DEFINITIONS =============

export const gitStatusDef: ToolDefinition = {
  name: 'git_status',
  description:
    'Show the working tree status of a git repository — staged files, unstaged changes, and untracked files.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      repo_path: {
        type: 'string',
        description: 'Absolute path to the git repository (defaults to the SADIE project root)'
      }
    },
    required: []
  }
};

export const gitLogDef: ToolDefinition = {
  name: 'git_log',
  description:
    'Show recent commit history for a repository. Returns commit hash, author, date, and message.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      repo_path: {
        type: 'string',
        description: 'Absolute path to the git repository'
      },
      limit: {
        type: 'number',
        description: 'Number of commits to return (default: 10, max: 50)',
        default: 10
      },
      branch: {
        type: 'string',
        description: 'Branch to inspect (defaults to current HEAD)'
      }
    },
    required: []
  }
};

export const gitDiffDef: ToolDefinition = {
  name: 'git_diff',
  description:
    'Show the diff between the working tree and HEAD (or between two commits/branches). ' +
    'Output is truncated to 8 KB.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      repo_path: {
        type: 'string',
        description: 'Absolute path to the git repository'
      },
      target: {
        type: 'string',
        description:
          'What to diff: "staged" (staged vs HEAD), "unstaged" (default), a file path, ' +
          'or a ref like "HEAD~1" or "main..feature"'
      }
    },
    required: []
  }
};

export const gitBranchesDef: ToolDefinition = {
  name: 'git_branches',
  description: 'List local (and optionally remote) branches in a repository.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      repo_path: {
        type: 'string',
        description: 'Absolute path to the git repository'
      },
      include_remote: {
        type: 'boolean',
        description: 'Include remote tracking branches (default: false)',
        default: false
      }
    },
    required: []
  }
};

export const gitCommitDef: ToolDefinition = {
  name: 'git_commit',
  description:
    'Stage all changes and create a git commit with the provided message. ' +
    'Requires user confirmation. Only allowed inside home directory.',
  category: 'utility',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      repo_path: {
        type: 'string',
        description: 'Absolute path to the git repository'
      },
      message: {
        type: 'string',
        description: 'The commit message'
      },
      stage_all: {
        type: 'boolean',
        description: 'Stage all tracked changes before committing (default: true)',
        default: true
      }
    },
    required: ['message']
  }
};

// ============= TOOL HANDLERS =============

const DEFAULT_REPO = path.join(HOME_DIR, 'Desktop', 'sadie');

export const gitStatusHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const repoPath = String(args.repo_path || DEFAULT_REPO).trim();
    const v = validateRepoPath(repoPath);
    if (!v.valid) return { success: false, error: v.error };

    const porcelain = await git('status --porcelain=v1', v.resolved);
    const branch = await git('rev-parse --abbrev-ref HEAD', v.resolved).catch(() => 'unknown');

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of porcelain.split('\n').filter(Boolean)) {
      const xy = line.slice(0, 2);
      const file = line.slice(3).trim();
      if (xy[0] !== ' ' && xy[0] !== '?') staged.push(`${xy[0]} ${file}`);
      if (xy[1] !== ' ' && xy[1] !== '?') unstaged.push(`${xy[1]} ${file}`);
      if (xy === '??') untracked.push(file);
    }

    return {
      success: true,
      result: { branch, staged, unstaged, untracked, clean: porcelain === '' }
    };
  } catch (err: any) {
    return { success: false, error: `git_status failed: ${err.message}` };
  }
};

export const gitLogHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const repoPath = String(args.repo_path || DEFAULT_REPO).trim();
    const v = validateRepoPath(repoPath);
    if (!v.valid) return { success: false, error: v.error };

    const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
    const branchArg = args.branch ? String(args.branch).replace(/[^a-zA-Z0-9_\-./]/g, '') : 'HEAD';

    const format = '%H|%an|%ae|%ad|%s';
    const output = await git(
      `log --pretty=format:"${format}" --date=short -n ${limit} ${branchArg}`,
      v.resolved
    );

    const commits = output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, author, email, date, ...msgParts] = line.replace(/^"|"$/g, '').split('|');
        return { hash, author, email, date, message: msgParts.join('|') };
      });

    return { success: true, result: { branch: branchArg, count: commits.length, commits } };
  } catch (err: any) {
    return { success: false, error: `git_log failed: ${err.message}` };
  }
};

export const gitDiffHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const repoPath = String(args.repo_path || DEFAULT_REPO).trim();
    const v = validateRepoPath(repoPath);
    if (!v.valid) return { success: false, error: v.error };

    const target = String(args.target || 'unstaged').trim();

    let diffCmd: string;
    if (target === 'staged') {
      diffCmd = 'diff --cached';
    } else if (target === 'unstaged') {
      diffCmd = 'diff';
    } else {
      const safeTarget = target.replace(/[^a-zA-Z0-9_\-./~: ]/g, '');
      diffCmd = `diff ${safeTarget}`;
    }

    const output = await git(diffCmd, v.resolved);
    const truncated = output.length > 8192;

    return {
      success: true,
      result: {
        diff: output.slice(0, 8192),
        truncated,
        total_chars: output.length
      }
    };
  } catch (err: any) {
    return { success: false, error: `git_diff failed: ${err.message}` };
  }
};

export const gitBranchesHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const repoPath = String(args.repo_path || DEFAULT_REPO).trim();
    const v = validateRepoPath(repoPath);
    if (!v.valid) return { success: false, error: v.error };

    const flag = args.include_remote ? '-a' : '';
    const output = await git(`branch ${flag} --format="%(refname:short)|%(objectname:short)|%(upstream:short)"`, v.resolved);
    const current = await git('rev-parse --abbrev-ref HEAD', v.resolved).catch(() => '');

    const branches = output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, hash, upstream] = line.replace(/^"|"$/g, '').split('|');
        return { name, hash, upstream: upstream || null, current: name === current };
      });

    return { success: true, result: { current, branches } };
  } catch (err: any) {
    return { success: false, error: `git_branches failed: ${err.message}` };
  }
};

export const gitCommitHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const repoPath = String(args.repo_path || DEFAULT_REPO).trim();
    const v = validateRepoPath(repoPath);
    if (!v.valid) return { success: false, error: v.error };

    const message = String(args.message || '').trim();
    if (!message) return { success: false, error: 'commit message is required' };

    const safeMessage = message.replace(/"/g, '\\"');
    if (args.stage_all !== false) {
      await git('add -A', v.resolved);
    }

    const output = await git(`commit -m "${safeMessage}"`, v.resolved);
    const hashLine = output.split('\n').find((l) => l.includes('['));

    return {
      success: true,
      result: { message, output: hashLine || output.slice(0, 200) }
    };
  } catch (err: any) {
    return { success: false, error: `git_commit failed: ${err.message}` };
  }
};

// ============= EXPORTS =============

export const gitToolDefs: ToolDefinition[] = [
  gitStatusDef,
  gitLogDef,
  gitDiffDef,
  gitBranchesDef,
  gitCommitDef
];

export const gitToolHandlers: Record<string, ToolHandler> = {
  git_status: gitStatusHandler,
  git_log: gitLogHandler,
  git_diff: gitDiffHandler,
  git_branches: gitBranchesHandler,
  git_commit: gitCommitHandler
};
