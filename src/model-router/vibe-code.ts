/**
 * "Vibe code from chat": /code <task> -> the router picks a tier -> the model
 * proposes a unified diff -> chat shows it with Approve / Reject.
 *
 * Nothing is written until the user approves. Approval writes ONLY a new
 * branch (homebot/vibe-<timestamp>): the patch is applied to a temporary git
 * index built from the base commit, committed with commit-tree, and the new
 * branch ref is created with update-ref. The user's working tree, index,
 * current branch and main are never touched, and nothing is pushed.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git } from './git';
import { formatRouteBadge, stableSessionId, type ModelRouter, type RouteResult, type RouterMessage } from './client';

export const VIBE_BRANCH_PREFIX = 'homebot/vibe-';

/** `/code <task>`. Returns the task ('' for a bare /code), or null when not a /code message. */
export function parseCodeCommand(input: string): string | null {
  const m = /^\/code(?:\s+([\s\S]*))?$/i.exec((input || '').trim());
  if (!m) return null;
  return (m[1] || '').trim();
}

/**
 * Conservative coding-intent detection: an imperative code verb AND an
 * explicit source-file path. "fix the typo in src/app.ts" matches;
 * "can you fix my day" or "what is TypeScript" never do.
 */
const INTENT_VERB = /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:fix|add|implement|refactor|rename|change|update|remove|write|create)\b/i;
const SOURCE_PATH = /(?:^|\s|`)((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|css|scss|html|json|md|yml|yaml|sh|ps1))\b/i;
export function detectCodingIntent(message: string): boolean {
  const text = (message || '').trim();
  if (!text || text.startsWith('/') || text.length > 2000) return false;
  return INTENT_VERB.test(text) && SOURCE_PATH.test(text);
}

/** Pull a unified diff out of a model reply (```diff fence, or a bare diff). */
export function extractUnifiedDiff(text: string): string | null {
  const fence = /```(?:diff|patch)?[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text || ''))) {
    if (/^(?:diff --git |--- )/m.test(m[1])) return m[1].endsWith('\n') ? m[1] : m[1] + '\n';
  }
  const start = (text || '').search(/^(?:diff --git |--- )/m);
  if (start === -1) return null;
  const body = text.slice(start);
  return body.endsWith('\n') ? body : body + '\n';
}

export interface DiffStats {
  files: string[];
  added: number;
  removed: number;
}

export function diffStats(diff: string): DiffStats {
  const files = new Set<string>();
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    const header = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    const removedHeader = /^--- (?:a\/)?(.+)$/.exec(line);
    if (header) { if (header[1] !== '/dev/null') files.add(header[1].trim()); continue; }
    if (removedHeader) { if (removedHeader[1] !== '/dev/null') files.add(removedHeader[1].trim()); continue; }
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { files: [...files], added, removed };
}

/** The dry-run proposal: a new file, so it applies to any repo and the approve flow can be tried for free. */
export function mockVibeDiff(task: string): string {
  const lines = [
    '# HomeBot vibe-code dry run',
    '',
    'This file is a MOCK change. No model was called and nothing was billed.',
    `Task: ${task.replace(/\s+/g, ' ').slice(0, 200)}`,
  ];
  return [
    'diff --git a/homebot-vibe-dry-run.md b/homebot-vibe-dry-run.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/homebot-vibe-dry-run.md',
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map(l => `+${l}`),
    '',
  ].join('\n');
}

const MAX_CONTEXT_FILES = 3;
const MAX_FILE_BYTES = 20_000;

export async function collectRepoContext(repoRoot: string, task: string): Promise<{ fileList: string[]; snippets: Array<{ path: string; text: string }> }> {
  const listed = (await git(repoRoot, ['ls-files'])).split('\n').filter(Boolean);
  const named = new Set<string>();
  for (const m of task.matchAll(/((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+)/g)) named.add(m[1]);
  const snippets: Array<{ path: string; text: string }> = [];
  for (const candidate of named) {
    if (snippets.length >= MAX_CONTEXT_FILES) break;
    const match = listed.find(f => f === candidate || f.endsWith(`/${candidate}`));
    if (!match) continue;
    const full = path.join(repoRoot, match);
    try {
      const stat = fs.statSync(full);
      if (stat.size > MAX_FILE_BYTES) continue;
      snippets.push({ path: match, text: fs.readFileSync(full, 'utf8') });
    } catch { /* unreadable: skip */ }
  }
  return { fileList: listed.slice(0, 300), snippets };
}

export function buildVibeMessages(task: string, context: { fileList: string[]; snippets: Array<{ path: string; text: string }> }): RouterMessage[] {
  const system = [
    'You are a careful coding agent working in a git repository.',
    'Reply with ONLY a unified diff in git format (diff --git a/... b/..., --- a/..., +++ b/..., @@ hunks) inside one ```diff fenced block.',
    'Paths are relative to the repository root. Keep the change minimal. No prose outside the diff.',
  ].join('\n');
  const parts = [`Repository files (first ${context.fileList.length}):\n${context.fileList.join('\n')}`];
  for (const s of context.snippets) parts.push(`--- ${s.path} ---\n${s.text}`);
  parts.push(`Task: ${task}`);
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

