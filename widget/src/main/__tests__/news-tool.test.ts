/**
 * News Feed Tool Tests
 */

// Mock http/https modules
const mockGet = jest.fn();
jest.mock('https', () => ({ get: mockGet }));
jest.mock('http', () => ({ get: mockGet }));

import { getNewsHandler, listNewsFeedsHandler, getNewsDef } from '../tools/news';

function mockHttpResponse(body: string, statusCode = 200) {
  const readable: any = {
    statusCode,
    headers: {},
    on: jest.fn((event: string, handler: Function) => {
      if (event === 'data') handler(Buffer.from(body));
      if (event === 'end') handler();
      return readable;
    })
  };
  mockGet.mockImplementation((_url: string, _opts: any, callback: Function) => {
    callback(readable);
    return { setTimeout: jest.fn(), on: jest.fn() };
  });
}

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0">
<channel>
  <title>Test Feed</title>
  <item>
    <title>AI advances rapidly</title>
    <link>https://example.com/1</link>
    <pubDate>Wed, 04 Mar 2026 00:00:00 GMT</pubDate>
    <description>A story about AI.</description>
  </item>
  <item>
    <title>Tech stocks rally</title>
    <link>https://example.com/2</link>
    <pubDate>Wed, 04 Mar 2026 01:00:00 GMT</pubDate>
    <description>Markets go up.</description>
  </item>
</channel>
</rss>`;

beforeEach(() => jest.clearAllMocks());

describe('getNewsHandler', () => {
  test('parses RSS and returns items', async () => {
    mockHttpResponse(SAMPLE_RSS);
    const res = await getNewsHandler({ source: 'https://example.com/feed.rss' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(2);
    expect(res.result.items[0].title).toBe('AI advances rapidly');
  });

  test('applies limit', async () => {
    mockHttpResponse(SAMPLE_RSS);
    const res = await getNewsHandler({ source: 'https://example.com/feed.rss', limit: 1 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(1);
  });

  test('applies topic_filter', async () => {
    mockHttpResponse(SAMPLE_RSS);
    const res = await getNewsHandler({
      source: 'https://example.com/feed.rss',
      topic_filter: 'ai'
    }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.items.every((i: any) => i.title.toLowerCase().includes('ai'))).toBe(true);
  });

  test('uses built-in bbc source when no source given', async () => {
    // We can't actually fetch BBC but mock responds with sample RSS
    mockHttpResponse(SAMPLE_RSS);
    const res = await getNewsHandler({}, {} as any);
    expect(res.success).toBe(true);
  });

  test('returns error for invalid non-http source', async () => {
    const res = await getNewsHandler({ source: 'invalid_source_key_xyz' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Unknown source');
  });
});

describe('listNewsFeedsHandler', () => {
  test('returns list of feed keys', async () => {
    const res = await listNewsFeedsHandler({}, {} as any);
    expect(res.success).toBe(true);
    const keys = res.result.map((f: any) => f.key);
    expect(keys).toContain('bbc');
    expect(keys).toContain('techcrunch');
    expect(keys).toContain('hacker_news');
  });
});

describe('getNewsDef', () => {
  test('has no required params', () => {
    expect(getNewsDef.parameters.required).toHaveLength(0);
  });

  test('has default source', () => {
    expect(getNewsDef.parameters.properties.source.default).toBe('bbc');
  });
});
