/**
 * system-tools.test.ts
 * Tests for src/main/tools/system.ts
 */

const mockExecImpl = jest.fn();
jest.mock('child_process', () => ({ exec: mockExecImpl }));

// Helper: simulate promisify-wrapped exec success/failure
function mockExec(stdout: string, err?: Error) {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(err ?? null, { stdout, stderr: '' });
    return { on: jest.fn() };
  });
}

import {
  calculateHandler,
  calculateDef,
  getCurrentTimeHandler,
  getCurrentTimeDef,
  getClipboardHandler,
  getClipboardDef,
  setClipboardHandler,
  setClipboardDef,
  openUrlHandler,
  openUrlDef,
  launchAppHandler,
  launchAppDef,
  getSystemInfoDef,
  getSystemInfoHandler,
  systemToolDefs,
  systemToolHandlers,
} from '../tools/system';

beforeEach(() => {
  jest.clearAllMocks();
});

// ── calculateHandler ────────────────────────────────────────────────────────

describe('calculateHandler', () => {
  test('basic addition', async () => {
    const res = await calculateHandler({ expression: '2 + 3' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBe(5);
    expect(res.result.expression).toBe('2 + 3');
  });

  test('subtraction', async () => {
    const res = await calculateHandler({ expression: '10 - 4' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBe(6);
  });

  test('multiplication', async () => {
    const res = await calculateHandler({ expression: '3 * 7' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBe(21);
  });

  test('division', async () => {
    const res = await calculateHandler({ expression: '10 / 4' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBe(2.5);
  });

  test('exponentiation with ^', async () => {
    const res = await calculateHandler({ expression: '2^10' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBe(1024);
  });

  test('sqrt function', async () => {
    const res = await calculateHandler({ expression: 'sqrt(16)' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBeCloseTo(4);
  });

  test('sin function', async () => {
    const res = await calculateHandler({ expression: 'sin(0)' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBeCloseTo(0);
  });

  test('cos function', async () => {
    const res = await calculateHandler({ expression: 'cos(0)' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBeCloseTo(1);
  });

  test('PI constant', async () => {
    const res = await calculateHandler({ expression: 'PI' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBeCloseTo(Math.PI);
  });

  test('round function', async () => {
    const res = await calculateHandler({ expression: 'round(2.7)' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBe(3);
  });

  test('floor function', async () => {
    const res = await calculateHandler({ expression: 'floor(3.9)' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBe(3);
  });

  test('ceil function', async () => {
    const res = await calculateHandler({ expression: 'ceil(3.1)' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBe(4);
  });

  test('abs function', async () => {
    const res = await calculateHandler({ expression: 'abs(-5)' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.result).toBe(5);
  });

  test('integer result formatted without decimals', async () => {
    const res = await calculateHandler({ expression: '4 * 4' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.formatted).toBe('16');
  });

  test('decimal result formatted with trimmed trailing zeros', async () => {
    const res = await calculateHandler({ expression: '1 / 3' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.formatted).not.toMatch(/0+$/);
  });

  test('returns failure for invalid characters', async () => {
    const res = await calculateHandler({ expression: 'require("fs")' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/calculate/i);
  });

  test('returns failure for division by zero (Infinity)', async () => {
    const res = await calculateHandler({ expression: '1 / 0' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('returns failure when expression is missing', async () => {
    const res = await calculateHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/expression is required/i);
  });

  test('returns failure when expression is not a string', async () => {
    const res = await calculateHandler({ expression: 42 }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/expression is required/i);
  });
});

// ── getCurrentTimeHandler ───────────────────────────────────────────────────

describe('getCurrentTimeHandler', () => {
  test('format=full returns date, time, and timezone', async () => {
    const res = await getCurrentTimeHandler({ format: 'full' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.date).toBeDefined();
    expect(res.result.time).toBeDefined();
    expect(res.result.timezone).toBeDefined();
    expect(res.result.timestamp).toBeGreaterThan(0);
  });

  test('format=date returns date only', async () => {
    const res = await getCurrentTimeHandler({ format: 'date' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.date).toBeDefined();
    expect(res.result.time).toBeUndefined();
    expect(res.result.timezone).toBeUndefined();
  });

  test('format=time returns time only', async () => {
    const res = await getCurrentTimeHandler({ format: 'time' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.time).toBeDefined();
    expect(res.result.date).toBeUndefined();
  });

  test('format=iso returns ISO string', async () => {
    const res = await getCurrentTimeHandler({ format: 'iso' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('no format arg defaults to full', async () => {
    const res = await getCurrentTimeHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.date).toBeDefined();
    expect(res.result.time).toBeDefined();
  });
});

// ── getClipboardHandler ────────────────────────────────────────────────────

describe('getClipboardHandler', () => {
  test('returns clipboard content on success (win32 path)', async () => {
    mockExec('Hello clipboard\r\n');
    const res = await getClipboardHandler({}, {} as any);
    // On non-win32 CI this returns platform unsupported — accept both
    if (process.platform === 'win32') {
      expect(res.success).toBe(true);
      expect(res.result.content).toContain('Hello clipboard');
    } else {
      expect(res.success).toBe(false);
    }
  });

  test('returns failure on exec error (win32)', async () => {
    mockExec('', new Error('Access denied'));
    const res = await getClipboardHandler({}, {} as any);
    if (process.platform === 'win32') {
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/clipboard/i);
    } else {
      expect(res.success).toBe(false);
    }
  });
});

// ── setClipboardHandler ────────────────────────────────────────────────────

describe('setClipboardHandler', () => {
  test('returns failure when text is missing', async () => {
    mockExec('');
    const res = await setClipboardHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/text is required/i);
  });

  test('returns failure when text is not a string', async () => {
    mockExec('');
    const res = await setClipboardHandler({ text: 123 }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/text is required/i);
  });

  test('copies text on win32', async () => {
    mockExec('');
    const res = await setClipboardHandler({ text: 'hello world' }, {} as any);
    if (process.platform === 'win32') {
      expect(res.success).toBe(true);
      expect(res.result.length).toBe(11);
    } else {
      expect(res.success).toBe(false);
    }
  });
});

// ── openUrlHandler ─────────────────────────────────────────────────────────

describe('openUrlHandler', () => {
  test('returns failure when url is missing', async () => {
    const res = await openUrlHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/url is required/i);
  });

  test('returns failure for non-http URL', async () => {
    const res = await openUrlHandler({ url: 'ftp://example.com' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/http/i);
  });

  test('returns failure for javascript: protocol injection', async () => {
    const res = await openUrlHandler({ url: 'javascript:alert(1)' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/http/i);
  });

  test('opens http URL successfully', async () => {
    mockExec('');
    const res = await openUrlHandler({ url: 'https://example.com' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.message).toContain('example.com');
  });

  test('opens http (non-https) URL successfully', async () => {
    mockExec('');
    const res = await openUrlHandler({ url: 'http://example.com' }, {} as any);
    expect(res.success).toBe(true);
  });

  test('returns failure on exec error', async () => {
    mockExec('', new Error('Command not found'));
    const res = await openUrlHandler({ url: 'https://example.com' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/failed to open/i);
  });
});

// ── launchAppHandler ───────────────────────────────────────────────────────

describe('launchAppHandler', () => {
  test('returns failure when appName is missing', async () => {
    const res = await launchAppHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/app name is required/i);
  });

  test('returns failure when appName is empty string', async () => {
    const res = await launchAppHandler({ appName: '' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/app name is required/i);
  });

  test('launches known app on win32', async () => {
    mockExec('');
    const res = await launchAppHandler({ appName: 'notepad' }, {} as any);
    if (process.platform === 'win32') {
      expect(res.success).toBe(true);
      expect(res.result.executable).toBe('notepad');
    } else {
      expect(res.success).toBe(false);
    }
  });

  test('maps calculator alias', async () => {
    mockExec('');
    const res = await launchAppHandler({ appName: 'calculator' }, {} as any);
    if (process.platform === 'win32') {
      expect(res.success).toBe(true);
      expect(res.result.executable).toBe('calc');
    } else {
      expect(res.success).toBe(false);
    }
  });

  test('launches unknown app by name directly', async () => {
    mockExec('');
    const res = await launchAppHandler({ appName: 'myapp' }, {} as any);
    if (process.platform === 'win32') {
      expect(res.success).toBe(true);
      expect(res.result.executable).toBe('myapp');
    } else {
      expect(res.success).toBe(false);
    }
  });
});

// ── Tool definitions ───────────────────────────────────────────────────────

describe('tool definitions', () => {
  test('calculateDef has correct shape', () => {
    expect(calculateDef.name).toBe('calculate');
    expect(calculateDef.category).toBe('system');
    expect(calculateDef.parameters.required).toContain('expression');
  });

  test('getCurrentTimeDef has correct shape', () => {
    expect(getCurrentTimeDef.name).toBe('get_current_time');
    expect(getCurrentTimeDef.category).toBe('system');
  });

  test('getClipboardDef has correct shape', () => {
    expect(getClipboardDef.name).toBe('get_clipboard');
    expect(getClipboardDef.category).toBe('system');
  });

  test('setClipboardDef requires text', () => {
    expect(setClipboardDef.name).toBe('set_clipboard');
    expect(setClipboardDef.parameters.required).toContain('text');
  });

  test('openUrlDef requires url', () => {
    expect(openUrlDef.name).toBe('open_url');
    expect(openUrlDef.parameters.required).toContain('url');
  });

  test('launchAppDef requires appName', () => {
    expect(launchAppDef.name).toBe('launch_app');
    expect(launchAppDef.parameters.required).toContain('appName');
  });

  test('getSystemInfoDef has no required parameters', () => {
    expect(getSystemInfoDef.name).toBe('get_system_info');
    expect(getSystemInfoDef.parameters.required).toEqual([]);
  });
});

// ── getSystemInfoHandler ────────────────────────────────────────────────────

describe('getSystemInfoHandler', () => {
  test('returns success with os, cpu, memory, uptime fields', async () => {
    mockExec('Caption  FreeSpace     Size\r\nC:       5000000000   10000000000\r\n');
    const res = await getSystemInfoHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.os).toBeDefined();
    expect(res.result.cpu).toBeDefined();
    expect(res.result.memory).toBeDefined();
    expect(res.result.uptime).toBeDefined();
  });

  test('basic call does not include user or network fields', async () => {
    mockExec('');
    const res = await getSystemInfoHandler({ detailed: false }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.user).toBeUndefined();
    expect(res.result.network).toBeUndefined();
  });

  test('detailed=true includes user.username and network fields', async () => {
    mockExec('');
    const res = await getSystemInfoHandler({ detailed: true }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.user).toBeDefined();
    expect(res.result.user.username).toBeDefined();
    expect(res.result.network).toBeDefined();
  });

  test('memory fields are formatted byte strings with percent', async () => {
    mockExec('');
    const res = await getSystemInfoHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.memory.total).toMatch(/B$/);
    expect(res.result.memory.usagePercent).toMatch(/%$/);
  });

  test('disks array populated on win32 with valid wmic output', async () => {
    if (process.platform !== 'win32') return; // win32-only branch
    mockExec('Caption  FreeSpace     Size\r\nC:       5000000000   10000000000\r\n');
    const res = await getSystemInfoHandler({}, {} as any);
    expect(res.success).toBe(true);
    if (Array.isArray(res.result.disks)) {
      expect(res.result.disks.length).toBeGreaterThan(0);
      expect(res.result.disks[0].drive).toBe('C:');
    }
  });

  test('succeeds even when wmic exec returns error (graceful fallback)', async () => {
    if (process.platform !== 'win32') return;
    mockExec('', new Error('wmic not found'));
    const res = await getSystemInfoHandler({}, {} as any);
    // disk error is swallowed; overall handler still succeeds
    expect(res.success).toBe(true);
    expect(res.result.os).toBeDefined();
  });
});

// ── systemToolDefs ──────────────────────────────────────────────────────────

describe('systemToolDefs', () => {
  test('contains expected tool names', () => {
    const names = systemToolDefs.map(d => d.name);
    expect(names).toContain('get_system_info');
    expect(names).toContain('calculate');
    expect(names).toContain('get_current_time');
    expect(names).toContain('screenshot');
    expect(names).toContain('get_clipboard');
    expect(names).toContain('set_clipboard');
    expect(names).toContain('open_url');
    expect(names).toContain('launch_app');
  });

  test('every entry has a name, description, and category', () => {
    for (const def of systemToolDefs) {
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(typeof def.category).toBe('string');
    }
  });
});

// ── systemToolHandlers ──────────────────────────────────────────────────────

describe('systemToolHandlers', () => {
  test('has a callable handler for each major tool', () => {
    const expectedKeys = [
      'get_system_info', 'get_clipboard', 'set_clipboard',
      'open_url', 'launch_app', 'calculate', 'get_current_time', 'screenshot',
    ];
    for (const key of expectedKeys) {
      expect(typeof systemToolHandlers[key]).toBe('function');
    }
  });
});
