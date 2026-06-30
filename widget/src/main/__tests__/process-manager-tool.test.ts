/**
 * Process Manager Tool Tests
 */

// Mock child_process
const mockExecImpl = jest.fn();
jest.mock('child_process', () => ({ exec: mockExecImpl }));

// Helper to make exec mock resolve with JSON data
function mockExecResolve(data: any) {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, { stdout: json, stderr: '' });
    return { on: jest.fn() };
  });
}

function mockExecReject(message: string) {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(new Error(message), { stdout: '', stderr: message });
    return { on: jest.fn() };
  });
}

import {
  listProcessesHandler,
  getProcessInfoHandler as _getProcessInfoHandler,
  killProcessHandler,
  listProcessesDef,
  killProcessDef
} from '../tools/process-manager';

beforeEach(() => jest.clearAllMocks());

describe('listProcessesHandler', () => {
  test('returns processes from exec output', async () => {
    const procs = [
      { Name: 'chrome', Id: 1234, CPU: 12.5, WorkingSet: 104857600, Responding: true },
      { Name: 'notepad', Id: 5678, CPU: 0.1, WorkingSet: 10485760, Responding: true }
    ];
    mockExecResolve(procs);

    const res = await listProcessesHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(2);
    expect(res.result.processes[0].name).toBe('chrome');
  });

  test('filters by name', async () => {
    const procs = [
      { Name: 'chrome', Id: 1, CPU: 5, WorkingSet: 1000, Responding: true },
      { Name: 'notepad', Id: 2, CPU: 0, WorkingSet: 500, Responding: true }
    ];
    mockExecResolve(procs);

    const res = await listProcessesHandler({ filter: 'note' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.processes.every((p: any) => p.name.includes('note'))).toBe(true);
  });

  test('returns error when exec fails', async () => {
    mockExecReject('access denied');
    const res = await listProcessesHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('list_processes failed');
  });
});

describe('killProcessHandler', () => {
  test('requires name or pid', async () => {
    const res = await killProcessHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('required');
  });

  test('blocks protected processes', async () => {
    const res = await killProcessHandler({ name: 'lsass' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('protected');
  });

  test('blocks electron itself', async () => {
    const res = await killProcessHandler({ name: 'electron' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('protected');
  });

  test('kills non-protected process by name', async () => {
    mockExecResolve('');
    const res = await killProcessHandler({ name: 'notepad' }, {} as any);
    expect(res.success).toBe(true);
  });

  test('kills by PID', async () => {
    mockExecResolve('');
    const res = await killProcessHandler({ pid: 9999 }, {} as any);
    expect(res.success).toBe(true);
  });
});

describe('listProcessesDef and killProcessDef shapes', () => {
  test('list_processes has no required params', () => {
    expect(listProcessesDef.parameters.required).toHaveLength(0);
  });

  test('kill_process requiresConfirmation', () => {
    expect(killProcessDef.requiresConfirmation).toBe(true);
  });
});

// ─── listProcessesHandler extra branches ────────────────────────────────────

describe('listProcessesHandler – sorting and edge cases', () => {
  test('sorts by memory when sort_by=memory', async () => {
    const procs = [
      { Name: 'low',  Id: 1, CPU: 50, WorkingSet: 10485760,  Responding: true },
      { Name: 'high', Id: 2, CPU: 10, WorkingSet: 104857600, Responding: true },
    ];
    mockExecResolve(procs);

    const res = await listProcessesHandler({ sort_by: 'memory' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.processes[0].name).toBe('high'); // 100 MB first
  });

  test('sorts by name when sort_by=name', async () => {
    const procs = [
      { Name: 'zebra',  Id: 1, CPU: 1, WorkingSet: 1000, Responding: true },
      { Name: 'alpha',  Id: 2, CPU: 2, WorkingSet: 2000, Responding: true },
      { Name: 'middle', Id: 3, CPU: 0, WorkingSet: 500,  Responding: true },
    ];
    mockExecResolve(procs);

    const res = await listProcessesHandler({ sort_by: 'name' }, {} as any);
    expect(res.success).toBe(true);
    const names = res.result.processes.map((p: any) => p.name);
    expect(names).toEqual([...names].sort());
  });

  test('handles single process (non-array JSON)', async () => {
    const single = { Name: 'solo', Id: 42, CPU: 5, WorkingSet: 5242880, Responding: true };
    mockExecResolve(single); // single object, not array

    const res = await listProcessesHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(1);
    expect(res.result.processes[0].name).toBe('solo');
  });

  test('respects limit parameter', async () => {
    const procs = Array.from({ length: 30 }, (_, i) => ({
      Name: `proc${i}`, Id: i, CPU: i, WorkingSet: 1024 * 1024, Responding: true,
    }));
    mockExecResolve(procs);

    const res = await listProcessesHandler({ limit: 5 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.processes.length).toBe(5);
  });

  test('marks responding=false when Responding is false', async () => {
    const procs = [{ Name: 'frozen', Id: 99, CPU: 0, WorkingSet: 1000, Responding: false }];
    mockExecResolve(procs);

    const res = await listProcessesHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.processes[0].responding).toBe(false);
  });
});

// ─── getProcessInfoHandler ──────────────────────────────────────────────────

describe('getProcessInfoHandler', () => {
  test('returns error when neither name nor pid is provided', async () => {
    const res = await _getProcessInfoHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/required/i);
  });

  test('looks up process by name successfully', async () => {
    const proc = { Name: 'notepad', Id: 123, CPU: 1.5, WorkingSet: 20971520, PriorityClass: 8, StartTime: '2026-01-01', Path: 'C:\\Windows\\notepad.exe', Responding: true };
    mockExecResolve(proc);

    const res = await _getProcessInfoHandler({ name: 'notepad' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.name).toBe('notepad');
    expect(res.result.pid).toBe(123);
    expect(res.result.memory_mb).toBeCloseTo(20, 0);
  });

  test('looks up process by pid', async () => {
    const proc = { Name: 'chrome', Id: 5678, CPU: 12, WorkingSet: 52428800, PriorityClass: 8, StartTime: null, Path: null, Responding: true };
    mockExecResolve(proc);

    const res = await _getProcessInfoHandler({ pid: 5678 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.pid).toBe(5678);
  });

  test('handles array result by using first element', async () => {
    const procs = [
      { Name: 'multi', Id: 1, CPU: 0, WorkingSet: 1024, Responding: true },
      { Name: 'multi', Id: 2, CPU: 0, WorkingSet: 1024, Responding: true },
    ];
    mockExecResolve(procs);

    const res = await _getProcessInfoHandler({ name: 'multi' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.pid).toBe(1);
  });

  test('returns error when exec fails', async () => {
    mockExecReject('process not found');

    const res = await _getProcessInfoHandler({ name: 'ghost' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/get_process_info failed/i);
  });
});

// ─── killProcessHandler extra branches ─────────────────────────────────────

describe('killProcessHandler – extra branches', () => {
  test('kills process with force=true', async () => {
    mockExecResolve('');

    const res = await killProcessHandler({ name: 'notepad', force: true }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.force).toBe(true);
  });

  test('returns error when exec fails during kill', async () => {
    mockExecReject('access denied');

    const res = await killProcessHandler({ name: 'notepad' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/kill_process failed/i);
  });

  test('blocks process with .exe suffix (e.g. lsass.exe)', async () => {
    const res = await killProcessHandler({ name: 'lsass.exe' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/protected/i);
  });

  test('blocks node.exe as protected', async () => {
    const res = await killProcessHandler({ name: 'node.exe' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/protected/i);
  });

  test('kills by pid with force=true', async () => {
    mockExecResolve('');

    const res = await killProcessHandler({ pid: 12345, force: true }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.force).toBe(true);
    expect(res.result.terminated.pid).toBe(12345);
  });
});
