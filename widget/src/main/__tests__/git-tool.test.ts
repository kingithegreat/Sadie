/**
 * Git Tool Tests
 *
 * The tool invokes `execFile('git', args)` — arguments go to git as an ARGV
 * array and never through a shell, so these tests assert on the args arrays.
 * The pre-argv tests asserted shell-shaped strings ("commit -m \"...\"") and
 * character whitelisting that only existed to survive `exec("git " + cmd)`;
 * those guards were the vulnerability's footprint, not its fix.
 */

import * as os from 'os';
import * as path from 'path';

// Mock child_process — callback style, as promisify(execFile) expects.
const mockExecFileImpl = jest.fn();
jest.mock('child_process', () => ({ execFile: mockExecFileImpl }));

function mockResolve(stdout: string) {
  mockExecFileImpl.mockImplementation((_file: string, _args: string[], _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, { stdout, stderr: '' });
  });
}

function mockReject(message: string) {
  mockExecFileImpl.mockImplementation((_file: string, _args: string[], _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(new Error(message), null);
  });
}

/** One stdout per successive execFile call (handlers often make two). */
function mockResolveSequence(stdouts: string[]) {
  for (const stdout of stdouts) {
    mockExecFileImpl.mockImplementationOnce((_file: string, _args: string[], _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (callback) callback(null, { stdout, stderr: '' });
    });
  }
}

/** The argv of the Nth execFile call (0-based). */
function nthArgs(n: number): string[] {
  return mockExecFileImpl.mock.calls[n][1];
}

import {
  gitStatusHandler,
  gitLogHandler,
  gitDiffHandler,
  gitBranchesHandler,
  gitCommitHandler,
  gitStatusDef,
  gitLogDef,
  gitDiffDef,
  gitBranchesDef,
  gitCommitDef
} from '../tools/git';

const HOME = os.homedir();
const SAFE_REPO = path.join(HOME, 'Desktop', 'homebot');

beforeEach(() => jest.clearAllMocks());

// ── Tool Definitions ──

describe('git tool definitions', () => {
  test('gitStatusDef has no required params', () => {
    expect(gitStatusDef.parameters.required).toHaveLength(0);
    expect(gitStatusDef.name).toBe('git_status');
    expect(gitStatusDef.category).toBe('utility');
  });

  test('gitLogDef has optional limit and branch', () => {
    expect(gitLogDef.parameters.required).toHaveLength(0);
    expect(gitLogDef.parameters.properties).toHaveProperty('limit');
    expect(gitLogDef.parameters.properties).toHaveProperty('branch');
  });

  test('gitDiffDef has optional target', () => {
    expect(gitDiffDef.parameters.required).toHaveLength(0);
    expect(gitDiffDef.parameters.properties).toHaveProperty('target');
  });

  test('gitBranchesDef has optional include_remote', () => {
    expect(gitBranchesDef.parameters.properties).toHaveProperty('include_remote');
  });

  test('gitCommitDef requiresConfirmation and requires message', () => {
    expect(gitCommitDef.requiresConfirmation).toBe(true);
    expect(gitCommitDef.parameters.required).toContain('message');
  });
});

// ── git_status ──

