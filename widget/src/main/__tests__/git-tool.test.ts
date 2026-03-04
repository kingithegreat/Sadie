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

function mockExecReject(msg: string) {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(new Error(msg), { stdout: '', stderr: msg });
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
  gitCommitDef
} from '../tools/git';

const HOME = os.homedir();
const SAFE_REPO = path.join(HOME, 'Desktop', 'sadie');

beforeEach(() => jest.clearAllMocks());

describe('gitStatusHandler', () => {
  test('parses porcelain output correctly', async () => {
    // First call is `git status`, second is `git rev-parse`
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
});

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
  });

  test('respects limit', async () => {
    mockExecResolve('"abc|A|a@b.com|2026-03-01|msg"');
    const res = await gitLogHandler({ repo_path: SAFE_REPO, limit: 1 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.commits.length).toBeLessThanOrEqual(1);
  });

  test('rejects path outside home', async () => {
    const res = await gitLogHandler({ repo_path: 'C:\\Windows' }, {} as any);
    expect(res.success).toBe(false);
  });
});

describe('gitDiffHandler', () => {
  test('returns staged diff', async () => {
    mockExecResolve('diff --git a/foo.ts b/foo.ts\n+added line');
    const res = await gitDiffHandler({ repo_path: SAFE_REPO, target: 'staged' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.diff).toContain('added line');
  });

  test('truncation flag set when diff > 8KB', async () => {
    mockExecResolve('x'.repeat(9000));
    const res = await gitDiffHandler({ repo_path: SAFE_REPO }, {} as any);
    expect(res.result.truncated).toBe(true);
    expect(res.result.diff.length).toBe(8192);
  });
});

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
  });
});

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
});

describe('git tool definitions', () => {
  test('gitStatusDef has no required params', () => {
    expect(gitStatusDef.parameters.required).toHaveLength(0);
  });

  test('gitCommitDef requiresConfirmation', () => {
    expect(gitCommitDef.requiresConfirmation).toBe(true);
  });
});
