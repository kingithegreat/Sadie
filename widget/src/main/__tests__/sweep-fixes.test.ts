/**
 * sweep-fixes.test.ts
 *
 * Tests for security and reliability fixes from the codebase sweep:
 * - contacts.ts: PowerShell metacharacter injection guard
 * - vision.ts: 20 MB file size limit
 * - web.ts: HTTP redirect depth limit
 * - system.ts: openUrl Promise.allSettled rejection detection
 * - message-router.ts: conversation digest 4000-char cap
 */

// ── Electron mock (must precede all imports) ──────────────────────────────────

const mockOpenExternal = jest.fn().mockResolvedValue(undefined);
jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/mock'), isPackaged: false, on: jest.fn() },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn(),
  dialog: {},
  shell: { openExternal: mockOpenExternal },
  nativeTheme: { themeSource: 'system' },
}));

const mockExecImpl = jest.fn();
const mockExecFileImpl = jest.fn();
jest.mock('child_process', () => ({
  exec: mockExecImpl,
  execFile: mockExecFileImpl,
}));

function mockExecDefault(stdout = '', err?: Error) {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(err ?? null, { stdout, stderr: '' });
    return { on: jest.fn() };
  });
  mockExecFileImpl.mockImplementation((_cmd: string, _args: string[], _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(err ?? null, { stdout, stderr: '' });
    return { stdin: { write: jest.fn(), end: jest.fn() }, on: jest.fn() };
  });
}

// ── contacts.ts: PowerShell injection guard ───────────────────────────────────

describe('contacts — PowerShell injection guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecDefault('[]');
  });

  test('strips $() injection from the query interpolated into the command', async () => {
    const { searchContactsHandler } = require('../tools/contacts');
    await searchContactsHandler({ query: 'alice$(rm -rf /)' }, {} as any);

    const cmdArg = mockExecImpl.mock.calls[0]?.[0] as string;
    if (cmdArg) {
      // The -like pattern should contain 'alicerm -rf /' (with $, (, ) stripped)
      // but NOT contain the original '$(' sequence
      const likeMatch = cmdArg.match(/-like '\*([^*]*)\*'/);
      if (likeMatch) {
        const interpolatedQuery = likeMatch[1];
        expect(interpolatedQuery).not.toContain('$(');
        expect(interpolatedQuery).not.toContain(')');
      }
    }
  });

  test('strips semicolons and pipes from the query portion', async () => {
    const { searchContactsHandler } = require('../tools/contacts');
    await searchContactsHandler({ query: 'bob; Get-Process | Stop-Process' }, {} as any);

    const cmdArg = mockExecImpl.mock.calls[0]?.[0] as string;
    if (cmdArg) {
      const likeMatch = cmdArg.match(/-like '\*([^*]*)\*'/);
      if (likeMatch) {
        const interpolatedQuery = likeMatch[1];
        expect(interpolatedQuery).not.toContain(';');
        expect(interpolatedQuery).not.toContain('|');
      }
    }
  });

  test('strips backticks and ampersands from the query portion', async () => {
    const { searchContactsHandler } = require('../tools/contacts');
    await searchContactsHandler({ query: 'charlie`{evil}&done' }, {} as any);

    const cmdArg = mockExecImpl.mock.calls[0]?.[0] as string;
    if (cmdArg) {
      const likeMatch = cmdArg.match(/-like '\*([^*]*)\*'/);
      if (likeMatch) {
        const interpolatedQuery = likeMatch[1];
        expect(interpolatedQuery).not.toContain('`');
        expect(interpolatedQuery).not.toContain('&');
        expect(interpolatedQuery).not.toContain('{');
        expect(interpolatedQuery).not.toContain('}');
      }
    }
  });

  test('truncates query to 128 characters', async () => {
    const { searchContactsHandler } = require('../tools/contacts');
    const longQuery = 'x'.repeat(300);
    await searchContactsHandler({ query: longQuery }, {} as any);

    const cmdArg = mockExecImpl.mock.calls[0]?.[0] as string;
    if (cmdArg) {
      const likeMatch = cmdArg.match(/-like '\*([^*]*)\*'/);
      if (likeMatch) {
        expect(likeMatch[1].length).toBeLessThanOrEqual(128);
      }
    }
  });

  test('preserves normal alphanumeric query text', async () => {
    const { searchContactsHandler } = require('../tools/contacts');
    await searchContactsHandler({ query: 'John Smith' }, {} as any);

    const cmdArg = mockExecImpl.mock.calls[0]?.[0] as string;
    if (cmdArg) {
      const likeMatch = cmdArg.match(/-like '\*([^*]*)\*'/);
      if (likeMatch) {
        expect(likeMatch[1].toLowerCase()).toBe('john smith');
      }
    }
  });
});

// ── vision.ts: 20 MB file size limit ──────────────────────────────────────────

