/**
 * web-fallback.test.ts
 *
 * Tests for three things shipped in recent commits:
 *
 * 1. isAllowedDomain — wikipedia.org must be allowed (not blocked).
 *    Search-engine meta-domains (duckduckgo.com, google.com/search …) stay blocked.
 *
 * 2. DDG Instant Answer API fallback — webSearchHandler fires searchDDGInstant()
 *    when neither Tavily nor Serper keys are configured, populates results/sources.
 *
 * 3. API key priority — Tavily is used first when a key is present; DDG Instant
 *    is only the fallback.
 */

// Mock electron before any imports that touch it
jest.mock('electron', () => ({
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn(),
  app: { getPath: jest.fn(() => '/mock'), isPackaged: false },
  dialog: {},
  shell: {},
  nativeTheme: { themeSource: 'system' },
}));

// Mock native node modules — native properties are non-configurable so
// jest.spyOn cannot redeclare them; use jest.mock to replace the whole module.
const mockGet = jest.fn();
const mockRequest = jest.fn();
jest.mock('https', () => ({ get: mockGet, request: mockRequest }));
jest.mock('http', () => ({ get: jest.fn() }));
// dns.promises.lookup — isUrlSafe calls this; make it resolve safely for any host
jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn().mockResolvedValue([{ address: '1.2.3.4', family: 4 }]),
  },
}));

import { isAllowedDomain, webSearchHandler, setTavilyApiKey, setSerperApiKey } from '../tools/web';

// ──────────────────────────────────────────────────────────────────────────────
// Helper: configure mockGet to deliver `responseBody` to the first callback arg
// ──────────────────────────────────────────────────────────────────────────────
function setupHttpsGetResponse(responseBody: string): void {
  const mockRes = {
    statusCode: 200,
    headers: {},
    setEncoding: jest.fn(),
    on(event: string, handler: (...args: any[]) => void) {
      if (event === 'data') handler(responseBody);
      if (event === 'end') handler();
      return this;
    },
  };
  const mockReq = {
    on: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    destroy: jest.fn(),
  };
  mockGet.mockImplementation((_url: any, _opts: any, callback: any) => {
    callback(mockRes);
    return mockReq;
  });
}

