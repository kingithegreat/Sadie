import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ModelRouter } from '../client';
import { REPO_DEFAULT_CONFIG_PATH, loadRouterConfig } from '../config';
import { SpendLedger } from '../ledger';
import {
  applyVibeProposal, detectCodingIntent, diffStats, extractUnifiedDiff, parseCodeCommand, proposeVibeChange, runVibeCodeTurn,
} from '../vibe-code';
import { LIVE_ENV, completion, forbidRealFetch, mockFetch, tempDir } from './helpers';

forbidRealFetch();

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo(): string {
  const dir = tempDir('vibe-repo-');
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 'test@example.com');
  sh(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'hello.ts'), 'export const greeting = "helo";\n');
  sh(dir, 'add', 'hello.ts');
  sh(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const FIX_DIFF = [
  'diff --git a/hello.ts b/hello.ts',
  '--- a/hello.ts',
  '+++ b/hello.ts',
  '@@ -1 +1 @@',
  '-export const greeting = "helo";',
  '+export const greeting = "hello";',
  '',
].join('\n');

function router(env: Record<string, string | undefined>, replies: Parameters<typeof mockFetch>[0] = []) {
  const ledgerDir = tempDir();
  const config = loadRouterConfig({ path: REPO_DEFAULT_CONFIG_PATH, env: { ...env, MODEL_ROUTER_LEDGER: path.join(ledgerDir, 'ledger.json') } });
  const mock = mockFetch(replies);
  return { router: new ModelRouter({ config, ledger: new SpendLedger(config.ledgerPath, config.monthlyCapUsd), fetch: mock.fetch, env }), calls: mock.calls };
}

function snapshot(repo: string) {
  return {
    head: sh(repo, 'rev-parse', 'HEAD'),
    branch: sh(repo, 'rev-parse', '--abbrev-ref', 'HEAD'),
    branches: sh(repo, 'branch', '--format=%(refname:short)'),
    status: sh(repo, 'status', '--porcelain'),
    file: fs.readFileSync(path.join(repo, 'hello.ts'), 'utf8'),
  };
}

describe('/code trigger and intent', () => {
  it('parses /code commands', () => {
    expect(parseCodeCommand('/code fix the typo in hello.ts')).toBe('fix the typo in hello.ts');
    expect(parseCodeCommand('  /CODE   add tests ')).toBe('add tests');
    expect(parseCodeCommand('/code')).toBe('');
    expect(parseCodeCommand('/coder x')).toBeNull();
    expect(parseCodeCommand('please /code x')).toBeNull();
    expect(parseCodeCommand('/compact')).toBeNull();
  });

  it('detects coding intent conservatively', () => {
    expect(detectCodingIntent('fix the typo in src/hello.ts')).toBe(true);
    expect(detectCodingIntent('please add a test to parser.test.ts')).toBe(true);
    expect(detectCodingIntent('can you fix my day')).toBe(false);
    expect(detectCodingIntent('what is TypeScript?')).toBe(false);
    expect(detectCodingIntent('I read hello.ts yesterday')).toBe(false);
    expect(detectCodingIntent('/code fix hello.ts')).toBe(false);
  });

  it('extracts diffs from fenced or bare replies', () => {
    expect(extractUnifiedDiff('Here:\n```diff\n' + FIX_DIFF + '```\nDone')).toBe(FIX_DIFF);
    expect(extractUnifiedDiff(FIX_DIFF)).toBe(FIX_DIFF);
    expect(extractUnifiedDiff('no diff here')).toBeNull();
    expect(diffStats(FIX_DIFF)).toEqual({ files: ['hello.ts'], added: 1, removed: 1 });
  });
});

describe('vibe-code flow (temp git repo, mocked fetch)', () => {
  it('reject writes nothing', async () => {
    const repo = makeRepo();
    const before = snapshot(repo);
    const { router: r } = router(LIVE_ENV, [completion('```diff\n' + FIX_DIFF + '```', { model: 'qwen/qwen3.7-flash', cost: 0.001 })]);
    const sent: string[] = [];
    const outcome = await runVibeCodeTurn({ task: 'fix typo in hello.ts', repoRoot: repo, router: r, io: { send: m => sent.push(m), confirm: async () => false } });
    expect(outcome.status).toBe('rejected');
    expect(snapshot(repo)).toEqual(before);
    expect(sent.join('')).toMatch(/Rejected\. Nothing was written/);
  });

  it('approve writes only to a new homebot/vibe-* branch', async () => {
    const repo = makeRepo();
    const before = snapshot(repo);
    const { router: r } = router(LIVE_ENV, [completion('```diff\n' + FIX_DIFF + '```', { model: 'qwen/qwen3.7-flash', cost: 0.001 })]);
    const sent: string[] = [];
    const outcome = await runVibeCodeTurn({
      task: 'fix typo in hello.ts', repoRoot: repo, router: r,
      io: { send: m => sent.push(m), confirm: async () => true },
      now: () => new Date('2026-11-10T06:30:00Z'),
    });
    expect(outcome.status).toBe('approved');
    if (outcome.status !== 'approved') return;
    expect(outcome.result.branch).toBe('homebot/vibe-20261110-063000');
    const after = snapshot(repo);
    // Working tree, index, current branch and main are untouched.
    expect(after.head).toBe(before.head);
    expect(after.branch).toBe('main');
    expect(after.status).toBe('');
    expect(after.file).toBe(before.file);
    expect(sh(repo, 'rev-parse', 'main')).toBe(before.head);
    // The change is on the vibe branch, as one commit on top of main.
    expect(sh(repo, 'show', `${outcome.result.branch}:hello.ts`)).toBe('export const greeting = "hello";');
    expect(sh(repo, 'rev-parse', `${outcome.result.branch}^`)).toBe(before.head);
    expect(sh(repo, 'log', '-1', '--format=%s', outcome.result.branch)).toMatch(/^HomeBot vibe-code: fix typo/);
    expect(sh(repo, 'remote')).toBe('');
    expect(sent.join('')).toMatch(/Committed .* to new branch `homebot\/vibe-20261110-063000`/);
  });

  it('a second approval in the same second gets a distinct branch', async () => {
    const repo = makeRepo();
    const { router: r } = router(LIVE_ENV, () => completion('```diff\n' + FIX_DIFF + '```', { cost: 0.001 }));
    const now = new Date('2026-11-10T06:30:00Z');
    const p1 = await proposeVibeChange({ router: r, repoRoot: repo, task: 'fix hello.ts' });
    const p2 = await proposeVibeChange({ router: r, repoRoot: repo, task: 'fix hello.ts' });
    expect((await applyVibeProposal(p1, now)).branch).toBe('homebot/vibe-20261110-063000');
    expect((await applyVibeProposal(p2, now)).branch).toBe('homebot/vibe-20261110-063000-2');
  });

  it('shows the model and cost in chat (live)', async () => {
    const repo = makeRepo();
    const { router: r } = router(LIVE_ENV, [completion('```diff\n' + FIX_DIFF + '```', { model: 'qwen/qwen3.7-flash', cost: 0.00123 })]);
    const sent: string[] = [];
    await runVibeCodeTurn({ task: 'fix typo in hello.ts', repoRoot: repo, router: r, io: { send: m => sent.push(m), confirm: async () => false } });
    const preview = sent[0];
    expect(preview).toMatch(/Model: qwen\/qwen3\.7-flash \(cheap tier\)/);
    expect(preview).toMatch(/Cost: \$0\.00123/);
    expect(preview).not.toMatch(/mock/);
    expect(preview).toContain('```diff');
  });

  it('dry run: proposes a mock diff, labels cost as mock, sends nothing', async () => {
    const repo = makeRepo();
    const before = snapshot(repo);
    const { router: r, calls } = router({});
    const sent: string[] = [];
    const outcome = await runVibeCodeTurn({ task: 'add a note', repoRoot: repo, router: r, io: { send: m => sent.push(m), confirm: async () => true }, now: () => new Date('2026-11-10T07:00:00Z') });
    expect(calls).toHaveLength(0);
    expect(sent[0]).toMatch(/mock estimate, dry run, nothing was sent or billed/);
    expect(outcome.status).toBe('approved');
    if (outcome.status !== 'approved') return;
    expect(sh(repo, 'show', `${outcome.result.branch}:homebot-vibe-dry-run.md`)).toMatch(/MOCK change/);
    expect(snapshot(repo)).toEqual({ ...before, branches: `homebot/vibe-20261110-070000\nmain` });
  });

  it('a diff that does not apply is refused before asking', async () => {
    const repo = makeRepo();
    const bad = FIX_DIFF.replace('"helo"', '"nope"');
    const { router: r } = router(LIVE_ENV, [completion('```diff\n' + bad + '```', { cost: 0.001 })]);
    const confirm = jest.fn(async () => true);
    const outcome = await runVibeCodeTurn({ task: 'fix hello.ts', repoRoot: repo, router: r, io: { send: () => undefined, confirm } });
    expect(outcome.status).toBe('error');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('needs a project and a task', async () => {
    const { router: r } = router({});
    const sent: string[] = [];
    expect((await runVibeCodeTurn({ task: '', repoRoot: '/tmp', router: r, io: { send: m => sent.push(m), confirm: async () => true } })).status).toBe('help');
    expect((await runVibeCodeTurn({ task: 'x', repoRoot: undefined, router: r, io: { send: m => sent.push(m), confirm: async () => true } })).status).toBe('error');
    expect(sent.join('\n')).toMatch(/\/project <path>/);
  });
});
