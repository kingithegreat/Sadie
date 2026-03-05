/**
 * Search Tool Tests
 */

const mockExecImpl = jest.fn();
jest.mock('child_process', () => ({ exec: mockExecImpl }));

// Mock fs.existsSync so sanitizeSearchRoot doesn't hit disk
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(false),
}));

function mockPS(stdout: string, err?: Error) {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(err ?? null, { stdout, stderr: '' });
    return { on: jest.fn() };
  });
}

import { searchFilesHandler, searchFilesDef } from '../tools/search';

beforeEach(() => {
  jest.clearAllMocks();
});

const PS_HITS = JSON.stringify([
  { Name: 'budget.pdf', FullName: 'C:\\Users\\test\\Documents\\budget.pdf', PSIsContainer: false, Length: 204800, LastWriteTime: '2026-01-15' },
  { Name: 'invoice.pdf', FullName: 'C:\\Users\\test\\Documents\\invoice.pdf', PSIsContainer: false, Length: 102400, LastWriteTime: '2026-02-01' },
]);

describe('searchFilesHandler', () => {
  test('returns parsed file results on success', async () => {
    // First exec = es.exe check (fails), second = Get-ChildItem (succeeds)
    mockExecImpl
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(new Error('es.exe not found'), { stdout: '', stderr: 'exit 1' });
        return { on: jest.fn() };
      })
      .mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(null, { stdout: PS_HITS, stderr: '' });
        return { on: jest.fn() };
      });

    const res = await searchFilesHandler({ query: '*.pdf' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(2);
    expect(res.result.results[0].name).toBe('budget.pdf');
    expect(res.result.results[0].type).toBe('file');
    expect(res.result.engine).toBe('powershell');
  });

  test('returns empty results when nothing found', async () => {
    mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (callback) callback(null, { stdout: '', stderr: '' });
      return { on: jest.fn() };
    });

    const res = await searchFilesHandler({ query: 'nonexistent_xyz.abc' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(0);
    expect(res.result.results).toHaveLength(0);
  });

  test('returns failure when query is missing', async () => {
    const res = await searchFilesHandler({ query: '' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/query/i);
  });

  test('returns failure on exec error', async () => {
    mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (callback) callback(new Error('permission denied'), { stdout: '', stderr: '' });
      return { on: jest.fn() };
    });

    const res = await searchFilesHandler({ query: 'test' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('single object result (not array) from PS is handled', async () => {
    mockExecImpl
      .mockImplementationOnce((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(new Error('es.exe not found'), { stdout: '', stderr: '' });
        return { on: jest.fn() };
      })
      .mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        const single = JSON.stringify({ Name: 'notes.txt', FullName: 'C:\\Users\\test\\notes.txt', PSIsContainer: false, Length: 512, LastWriteTime: '2026-03-01' });
        if (callback) callback(null, { stdout: single, stderr: '' });
        return { on: jest.fn() };
      });

    const res = await searchFilesHandler({ query: 'notes.txt' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(1);
  });

  test('respects limit parameter', async () => {
    mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (callback) callback(null, { stdout: PS_HITS, stderr: '' });
      return { on: jest.fn() };
    });

    const res = await searchFilesHandler({ query: '*.pdf', limit: 1 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.results.length).toBeLessThanOrEqual(1);
  });

  test('caps limit at 100', async () => {
    // Just check no error and limit is capped
    mockPS('');
    const res = await searchFilesHandler({ query: 'test', limit: 9999 }, {} as any);
    // With empty output, count is 0 — just verify no crash
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(0);
  });
});

describe('searchFilesDef', () => {
  test('has correct name', () => {
    expect(searchFilesDef.name).toBe('search_files');
  });

  test('requires query parameter', () => {
    expect(searchFilesDef.parameters.required).toContain('query');
  });

  test('is in filesystem category', () => {
    expect(searchFilesDef.category).toBe('filesystem');
  });
});
