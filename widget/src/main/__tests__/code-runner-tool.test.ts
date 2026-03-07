/**
 * Code Runner Tool Tests
 *
 * Tests the safety filter — does not actually exec code.
 */

import { runCodeHandler } from '../tools/code-runner';

// Mock child_process so no real execution occurs
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined)
  }
}));

// Provide a successful exec result via util.promisify shim
const mockExec = jest.requireMock('child_process').exec as jest.Mock;

function setupExecSuccess(stdout: string, stderr = '') {
  mockExec.mockImplementation((_cmd: string, _opts: any, callback?: Function) => {
    const cb = typeof _opts === 'function' ? _opts : callback;
    if (cb) cb(null, { stdout, stderr });
    return { on: jest.fn(), kill: jest.fn() };
  });
}

describe('runCodeHandler — validation', () => {
  test('rejects unknown language', async () => {
    const res = await runCodeHandler({ language: 'ruby', code: 'puts "hi"' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('language must be');
  });

  test('rejects empty code', async () => {
    const res = await runCodeHandler({ language: 'python', code: '   ' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('code is required');
  });
});

describe('runCodeHandler — safety filter', () => {
  const BLOCKED_SNIPPETS = [
    { label: 'Invoke-WebRequest', code: 'Invoke-WebRequest -Uri http://example.com', lang: 'powershell' },
    { label: 'subprocess.run', code: 'import subprocess\nsubprocess.run(["ls"])', lang: 'python' },
    { label: 'os.system', code: 'import os\nos.system("whoami")', lang: 'python' },
    { label: 'requests.get', code: 'import requests\nrequests.get("http://example.com")', lang: 'python' },
    { label: 'Remove-Item -Recurse', code: 'Remove-Item -Path C:\\ -Recurse', lang: 'powershell' },
    { label: 'Invoke-Expression', code: 'Invoke-Expression "notepad"', lang: 'powershell' },
    { label: 'schtasks', code: 'schtasks /create /tn Test', lang: 'powershell' },
    { label: 'os.environ password', code: 'import os\nprint(os.environ["PASSWORD"])', lang: 'python' }
  ];

  test.each(BLOCKED_SNIPPETS)('blocks $label', async ({ code, lang }) => {
    const res = await runCodeHandler({ language: lang, code }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('safety filter');
  });

  test('allows safe python code', async () => {
    // Provide a mock exec response so the handler resolves
    setupExecSuccess('4');
    const safePy = 'x = 2 + 2\nprint(x)';
    const res = await runCodeHandler({ language: 'python', code: safePy }, {} as any);
    // May succeed or fail on exec but should NOT be a safety filter rejection
    if (!res.success) {
      expect(res.error).not.toContain('safety filter');
    } else {
      expect(res.result.stdout).toBe('4');
    }
  });

  test('allows safe powershell code', async () => {
    setupExecSuccess('Hello World');
    const safePs = 'Write-Host "Hello World"';
    const res = await runCodeHandler({ language: 'powershell', code: safePs }, {} as any);
    if (!res.success) {
      expect(res.error).not.toContain('safety filter');
    } else {
      expect(res.result.stdout).toBe('Hello World');
    }
  });
});

describe('code runner — definition shape', () => {
  test('run_code def has correct enum for language', async () => {
    const { codeRunnerToolDefs } = await import('../tools/code-runner');
    const def = codeRunnerToolDefs[0];
    expect(def.parameters.properties.language.enum).toEqual(['python', 'powershell']);
  });
});
// ── execution results ────────────────────────────────────────────────────────

describe('runCodeHandler â€" execution success', () => {
  test('returns stdout / stderr / exit_code 0 on successful python run', async () => {
    setupExecSuccess('hello world\n', '');
    const res = await runCodeHandler({ language: 'python', code: 'print("hello world")' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.language).toBe('python');
    expect(res.result.stdout).toBe('hello world\n');
    expect(res.result.stderr).toBe('');
    expect(res.result.exit_code).toBe(0);
  });

  test('returns stdout on successful powershell run', async () => {
    setupExecSuccess('42\r\n');
    const res = await runCodeHandler({ language: 'powershell', code: 'Write-Output 42' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.language).toBe('powershell');
    expect(res.result.stdout).toBe('42\r\n');
    expect(res.result.exit_code).toBe(0);
  });
});

describe('runCodeHandler â€" execution failure', () => {
  function setupExecError(opts: { killed?: boolean; code?: number; stdout?: string; stderr?: string }) {
    mockExec.mockImplementation((_cmd: string, _opts: any, callback?: Function) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      const err: any = new Error('Command failed');
      err.killed = opts.killed ?? false;
      err.code = opts.code ?? 1;
      err.stdout = opts.stdout ?? '';
      err.stderr = opts.stderr ?? 'SyntaxError';
      if (cb) cb(err, { stdout: err.stdout, stderr: err.stderr });
      return { on: jest.fn(), kill: jest.fn() };
    });
  }

  test('returns failure with stderr when exec exits non-zero', async () => {
    setupExecError({ code: 1, stderr: 'SyntaxError: invalid syntax' });
    const res = await runCodeHandler({ language: 'python', code: 'print(bad syntax' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.result.exit_code).toBe(1);
    expect(res.result.stderr).toContain('SyntaxError');
  });

  test('returns "timed out" error when process is killed', async () => {
    setupExecError({ killed: true });
    const res = await runCodeHandler({ language: 'python', code: 'import time\ntime.sleep(30)' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/timed out/i);
  });

  test('includes stdout from timed-out process in result', async () => {
    setupExecError({ killed: true, stdout: 'partial output' });
    const res = await runCodeHandler({ language: 'python', code: 'import time\ntime.sleep(30)' }, {} as any);
    expect(res.result.stdout).toBe('partial output');
  });
});

// ── handlers map ─────────────────────────────────────────────────────────────

describe('codeRunnerToolHandlers', () => {
  test('run_code key maps to a callable function', async () => {
    const { codeRunnerToolHandlers } = await import('../tools/code-runner');
    expect(typeof codeRunnerToolHandlers['run_code']).toBe('function');
  });
});

// ── definition extras ────────────────────────────────────────────────────────

describe('runCodeDef extras', () => {
  test('requiresConfirmation is true', async () => {
    const { runCodeDef } = await import('../tools/code-runner');
    expect(runCodeDef.requiresConfirmation).toBe(true);
  });

  test('code parameter is required', async () => {
    const { runCodeDef } = await import('../tools/code-runner');
    expect(runCodeDef.parameters.required).toContain('code');
  });

  test('language parameter is required', async () => {
    const { runCodeDef } = await import('../tools/code-runner');
    expect(runCodeDef.parameters.required).toContain('language');
  });
});