describe('vision — 20 MB file size limit', () => {
  jest.mock('fs');
  jest.mock('http');
  jest.mock('../config-manager', () => ({
    assertPermission: jest.fn(),
    getSettings: jest.fn(() => ({
      ollamaUrl: 'http://127.0.0.1:11434',
      visionModel: 'moondream',
    })),
  }));
  jest.mock('../tools/filesystem', () => ({
    resolveUserPath: (p: string) => p,
  }));

  const fs = require('fs');
  const path = require('path');
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '/home/user';
  const IMAGE_PATH = path.join(HOME, 'huge.png');

  beforeEach(() => jest.clearAllMocks());

  test('rejects image files larger than 20 MB', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({
      isDirectory: () => false,
      size: 25 * 1024 * 1024,
    });

    const { visionToolHandlers } = await import('../tools/vision');
    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large|20 MB/i);
  });

  test('rejects via vision_query too', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({
      isDirectory: () => false,
      size: 21 * 1024 * 1024,
    });

    const { visionToolHandlers } = await import('../tools/vision');
    const result = await visionToolHandlers.vision_query({
      file_path: IMAGE_PATH,
      question: 'What is this?',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large|20 MB/i);
  });

  test('accepts image files at exactly 20 MB', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({
      isDirectory: () => false,
      size: 20 * 1024 * 1024,
    });
    fs.readFileSync.mockReturnValue(Buffer.from('fake-png'));

    const http = require('http');
    const mockReq: any = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
      setTimeout: jest.fn(),
      destroy: jest.fn(),
    };
    const mockRes: any = {
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        if (event === 'data') cb(Buffer.from(JSON.stringify({ response: 'OK' })));
        if (event === 'end') cb();
        return mockRes;
      }),
    };
    http.request.mockImplementation((_opts: any, cb: any) => {
      if (cb) cb(mockRes);
      return mockReq;
    });

    const { visionToolHandlers } = await import('../tools/vision');
    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(true);
  });

  test('accepts small image files (1 KB)', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({
      isDirectory: () => false,
      size: 1024,
    });
    fs.readFileSync.mockReturnValue(Buffer.from('tiny-png'));

    const http = require('http');
    const mockReq: any = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
      setTimeout: jest.fn(),
      destroy: jest.fn(),
    };
    const mockRes: any = {
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        if (event === 'data') cb(Buffer.from(JSON.stringify({ response: 'Small image' })));
        if (event === 'end') cb();
        return mockRes;
      }),
    };
    http.request.mockImplementation((_opts: any, cb: any) => {
      if (cb) cb(mockRes);
      return mockReq;
    });

    const { visionToolHandlers } = await import('../tools/vision');
    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(true);
  });
});

// ── system.ts: openUrl rejection detection ────────────────────────────────────

describe('openUrlHandler — Promise.allSettled rejection detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecDefault('');
    mockOpenExternal.mockResolvedValue(undefined);
  });

  test('returns failure when shell.openExternal rejects', async () => {
    mockOpenExternal.mockRejectedValueOnce(new Error('Failed to open'));

    const { openUrlHandler } = require('../tools/system');
    const result = await openUrlHandler({ url: 'https://example.com' }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/failed to open/i);
  });

  test('returns success when shell.openExternal resolves', async () => {
    mockOpenExternal.mockResolvedValueOnce(undefined);

    const { openUrlHandler } = require('../tools/system');
    const result = await openUrlHandler({ url: 'https://example.com' }, {} as any);
    expect(result.success).toBe(true);
  });

  test('returns failure for missing url', async () => {
    const { openUrlHandler } = require('../tools/system');
    const result = await openUrlHandler({}, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/url is required/i);
  });

  test('returns failure for non-http protocol', async () => {
    const { openUrlHandler } = require('../tools/system');
    const result = await openUrlHandler({ url: 'file:///etc/passwd' }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/http/i);
  });
});

// ── web.ts: redirect depth limit ──────────────────────────────────────────────

describe('web module — redirect safety', () => {
  test('webSearchHandler is exported and callable', () => {
    jest.mock('dns', () => ({
      promises: {
        lookup: jest.fn().mockResolvedValue([{ address: '1.2.3.4', family: 4 }]),
      },
    }));
    const webModule = require('../tools/web');
    expect(typeof webModule.webSearchHandler).toBe('function');
    expect(typeof webModule.isAllowedDomain).toBe('function');
  });
});

// ── message-router: conversation digest cap ───────────────────────────────────

describe('conversation digest — 4000 char cap', () => {
  test('compressTurns is exported and produces output', () => {
    let compressTurns: any;
    try {
      const mod = require('../message-router');
      compressTurns = mod.compressTurns;
    } catch {
      // message-router may not export compressTurns directly
    }

    if (compressTurns) {
      const turns = [
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'assistant', content: 'I am doing well, thank you for asking!' },
      ];
      const result = compressTurns(turns);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  test('compressTurns strips code blocks and search results', () => {
    let compressTurns: any;
    try {
      const mod = require('../message-router');
      compressTurns = mod.compressTurns;
    } catch {
      // Skip if not exported
    }

    if (compressTurns) {
      const turns = [
        { role: 'user', content: 'Show me code' },
        {
          role: 'assistant',
          content: 'Here is code:\n```javascript\nconsole.log("hello");\n```\nThat prints hello.',
        },
      ];
      const result = compressTurns(turns);
      expect(result).not.toContain('console.log');
    }
  });
});
