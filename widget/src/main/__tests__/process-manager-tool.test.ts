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
