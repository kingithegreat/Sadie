/**
 * Git Tool Tests
 */

import * as os from 'os';
import * as path from 'path';

// Mock child_process
const mockExecImpl = jest.fn();
jest.mock('child_process', () => ({ exec: mockExecImpl }));

function mockExecResolve(stdout: string) {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, { stdout, stderr: '' });
    return { on: jest.fn() };
  });
}

function mockExecReject(message: string) {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(new Error(message), null);
    return { on: jest.fn() };
  });
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
const SAFE_REPO = path.join(HOME, 'Desktop', 'sadie');

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
    mockExecImpl
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: 'M  src/foo.ts\n?? newfile.ts\n', stderr: '' });
        return { on: jest.fn() };
      })
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: 'main\n', stderr: '' });
        return { on: jest.fn() };
      });

    const res = await gitStatusHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.branch).toBe('main');
    expect(res.result.untracked).toContain('newfile.ts');
  });

  test('rejects repo outside home dir', async () => {
    const res = await gitStatusHandler({ repo_path: 'C:\\Windows\\System32' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('reports clean when no modifications', async () => {
    mockExecImpl
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: '', stderr: '' });
        return { on: jest.fn() };
      })
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: 'main\n', stderr: '' });
        return { on: jest.fn() };
      });

    const res = await gitStatusHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.clean).toBe(true);
  });

  test('detects staged files', async () => {
    mockExecImpl
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: 'A  newfile.ts\nM  edited.ts\n', stderr: '' });
        return { on: jest.fn() };
      })
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: 'develop\n', stderr: '' });
        return { on: jest.fn() };
      });

    const res = await gitStatusHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.staged.length).toBe(2);
    expect(res.result.staged[0]).toContain('newfile.ts');
  });

  test('handles exec failure gracefully', async () => {
    mockExecReject('Not a git repository');
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
    mockExecResolve(logOutput);

    const res = await gitLogHandler({ repo_path: SAFE_REPO, limit: 5 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.commits.length).toBe(2);
    expect(res.result.commits[0].hash).toBe('abc123');
    expect(res.result.commits[0].author).toBe('Alice');
    expect(res.result.commits[0].email).toBe('alice@x.com');
    expect(res.result.commits[0].date).toBe('2026-03-01');
  });

  test('respects limit', async () => {
    mockExecResolve('"abc|A|a@b.com|2026-03-01|msg"');
    const res = await gitLogHandler({ repo_path: SAFE_REPO, limit: 1 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.commits.length).toBeLessThanOrEqual(1);
  });

  test('clamps limit to 50 max', async () => {
    mockExecResolve('"abc|A|a@b.com|2026-03-01|msg"');
    await gitLogHandler({ repo_path: SAFE_REPO, limit: 999 }, {} as any);
    const cmd = mockExecImpl.mock.calls[0][0];
    expect(cmd).toContain('-n 50');
  });

  test('accepts branch argument', async () => {
    mockExecResolve('"abc|A|a@b.com|2026-03-01|msg"');
    await gitLogHandler({ repo_path: SAFE_REPO, branch: 'develop' }, {} as any);
    const cmd = mockExecImpl.mock.calls[0][0];
    expect(cmd).toContain('develop');
  });

  test('sanitizes branch argument', async () => {
    mockExecResolve('"abc|A|a@b.com|2026-03-01|msg"');
    await gitLogHandler({ repo_path: SAFE_REPO, branch: 'main; rm -rf /' }, {} as any);
    const cmd = mockExecImpl.mock.calls[0][0];
    // Semicolons and spaces should be stripped
    expect(cmd).not.toContain(';');
  });

  test('rejects path outside home', async () => {
    const res = await gitLogHandler({ repo_path: 'C:\\Windows' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('handles exec failure gracefully', async () => {
    mockExecReject('fatal: not a git repository');
    const res = await gitLogHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('git_log failed');
  });

  test('handles pipe character in commit message', async () => {
    mockExecResolve('"abc|A|a@b.com|2026-03-01|fix: use X | Y fallback"');
    const res = await gitLogHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.commits[0].message).toContain('|');
  });
});

// ── git_diff ──

describe('gitDiffHandler', () => {
  test('returns staged diff', async () => {
    mockExecResolve('diff --git a/foo.ts b/foo.ts\n+added line');
    const res = await gitDiffHandler({ repo_path: SAFE_REPO, target: 'staged' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.diff).toContain('added line');
  });

  test('defaults to unstaged diff', async () => {
    mockExecResolve('-removed line\n+added line');
    await gitDiffHandler({ repo_path: SAFE_REPO }, {} as any);
    const cmd = mockExecImpl.mock.calls[0][0];
    expect(cmd).toContain('git diff');
    expect(cmd).not.toContain('--cached');
  });

  test('accepts custom ref target', async () => {
    mockExecResolve('diff output here');
    await gitDiffHandler({ repo_path: SAFE_REPO, target: 'HEAD~1' }, {} as any);
    const cmd = mockExecImpl.mock.calls[0][0];
    expect(cmd).toContain('HEAD~1');
  });

  test('sanitizes target argument', async () => {
    mockExecResolve('diff output');
    await gitDiffHandler({ repo_path: SAFE_REPO, target: 'HEAD; rm -rf /' }, {} as any);
    const cmd = mockExecImpl.mock.calls[0][0];
    expect(cmd).not.toContain(';');
  });

  test('truncation flag set when diff > 8KB', async () => {
    mockExecResolve('x'.repeat(9000));
    const res = await gitDiffHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.result.truncated).toBe(true);
    expect(res.result.diff.length).toBe(8192);
    expect(res.result.total_chars).toBe(9000);
  });

  test('no truncation for small diff', async () => {
    mockExecResolve('small diff');
    const res = await gitDiffHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.result.truncated).toBe(false);
  });

  test('rejects path outside home', async () => {
    const res = await gitDiffHandler({ repo_path: '/usr/bin' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('handles exec failure gracefully', async () => {
    mockExecReject('fatal: not a git repository');
    const res = await gitDiffHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('git_diff failed');
  });
});

// ── git_branches ──

describe('gitBranchesHandler', () => {
  test('parses branch list', async () => {
    mockExecImpl
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: '"main|abc123|"\n"feature|def456|origin/feature"', stderr: '' });
        return { on: jest.fn() };
      })
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: 'main', stderr: '' });
        return { on: jest.fn() };
      });

    const res = await gitBranchesHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.current).toBe('main');
    const names = res.result.branches.map((b: any) => b.name);
    expect(names).toContain('main');
    expect(names).toContain('feature');
  });

  test('marks current branch correctly', async () => {
    mockExecImpl
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: '"main|abc|"\n"develop|def|"', stderr: '' });
        return { on: jest.fn() };
      })
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: 'develop', stderr: '' });
        return { on: jest.fn() };
      });

    const res = await gitBranchesHandler({ repo_path: SAFE_REPO }, {} as any);
    const develop = res.result.branches.find((b: any) => b.name === 'develop');
    const main = res.result.branches.find((b: any) => b.name === 'main');
    expect(develop.current).toBe(true);
    expect(main.current).toBe(false);
  });

  test('upstream is null when not set', async () => {
    mockExecImpl
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: '"main|abc|"', stderr: '' });
        return { on: jest.fn() };
      })
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: 'main', stderr: '' });
        return { on: jest.fn() };
      });

    const res = await gitBranchesHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.result.branches[0].upstream).toBeNull();
  });

  test('passes -a flag when include_remote is true', async () => {
    mockExecImpl
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: '"main|abc|"', stderr: '' });
        return { on: jest.fn() };
      })
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: 'main', stderr: '' });
        return { on: jest.fn() };
      });

    await gitBranchesHandler({ repo_path: SAFE_REPO, include_remote: true }, {} as any);
    const cmd = mockExecImpl.mock.calls[0][0];
    expect(cmd).toContain('-a');
  });

  test('rejects path outside home', async () => {
    const res = await gitBranchesHandler({ repo_path: '/usr/bin' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('handles exec failure gracefully', async () => {
    mockExecReject('fatal: not a git repository');
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
    mockExecResolve('[main abc123] My commit');
    const res = await gitCommitHandler({ repo_path: SAFE_REPO, message: 'My commit' }, {} as any);
    expect(res.success).toBe(true);
  });

  test('runs git add -A by default', async () => {
    mockExecResolve('[main abc123] commit');
    await gitCommitHandler({ repo_path: SAFE_REPO, message: 'test' }, {} as any);
    const firstCmd = mockExecImpl.mock.calls[0][0];
    expect(firstCmd).toContain('add -A');
  });

  test('skips staging when stage_all is false', async () => {
    mockExecResolve('[main abc123] commit');
    await gitCommitHandler({ repo_path: SAFE_REPO, message: 'test', stage_all: false }, {} as any);
    // Only one call (commit), no add -A
    const cmds = mockExecImpl.mock.calls.map((c: any[]) => c[0]);
    expect(cmds.every((c: string) => !c.includes('add -A'))).toBe(true);
  });

  test('sanitizes commit message (strips dangerous chars)', async () => {
    mockExecResolve('[main abc123] safe message');
    await gitCommitHandler({ repo_path: SAFE_REPO, message: 'fix: "quotes" & `backticks` $var' }, {} as any);
    const commitCmd = mockExecImpl.mock.calls.find((c: any[]) => c[0].includes('commit'));
    // Backticks, dollar signs should be stripped
    expect(commitCmd[0]).not.toContain('`');
    expect(commitCmd[0]).not.toContain('$');
  });

  test('truncates long messages to 200 chars', async () => {
    mockExecResolve('[main abc123] truncated');
    const longMsg = 'a'.repeat(300);
    await gitCommitHandler({ repo_path: SAFE_REPO, message: longMsg }, {} as any);
    const commitCmd = mockExecImpl.mock.calls.find((c: any[]) => c[0].includes('commit'));
    // The message in the git command should be capped
    const msgMatch = commitCmd[0].match(/commit -m "(.*)"/);
    expect(msgMatch[1].length).toBeLessThanOrEqual(200);
  });

  test('rejects path outside home dir', async () => {
    const res = await gitCommitHandler({ repo_path: '/usr/bin', message: 'test' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('handles exec failure gracefully', async () => {
    mockExecReject('nothing to commit, working tree clean');
    const res = await gitCommitHandler({ repo_path: SAFE_REPO, message: 'test' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('git_commit failed');
  });
});
