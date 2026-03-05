/**
 * Browser Tool Tests
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
  openInBrowserHandler,
  browserSearchHandler,
  openInBrowserDef,
  browserSearchDef,
} from '../tools/browser';

beforeEach(() => {
  jest.clearAllMocks();
  mockPS('');
});

describe('openInBrowserHandler', () => {
  test('opens a valid https URL', async () => {
    const res = await openInBrowserHandler({ url: 'https://example.com' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.opened).toBe(true);
    expect(res.result.url).toBe('https://example.com');
  });

  test('blocks file:// URLs', async () => {
    const res = await openInBrowserHandler({ url: 'file:///C:/Windows/system32' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/blocked/i);
  });

  test('blocks localhost', async () => {
    const res = await openInBrowserHandler({ url: 'http://localhost:5678' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/blocked/i);
  });

  test('blocks private 192.168.x.x', async () => {
    const res = await openInBrowserHandler({ url: 'http://192.168.1.1/admin' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/blocked/i);
  });

  test('blocks 127.0.0.1', async () => {
    const res = await openInBrowserHandler({ url: 'http://127.0.0.1' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/blocked/i);
  });

  test('requires url arg', async () => {
    const res = await openInBrowserHandler({ url: '' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/url/i);
  });

  test('returns failure if exec throws', async () => {
    mockPS('', new Error('Start-Process failed'));
    const res = await openInBrowserHandler({ url: 'https://example.com' }, {} as any);
    expect(res.success).toBe(false);
  });
});

describe('browserSearchHandler', () => {
  test('opens a google search', async () => {
    const res = await browserSearchHandler({ query: 'OpenAI news' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.opened).toBe(true);
    expect(res.result.url).toContain('google.com');
    expect(res.result.query).toBe('OpenAI news');
    expect(res.result.engine).toBe('google');
  });

  test('uses bing when specified', async () => {
    const res = await browserSearchHandler({ query: 'test', engine: 'bing' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.url).toContain('bing.com');
  });

  test('uses duckduckgo when specified', async () => {
    const res = await browserSearchHandler({ query: 'privacy', engine: 'duckduckgo' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.url).toContain('duckduckgo.com');
  });

  test('requires query', async () => {
    const res = await browserSearchHandler({ query: '' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/query/i);
  });
});

describe('browser tool definitions', () => {
  test('openInBrowserDef has correct shape', () => {
    expect(openInBrowserDef.name).toBe('open_in_browser');
    expect(openInBrowserDef.parameters.required).toContain('url');
    expect(openInBrowserDef.requiresConfirmation).toBeFalsy();
  });

  test('browserSearchDef has correct shape', () => {
    expect(browserSearchDef.name).toBe('browser_search');
    expect(browserSearchDef.parameters.required).toContain('query');
  });
});