function setupHttpsRequestResponse(responseBody: string): void {
  const mockRes = {
    statusCode: 200,
    headers: {},
    setEncoding: jest.fn(),
    on(event: string, handler: (...args: any[]) => void) {
      if (event === 'data') handler(responseBody);
      if (event === 'end') handler();
      return this;
    },
  };
  const mockReqObj = {
    on: jest.fn().mockReturnThis(),
    write: jest.fn(),
    end: jest.fn(),
    setTimeout: jest.fn().mockReturnThis(),
    destroy: jest.fn(),
  };
  mockRequest.mockImplementation((_url: any, _opts: any, callback: any) => {
    callback(mockRes);
    return mockReqObj;
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. isAllowedDomain
// ──────────────────────────────────────────────────────────────────────────────
describe('isAllowedDomain', () => {
  test('wikipedia.org is allowed (was incorrectly blocked before fix)', () => {
    expect(isAllowedDomain('https://en.wikipedia.org/wiki/Iran')).toBe(true);
    expect(isAllowedDomain('https://wikipedia.org/wiki/War')).toBe(true);
  });

  test('duckduckgo.com search pages are blocked (meta links, not content)', () => {
    expect(isAllowedDomain('https://duckduckgo.com/?q=test')).toBe(false);
  });

  test('google.com/search is blocked', () => {
    expect(isAllowedDomain('https://www.google.com/search?q=test')).toBe(false);
  });

  test('bing.com/search is blocked', () => {
    expect(isAllowedDomain('https://www.bing.com/search?q=test')).toBe(false);
  });

  test('brave search is blocked', () => {
    expect(isAllowedDomain('https://search.brave.com/search?q=test')).toBe(false);
  });

  test('regular content URLs are allowed', () => {
    expect(isAllowedDomain('https://www.reuters.com/article/iran')).toBe(true);
    expect(isAllowedDomain('https://bbc.com/news')).toBe(true);
    expect(isAllowedDomain('https://cnn.com/story')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. DDG Instant fallback
// ──────────────────────────────────────────────────────────────────────────────
describe('webSearchHandler — DDG Instant fallback', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRequest.mockReset();
    // Clear API keys so Tavily/Serper paths are skipped
    setTavilyApiKey(null);
    setSerperApiKey(null);
  });

  test('uses DDG Instant when no API keys configured and returns results', async () => {
    const ddgResponse = JSON.stringify({
      Heading: 'US-Iran War 2026',
      AbstractText: 'The United States launched strikes against Iran on February 25, 2026.',
      AbstractURL: 'https://en.wikipedia.org/wiki/US-Iran_War_2026',
      AbstractSource: 'Wikipedia',
      Answer: '',
      RelatedTopics: [
        {
          FirstURL: 'https://en.wikipedia.org/wiki/Iran',
          Text: 'Iran - Islamic Republic in Southwest Asia involved in the 2026 conflict.',
        },
      ],
      Results: [],
    });

    setupHttpsGetResponse(ddgResponse);

    const result = await webSearchHandler({
      query: 'us iran war 2026 test-ddg-fallback',
      maxResults: 5,
      fetchTopResult: false, // avoid second round of fetches
    }, {} as any);

    expect(result.success).toBe(true);
    const r = (result as any).result;
    expect(r.results.length).toBeGreaterThan(0);
    // The abstract should be the first/primary result
    expect(r.results[0].title).toContain('US-Iran War 2026');
    // Sources should include the Wikipedia abstract
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.sources[0].url).toBe('https://en.wikipedia.org/wiki/US-Iran_War_2026');
  });

  test('returns DDG Instant answer text when available', async () => {
    const ddgResponse = JSON.stringify({
      Heading: 'Speed of light',
      AbstractText: '',
      AbstractURL: '',
      AbstractSource: '',
      Answer: '299,792,458 metres per second',
      RelatedTopics: [],
      Results: [],
    });

    setupHttpsGetResponse(ddgResponse);

    const result = await webSearchHandler({
      query: 'speed of light test-ddg-answer',
      maxResults: 3,
      fetchTopResult: false,
    }, {} as any);

    expect(result.success).toBe(true);
    const r = (result as any).result;
    // answer field should be populated (stored as aiAnswer in the result payload)
    expect(r.aiAnswer).toContain('299,792,458');
  });

  test('handles DDG Instant returning no results gracefully', async () => {
    // DDG returns empty — falls through to HTML scrapers which also get empty HTML
    const emptyDDG = JSON.stringify({
      Heading: '',
      AbstractText: '',
      AbstractURL: '',
      Answer: '',
      RelatedTopics: [],
      Results: [],
    });

    setupHttpsGetResponse(emptyDDG);

    const result = await webSearchHandler({
      query: 'xyzzy-nonexistent-query-test-empty',
      maxResults: 3,
      fetchTopResult: false,
    }, {} as any);

    expect(result.success).toBe(true);
    const r = (result as any).result;
    // Should surface the "no results" message or an empty results array
    expect(r.results === undefined || Array.isArray(r.results)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Tavily takes priority when key is set
// ──────────────────────────────────────────────────────────────────────────────
describe('webSearchHandler — Tavily priority', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRequest.mockReset();
    setTavilyApiKey(null);
  });

  afterEach(() => {
    setTavilyApiKey(null);
  });

  test('Tavily search is attempted first when key is configured', async () => {
    setTavilyApiKey('test-key-123');

    const tavilyResponse = JSON.stringify({
      query: 'iran war',
      answer: 'US and Israel struck Iran on Feb 25 2026.',
      results: [
        { title: 'CNN Report', url: 'https://cnn.com/iran', content: 'US launches strikes.', score: 0.9 },
      ],
      response_time: 0.8,
    });

    // Tavily uses https.request (POST), not https.get
    setupHttpsRequestResponse(tavilyResponse);

    const result = await webSearchHandler({
      query: 'iran war tavily-priority-test',
      maxResults: 3,
      fetchTopResult: false,
    }, {} as any);

    expect(result.success).toBe(true);
    const r = (result as any).result;
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].title).toBe('CNN Report');
    // Tavily answer surfaced as aiAnswer in result payload
    expect(r.aiAnswer).toContain('Feb 25 2026');
  });
});
