/**
 * Terminal Tool Tests
 */

import * as os from 'os';
import * as path from 'path';

// Mock child_process
const mockExecImpl = jest.fn();
jest.mock('child_process', () => ({
  exec: mockExecImpl,
  execFile: jest.fn()
}));

// Mock fs.statSync for cwd validation in terminal.ts
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    statSync: jest.fn((p: string) => {
      const home = os.homedir();
      if (typeof p === 'string' && p.toLowerCase().startsWith(home.toLowerCase())) {
        return { isDirectory: () => true };
      }
      return actual.statSync(p);
    })
  };
});

import {
  runTerminalCommandHandler,
  runTerminalCommandDef,
  getTerminalHistoryHandler,
  getTerminalHistoryDef
} from '../tools/terminal';

const HOME = os.homedir();
const SAFE_DIR = path.join(HOME, 'Desktop', 'sadie');

// Helper to mock exec success
function mockExecResolve(stdout: string, stderr = '') {
  mockExecImpl.mockImplementation((_cmd: string, opts: any, cb?: Function) => {
    const callback = typeof opts === 'function' ? opts : cb;
    if (callback) callback(null, { stdout, stderr });
    return { on: jest.fn() };
  });
}

// Helper to mock exec failure
function mockExecReject(exitCode: number, stdout = '', stderr = '', killed = false) {
  mockExecImpl.mockImplementation((_cmd: string, opts: any, cb?: Function) => {
    const callback = typeof opts === 'function' ? opts : cb;
    const err: any = new Error('Command failed');
    err.code = exitCode;
    err.stdout = stdout;
    err.stderr = stderr;
    err.killed = killed;
    if (callback) callback(err, null);
    return { on: jest.fn() };
  });
}

beforeEach(() => jest.clearAllMocks());

// ── Tool Definitions ──

describe('runTerminalCommandDef', () => {
  test('has correct name and category', () => {
    expect(runTerminalCommandDef.name).toBe('run_terminal_command');
    expect(runTerminalCommandDef.category).toBe('utility');
    expect(runTerminalCommandDef.requiresConfirmation).toBe(true);
  });

  test('requires command parameter', () => {
    expect(runTerminalCommandDef.parameters.required).toContain('command');
  });
});

describe('getTerminalHistoryDef', () => {
  test('has correct name and no required params', () => {
    expect(getTerminalHistoryDef.name).toBe('get_terminal_history');
    expect(getTerminalHistoryDef.parameters.required).toEqual([]);
  });
});

// ── Command Execution ──

describe('runTerminalCommandHandler', () => {
  test('executes command and returns stdout/stderr', async () => {
    mockExecResolve('test output\n', 'warning\n');
    const result = await runTerminalCommandHandler({ command: 'echo hello', cwd: SAFE_DIR }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result.stdout).toContain('test output');
    expect(result.result.stderr).toContain('warning');
    expect(result.result.exit_code).toBe(0);
  });

  test('rejects empty command', async () => {
    const result = await runTerminalCommandHandler({ command: '' }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  test('rejects command exceeding max length', async () => {
    const result = await runTerminalCommandHandler({ command: 'a'.repeat(2049) }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('too long');
  });

  test('blocks rm -rf / pattern', async () => {
    const result = await runTerminalCommandHandler({ command: 'rm -rf /', cwd: SAFE_DIR }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('safety filter');
  });

  test('blocks format C: pattern', async () => {
    const result = await runTerminalCommandHandler({ command: 'format C: ', cwd: SAFE_DIR }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('safety filter');
  });

  test('blocks shutdown command', async () => {
    const result = await runTerminalCommandHandler({ command: 'shutdown /s', cwd: SAFE_DIR }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('safety filter');
  });

  test('blocks fork bomb', async () => {
    const result = await runTerminalCommandHandler({ command: ':(){ :|:& };:', cwd: SAFE_DIR }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('safety filter');
  });

  test('allows safe commands like npm test', async () => {
    mockExecResolve('All tests passed\n');
    const result = await runTerminalCommandHandler({ command: 'npm test', cwd: SAFE_DIR }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result.command).toBe('npm test');
  });

  test('rejects cwd outside home directory', async () => {
    const result = await runTerminalCommandHandler({ command: 'ls', cwd: '/usr/bin' }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('home directory');
  });

  test('handles command failure with exit code', async () => {
    mockExecReject(1, '', 'Error: test failed\n');
    const result = await runTerminalCommandHandler({ command: 'npm test', cwd: SAFE_DIR }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('exited with code 1');
    expect(result.result.stderr).toContain('Error: test failed');
  });

  test('handles command timeout', async () => {
    mockExecReject(0, 'partial output', '', true);
    const result = await runTerminalCommandHandler({ command: 'sleep 999', cwd: SAFE_DIR, timeout: 5 }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(result.result.timed_out).toBe(true);
  });

  test('truncates long output', async () => {
    const longOutput = 'x'.repeat(20000);
    mockExecResolve(longOutput);
    const result = await runTerminalCommandHandler({ command: 'echo big', cwd: SAFE_DIR }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result.stdout.length).toBeLessThan(longOutput.length);
    expect(result.result.stdout).toContain('truncated');
  });

  test('clamps timeout to 120s max', async () => {
    mockExecResolve('ok');
    await runTerminalCommandHandler({ command: 'echo test', cwd: SAFE_DIR, timeout: 999 }, {} as any);
    const execCall = mockExecImpl.mock.calls[0];
    expect(execCall[1].timeout).toBeLessThanOrEqual(120000);
  });
});

// ── History ──

describe('getTerminalHistoryHandler', () => {
  test('returns empty history for fresh session', async () => {
    const result = await getTerminalHistoryHandler({ limit: 5 }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result.history).toBeDefined();
    expect(Array.isArray(result.result.history)).toBe(true);
  });

  test('clamps limit', async () => {
    const result = await getTerminalHistoryHandler({ limit: 999 }, {} as any);
    expect(result.success).toBe(true);
  });
});