export interface VibeProposal {
  id: string;
  task: string;
  repoRoot: string;
  baseCommit: string;
  baseBranch: string;
  diff: string;
  stats: DiffStats;
  route: RouteResult;
  createdAt: Date;
}

export class VibeCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VibeCodeError';
  }
}

async function repoTop(dir: string): Promise<string> {
  try {
    return (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    throw new VibeCodeError(`${dir} is not a git repository. Set a project with /project <path> first.`);
  }
}

async function withTempIndex<T>(fn: (env: Record<string, string>) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-vibe-'));
  try {
    return await fn({ GIT_INDEX_FILE: path.join(dir, 'index') });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Check the diff applies cleanly to baseCommit, without touching the working tree or real index. */
export async function checkDiffApplies(repoRoot: string, baseCommit: string, diff: string): Promise<void> {
  await withTempIndex(async env => {
    await git(repoRoot, ['read-tree', baseCommit], { env });
    try {
      await git(repoRoot, ['apply', '--cached', '--check', '--whitespace=nowarn', '-'], { env, input: diff });
    } catch (e) {
      throw new VibeCodeError(`The proposed diff does not apply to ${baseCommit.slice(0, 8)}: ${(e as Error).message}`);
    }
  });
}

export async function proposeVibeChange(options: { router: ModelRouter; repoRoot: string; task: string; sessionId?: string }): Promise<VibeProposal> {
  const task = options.task.trim();
  if (!task) throw new VibeCodeError('Usage: /code <what to change>');
  const repoRoot = await repoTop(options.repoRoot);
  const baseCommit = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
  const baseBranch = (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const context = await collectRepoContext(repoRoot, task);
  const route = await options.router.complete({
    task,
    messages: buildVibeMessages(task, context),
    files: Math.max(1, context.snippets.length),
    diffLines: -1,
    sessionId: options.sessionId ?? stableSessionId(`vibe:${repoRoot}:${task}`),
    source: 'vibe-code',
    mockContent: '```diff\n' + mockVibeDiff(task) + '```',
  });
  const diff = extractUnifiedDiff(route.content);
  if (!diff) throw new VibeCodeError(`${route.model} did not return a unified diff. Nothing was written.`);
  await checkDiffApplies(repoRoot, baseCommit, diff);
  return { id: randomUUID(), task, repoRoot, baseCommit, baseBranch, diff, stats: diffStats(diff), route, createdAt: new Date() };
}

export function vibeBranchName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${VIBE_BRANCH_PREFIX}${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

async function refExists(repoRoot: string, ref: string): Promise<boolean> {
  try { await git(repoRoot, ['show-ref', '--verify', '--quiet', ref]); return true; } catch { return false; }
}

async function identityEnv(repoRoot: string): Promise<Record<string, string>> {
  try {
    const email = (await git(repoRoot, ['config', 'user.email'])).trim();
    if (email) return {};
  } catch { /* not configured */ }
  return {
    GIT_AUTHOR_NAME: 'HomeBot', GIT_AUTHOR_EMAIL: 'homebot@localhost',
    GIT_COMMITTER_NAME: 'HomeBot', GIT_COMMITTER_EMAIL: 'homebot@localhost',
  };
}

export interface VibeApplyResult {
  branch: string;
  commit: string;
  baseBranch: string;
}

/**
 * Commit an approved proposal to a NEW homebot/vibe-* branch. The working
 * tree, the real index, HEAD and every existing branch are left untouched.
 */
export async function applyVibeProposal(proposal: VibeProposal, now: Date = new Date()): Promise<VibeApplyResult> {
  const repoRoot = proposal.repoRoot;
  let branch = vibeBranchName(now);
  for (let i = 2; await refExists(repoRoot, `refs/heads/${branch}`); i++) branch = `${vibeBranchName(now)}-${i}`;
  if (!branch.startsWith(VIBE_BRANCH_PREFIX) || branch === proposal.baseBranch || /^(?:main|master)$/.test(branch)) {
    throw new VibeCodeError(`Refusing to write to branch ${branch}`);
  }
  await git(repoRoot, ['check-ref-format', '--branch', branch]);
  const idEnv = await identityEnv(repoRoot);
  const commit = await withTempIndex(async env => {
    await git(repoRoot, ['read-tree', proposal.baseCommit], { env });
    await git(repoRoot, ['apply', '--cached', '--whitespace=nowarn', '-'], { env, input: proposal.diff });
    const tree = (await git(repoRoot, ['write-tree'], { env })).trim();
    const message = `HomeBot vibe-code: ${proposal.task.replace(/\s+/g, ' ').slice(0, 72)}\n\nModel: ${proposal.route.model} (${proposal.route.tier} tier)${proposal.route.dryRun ? ' [DRY RUN MOCK]' : ''}\n`;
    return (await git(repoRoot, ['commit-tree', tree, '-p', proposal.baseCommit, '-F', '-'], { env: { ...env, ...idEnv }, input: message })).trim();
  });
  // Empty old value: create only, fail if the ref appeared meanwhile.
  await git(repoRoot, ['update-ref', `refs/heads/${branch}`, commit, '']);
  return { branch, commit, baseBranch: proposal.baseBranch };
}

export function formatVibePreview(proposal: VibeProposal): string {
  const { stats } = proposal;
  return [
    `**Vibe-code proposal** for \`${proposal.task.slice(0, 120)}\``,
    '',
    formatRouteBadge(proposal.route),
    '',
    `${stats.files.length} file(s), +${stats.added} −${stats.removed}: ${stats.files.map(f => `\`${f}\``).join(', ')}`,
    '',
    '```diff',
    proposal.diff.trimEnd(),
    '```',
    '',
    `Nothing has been written. **Approve** commits this to a new \`${VIBE_BRANCH_PREFIX}…\` branch (your current branch \`${proposal.baseBranch}\` and working tree are not touched, nothing is pushed). **Reject** discards it.`,
  ].join('\n');
}

export interface VibeTurnIO {
  /** Append markdown to the chat reply. */
  send(markdown: string): void;
  /** Ask Approve / Reject. Resolves true only on an explicit approve. */
  confirm(summary: string): Promise<boolean>;
}

export type VibeTurnOutcome =
  | { status: 'help' }
  | { status: 'error'; error: string }
  | { status: 'rejected'; proposal: VibeProposal }
  | { status: 'approved'; proposal: VibeProposal; result: VibeApplyResult };

/** One chat turn of vibe-code: propose, preview, ask, then apply or discard. */
export async function runVibeCodeTurn(options: {
  task: string;
  repoRoot: string | undefined;
  router: ModelRouter;
  io: VibeTurnIO;
  now?: () => Date;
}): Promise<VibeTurnOutcome> {
  const { io } = options;
  if (!options.task.trim()) {
    io.send('Usage: `/code <what to change>`. HomeBot proposes a diff, shows it here, and writes nothing until you approve.');
    return { status: 'help' };
  }
  if (!options.repoRoot) {
    const error = 'No project folder is set. Use `/project <path>` (a git repo) first, then `/code <task>`.';
    io.send(`⚠️ ${error}`);
    return { status: 'error', error };
  }
  let proposal: VibeProposal;
  try {
    proposal = await proposeVibeChange({ router: options.router, repoRoot: options.repoRoot, task: options.task });
  } catch (e) {
    const error = (e as Error).message || String(e);
    io.send(`⚠️ Vibe-code stopped: ${error}`);
    return { status: 'error', error };
  }
  io.send(formatVibePreview(proposal));
  const approved = await io.confirm(
    `Commit ${proposal.stats.files.length} file(s) (+${proposal.stats.added} −${proposal.stats.removed}) to a new ${VIBE_BRANCH_PREFIX}… branch? The diff is shown in chat. Your current branch and working tree stay untouched; nothing is pushed.`,
  );
  if (!approved) {
    io.send('\n\n❌ Rejected. Nothing was written.');
    return { status: 'rejected', proposal };
  }
  try {
    const result = await applyVibeProposal(proposal, (options.now ?? (() => new Date()))());
    io.send(`\n\n✅ Committed ${result.commit.slice(0, 8)} to new branch \`${result.branch}\` (based on \`${result.baseBranch}\`). Your working tree and \`${result.baseBranch}\` were not changed and nothing was pushed. Run \`git switch ${result.branch}\` to try it.`);
    return { status: 'approved', proposal, result };
  } catch (e) {
    const error = (e as Error).message || String(e);
    io.send(`\n\n⚠️ Could not commit the approved diff: ${error}. No branch was created.`);
    return { status: 'error', error };
  }
}
