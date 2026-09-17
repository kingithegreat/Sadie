/**
 * workspace-git.ts — source control for the Workspace's Source Control panel.
 *
 * The assistant already had git tools (tools/git.ts), but a person in the IDE
 * had no way to see what changed, stage it or commit it without the chat. This
 * module is the panel's backend: git runs with an ARGV array (never a shell),
 * only for folders inside the home directory, and only in the repository that
 * contains the folder the Workspace has open.
 */

import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { validatePath } from './tools/filesystem';

const execFileAsync = promisify(execFile);
const OUTSIDE_HOME = 'Source control only works for folders inside your home folder.';

export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted' | 'type-changed';

export interface GitChange {
  /** Path relative to the repository root, forward slashes. */
  path: string;
  /** For renames and copies: where it came from. */
  from?: string;
  kind: GitChangeKind;
}

export interface GitStatus {
  isRepo: boolean;
  root?: string;
  branch?: string;
  staged: GitChange[];
  unstaged: GitChange[];
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 20_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

function gitError(e: unknown): string {
  const err = e as { stderr?: string; message?: string };
  const text = (err.stderr || err.message || String(e)).trim();
  return text.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 400) || 'git failed.';
}

/** The repository containing a folder inside home, or null when it is not in one. */
async function repoRoot(folder: string): Promise<string | null> {
  const v = validatePath(folder);
  if (!v.valid) throw new Error(OUTSIDE_HOME);
  try {
    const top = (await git(['rev-parse', '--show-toplevel'], v.resolved)).trim();
    if (!top) return null;
    const checked = validatePath(top);
    if (!checked.valid) throw new Error(OUTSIDE_HOME);
    return checked.resolved;
  } catch (e) {
    if ((e as Error).message === OUTSIDE_HOME) throw e;
    return null;
  }
}

const KIND: Record<string, GitChangeKind> = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed', U: 'conflicted',
};

/** Parse `git status --porcelain=v1 -z`: NUL-separated, renames carry the source as the next field. */
export function parsePorcelainZ(output: string): { staged: GitChange[]; unstaged: GitChange[] } {
  const staged: GitChange[] = [];
  const unstaged: GitChange[] = [];
  const fields = output.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry || entry.length < 4) continue;
    const x = entry[0]!;
    const y = entry[1]!;
    const file = entry.slice(3);
    let from: string | undefined;
    if (x === 'R' || x === 'C') from = fields[++i];
    if (x === '?' && y === '?') { unstaged.push({ path: file, kind: 'untracked' }); continue; }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      unstaged.push({ path: file, kind: 'conflicted' });
      continue;
    }
    if (x !== ' ' && KIND[x]) staged.push({ path: file, kind: KIND[x]!, ...(from ? { from } : {}) });
    if (y !== ' ' && KIND[y]) unstaged.push({ path: file, kind: KIND[y]! });
  }
  return { staged, unstaged };
}

export async function gitWorkspaceStatus(folder: string): Promise<GitStatus> {
  const root = await repoRoot(folder);
  if (!root) return { isRepo: false, staged: [], unstaged: [] };
  const [porcelain, branch] = await Promise.all([
    git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root),
    git(['rev-parse', '--abbrev-ref', 'HEAD'], root).then(s => s.trim()).catch(() => ''),
  ]);
  return { isRepo: true, root, branch: branch === 'HEAD' ? '(detached)' : branch || '(no commits yet)', ...parsePorcelainZ(porcelain) };
}

/** Repository-relative paths only; nothing that climbs out of the repository. */
function safeRelPaths(root: string, files: unknown): string[] {
  if (!Array.isArray(files) || files.length === 0) throw new Error('Choose at least one file.');
  return files.map(f => {
    if (typeof f !== 'string' || !f.trim()) throw new Error('Choose a valid file.');
    const abs = path.resolve(root, f);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('That file is outside the repository.');
    return rel.split(path.sep).join('/');
  });
}

export async function gitWorkspaceStage(folder: string, files: unknown): Promise<void> {
  const root = await repoRoot(folder);
  if (!root) throw new Error('This folder is not in a git repository.');
  await git(['add', '--', ...safeRelPaths(root, files)], root).catch(e => { throw new Error(gitError(e)); });
}

export async function gitWorkspaceUnstage(folder: string, files: unknown): Promise<void> {
  const root = await repoRoot(folder);
  if (!root) throw new Error('This folder is not in a git repository.');
  const rel = safeRelPaths(root, files);
  // `restore --staged` needs a HEAD; a repository with no commits yet uses rm --cached.
  const hasHead = await git(['rev-parse', '--verify', 'HEAD'], root).then(() => true, () => false);
  const args = hasHead ? ['restore', '--staged', '--', ...rel] : ['rm', '--cached', '-r', '--quiet', '--', ...rel];
  await git(args, root).catch(e => { throw new Error(gitError(e)); });
}

export async function gitWorkspaceCommit(folder: string, message: unknown): Promise<{ hash: string }> {
  const root = await repoRoot(folder);
  if (!root) throw new Error('This folder is not in a git repository.');
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) throw new Error('Write a commit message first.');
  const staged = await git(['diff', '--cached', '--name-only', '-z'], root);
  if (!staged.replace(/\0/g, '')) throw new Error('Stage at least one change before committing.');
  await git(['commit', '-m', text.slice(0, 5000)], root).catch(e => { throw new Error(gitError(e)); });
  return { hash: (await git(['rev-parse', '--short', 'HEAD'], root)).trim() };
}

export async function gitWorkspaceBranches(folder: string): Promise<{ current: string; branches: string[] }> {
  const root = await repoRoot(folder);
  if (!root) throw new Error('This folder is not in a git repository.');
  const out = await git(['branch', '--format=%(refname:short)'], root);
  const current = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], root).catch(() => '')).trim();
  return { current, branches: out.split('\n').map(s => s.trim()).filter(Boolean) };
}

export async function gitWorkspaceCheckout(folder: string, branch: unknown): Promise<void> {
  const root = await repoRoot(folder);
  if (!root) throw new Error('This folder is not in a git repository.');
  const { branches } = await gitWorkspaceBranches(folder);
  if (typeof branch !== 'string' || !branches.includes(branch)) throw new Error('Choose one of the existing branches.');
  // `switch` refuses when local changes would be overwritten, and says which files.
  await git(['switch', branch], root).catch(e => { throw new Error(gitError(e)); });
}