describe('gitStatusHandler', () => {
  test('parses porcelain output correctly', async () => {
    mockResolveSequence(['M  src/foo.ts\n?? newfile.ts\n', 'main\n']);

    const res = await gitStatusHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.branch).toBe('main');
    expect(res.result.untracked).toContain('newfile.ts');
    // First call is status, second resolves the branch name
    expect(nthArgs(0)).toEqual(['status', '--porcelain=v1']);
    expect(nthArgs(1)).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
  });

  test('rejects repo outside home dir', async () => {
    const res = await gitStatusHandler({ repo_path: 'C:\\Windows\\System32' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('rejects a sibling directory that merely prefixes home', async () => {
    // C:\Users\<user>-evil must not pass a C:\Users\<user> check
    const sibling = HOME + '-evil\\repo';
    const res = await gitStatusHandler({ repo_path: sibling }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('reports clean when no modifications', async () => {
    mockResolve('');

    const res = await gitStatusHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.clean).toBe(true);
  });

  test('detects staged files', async () => {
    mockResolve('A  newfile.ts\nM  edited.ts\n');

    const res = await gitStatusHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.staged.length).toBe(2);
    expect(res.result.staged[0]).toContain('newfile.ts');
  });

  test('handles exec failure gracefully', async () => {
    mockReject('Not a git repository');
    const res = await gitStatusHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('git_status failed');
  });
});

// ── git_log ──

describe('gitLogHandler', () => {
  test('parses commit log', async () => {
    const logOutput =
      '"abc123|Alice|alice@x.com|2026-03-01|Initial commit"\n' +
      '"def456|Bob|bob@x.com|2026-03-02|Add feature"';
    mockResolve(logOutput);

    const res = await gitLogHandler({ repo_path: SAFE_REPO, limit: 5 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.commits.length).toBe(2);
    expect(res.result.commits[0].hash).toBe('abc123');
    expect(res.result.commits[0].author).toBe('Alice');
    expect(res.result.commits[0].email).toBe('alice@x.com');
    expect(res.result.commits[0].date).toBe('2026-03-01');
  });

  test('respects limit', async () => {
    mockResolve('"abc|A|a@b.com|2026-03-01|msg"');
    const res = await gitLogHandler({ repo_path: SAFE_REPO, limit: 1 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.commits.length).toBeLessThanOrEqual(1);
  });

  test('clamps limit to 50 max', async () => {
    mockResolve('"abc|A|a@b.com|2026-03-01|msg"');
    await gitLogHandler({ repo_path: SAFE_REPO, limit: 999 }, {} as any);
    const args = nthArgs(0);
    const nIdx = args.indexOf('-n');
    expect(args[nIdx + 1]).toBe('50');
  });

  test('accepts branch argument', async () => {
    mockResolve('"abc|A|a@b.com|2026-03-01|msg"');
    await gitLogHandler({ repo_path: SAFE_REPO, branch: 'develop' }, {} as any);
    expect(nthArgs(0)).toContain('develop');
  });

  test('sanitizes branch argument', async () => {
    mockResolve('"abc|A|a@b.com|2026-03-01|msg"');
    await gitLogHandler({ repo_path: SAFE_REPO, branch: 'main; rm -rf /' }, {} as any);
    // Semicolons are stripped before the value ever reaches an argv slot
    expect(nthArgs(0).some((a) => a.includes(';'))).toBe(false);
  });

  test('rejects path outside home', async () => {
    const res = await gitLogHandler({ repo_path: 'C:\\Windows' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('handles exec failure gracefully', async () => {
    mockReject('fatal: not a git repository');
    const res = await gitLogHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('git_log failed');
  });

  test('handles pipe character in commit message', async () => {
    mockResolve('"abc|A|a@b.com|2026-03-01|fix: use X | Y fallback"');
    const res = await gitLogHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.commits[0].message).toContain('|');
  });
});

// ── git_diff ──

describe('gitDiffHandler', () => {
  test('returns staged diff', async () => {
    mockResolve('diff --git a/foo.ts b/foo.ts\n+added line');
    const res = await gitDiffHandler({ repo_path: SAFE_REPO, target: 'staged' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.diff).toContain('added line');
    expect(nthArgs(0)).toEqual(['diff', '--cached']);
  });

  test('defaults to unstaged diff', async () => {
    mockResolve('-removed line\n+added line');
    await gitDiffHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(nthArgs(0)).toEqual(['diff']);
  });

  test('accepts custom ref target', async () => {
    mockResolve('diff output here');
    await gitDiffHandler({ repo_path: SAFE_REPO, target: 'HEAD~1' }, {} as any);
    expect(nthArgs(0)).toEqual(['diff', 'HEAD~1']);
  });

  test('sanitizes target argument', async () => {
    mockResolve('diff output');
    await gitDiffHandler({ repo_path: SAFE_REPO, target: 'HEAD; rm -rf /' }, {} as any);
    expect(nthArgs(0).some((a) => a.includes(';'))).toBe(false);
  });

  test('truncation flag set when diff > 8KB', async () => {
    mockResolve('x'.repeat(9000));
    const res = await gitDiffHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.result.truncated).toBe(true);
    expect(res.result.diff.length).toBe(8192);
    expect(res.result.total_chars).toBe(9000);
  });

  test('no truncation for small diff', async () => {
    mockResolve('small diff');
    const res = await gitDiffHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.result.truncated).toBe(false);
  });

  test('rejects path outside home', async () => {
    const res = await gitDiffHandler({ repo_path: '/usr/bin' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('handles exec failure gracefully', async () => {
    mockReject('fatal: not a git repository');
    const res = await gitDiffHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('git_diff failed');
  });
});

// ── git_branches ──

describe('gitBranchesHandler', () => {
  test('parses branch list', async () => {
    mockResolveSequence(['"main|abc123|"\n"feature|def456|origin/feature"', 'main\n']);

    const res = await gitBranchesHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.current).toBe('main');
    const names = res.result.branches.map((b: any) => b.name);
    expect(names).toContain('main');
    expect(names).toContain('feature');
  });

  test('marks current branch correctly', async () => {
    mockResolveSequence(['"main|abc|"\n"develop|def|"', 'develop']);

    const res = await gitBranchesHandler({ repo_path: SAFE_REPO }, {} as any);
    const develop = res.result.branches.find((b: any) => b.name === 'develop');
    const main = res.result.branches.find((b: any) => b.name === 'main');
    expect(develop.current).toBe(true);
    expect(main.current).toBe(false);
  });

  test('upstream is null when not set', async () => {
    mockResolveSequence(['"main|abc|"', 'main\n']);

    const res = await gitBranchesHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.result.branches[0].upstream).toBeNull();
  });

  test('passes -a flag when include_remote is true', async () => {
    mockResolve('"main|abc|"');

    await gitBranchesHandler({ repo_path: SAFE_REPO, include_remote: true }, {} as any);
    expect(nthArgs(0)).toContain('-a');
  });

  test('rejects path outside home', async () => {
    const res = await gitBranchesHandler({ repo_path: '/usr/bin' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('handles exec failure gracefully', async () => {
    mockReject('fatal: not a git repository');
    const res = await gitBranchesHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('git_branches failed');
  });
});

// ── git_commit ──

describe('gitCommitHandler', () => {
  test('requires commit message', async () => {
    const res = await gitCommitHandler({ repo_path: SAFE_REPO, message: '' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('message');
  });

  test('stages and commits', async () => {
    mockResolve('[main abc123] My commit');
    const res = await gitCommitHandler({ repo_path: SAFE_REPO, message: 'My commit' }, {} as any);
    expect(res.success).toBe(true);
  });

  test('runs git add -A by default', async () => {
    mockResolve('[main abc123] commit');
    await gitCommitHandler({ repo_path: SAFE_REPO, message: 'test' }, {} as any);
    expect(nthArgs(0)).toEqual(['add', '-A']);
    expect(nthArgs(1)[0]).toBe('commit');
  });

  test('skips staging when stage_all is false', async () => {
    mockResolve('[main abc123] commit');
    await gitCommitHandler({ repo_path: SAFE_REPO, message: 'test', stage_all: false }, {} as any);
    // Only one call (commit), no add
    expect(mockExecFileImpl.mock.calls).toHaveLength(1);
    expect(nthArgs(0)).toEqual(['commit', '-m', 'test']);
  });

  test('passes the commit message verbatim as one argv element', async () => {
    // With execFile there is no shell to escape for — quotes, backticks and
    // dollar signs are inert data, so they must arrive untouched. The old
    // charset whitelist existed only to survive the string-command form.
    mockResolve('[main abc123] safe message');
    const message = 'fix: handle "quotes" & `backticks` and $vars';
    await gitCommitHandler({ repo_path: SAFE_REPO, message }, {} as any);
    const commitCall = mockExecFileImpl.mock.calls.find((c: any[]) => c[1][0] === 'commit');
    expect(commitCall[1]).toEqual(['commit', '-m', message]);
  });

  test('truncates long messages to 500 chars', async () => {
    mockResolve('[main abc123] truncated');
    const longMsg = 'a'.repeat(600);
    await gitCommitHandler({ repo_path: SAFE_REPO, message: longMsg }, {} as any);
    const commitCall = mockExecFileImpl.mock.calls.find((c: any[]) => c[1][0] === 'commit');
    expect(commitCall[1][2].length).toBe(500);
  });

  test('rejects path outside home dir', async () => {
    const res = await gitCommitHandler({ repo_path: '/usr/bin', message: 'test' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('handles exec failure gracefully', async () => {
    mockReject('nothing to commit, working tree clean');
    const res = await gitCommitHandler({ repo_path: SAFE_REPO, message: 'test' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('git_commit failed');
  });
});
