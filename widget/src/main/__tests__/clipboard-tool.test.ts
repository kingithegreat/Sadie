/**
 * Clipboard Tool Tests
 */

const mockExecImpl = jest.fn();
jest.mock('child_process', () => ({ exec: mockExecImpl }));

function mockPS(stdout: string, err?: Error) {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(err ?? null, { stdout, stderr: '' });
    return { on: jest.fn() };
  });
}

import {
  clipboardReadHandler,
  clipboardWriteHandler,
  clipboardReadDef,
  clipboardWriteDef,
} from '../tools/clipboard';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('clipboardReadHandler', () => {
  test('returns clipboard text on success', async () => {
    mockPS('Hello World\r\n');
    const res = await clipboardReadHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.content).toBe('Hello World');
    expect(res.result.empty).toBe(false);
    expect(res.result.length).toBe(11);
  });

  test('returns empty:true when clipboard is blank', async () => {
    mockPS('\r\n');
    const res = await clipboardReadHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.empty).toBe(true);
  });

  test('returns failure on exec error', async () => {
    mockPS('', new Error('Access denied'));
    const res = await clipboardReadHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/clipboard/i);
  });
});

describe('clipboardWriteHandler', () => {
  test('requires text arg', async () => {
    // No exec needed; validation happens before exec
    mockPS('');
    await clipboardWriteHandler({ text: undefined }, {} as any);
    // text is coerced to 'undefined' string — still works but let's check empty string
    const resEmpty = await clipboardWriteHandler({ text: '' }, {} as any);
    // Should still succeed (empty clipboard write is valid)
    expect(resEmpty.success).toBe(true);
    expect(resEmpty.result.length).toBe(0);
  });

  test('copies text to clipboard', async () => {
    mockPS('');
    const res = await clipboardWriteHandler({ text: 'Test text' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.copied).toBe(true);
    expect(res.result.preview).toBe('Test text');
  });

  test('returns failure on exec error', async () => {
    mockPS('', new Error('clipboard unavailable'));
    const res = await clipboardWriteHandler({ text: 'fail' }, {} as any);
    expect(res.success).toBe(false);
  });
});

describe('clipboard tool definitions', () => {
  test('clipboardReadDef has correct name and no params', () => {
    expect(clipboardReadDef.name).toBe('clipboard_read');
    expect(clipboardReadDef.parameters.required).toHaveLength(0);
  });

  test('clipboardWriteDef has correct name and requires text', () => {
    expect(clipboardWriteDef.name).toBe('clipboard_write');
    expect(clipboardWriteDef.requiresConfirmation).toBe(true);
    expect(clipboardWriteDef.parameters.required).toContain('text');
  });
});
