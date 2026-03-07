/**
 * Tests for nba.ts — nbaQueryHandler branches that require https mocking.
 * fetchEspnJson → httpsGet → https.get  (all intercepted via jest.mock)
 */

import * as https from 'https';
import * as zlib from 'zlib';
import { nbaQueryHandler } from '../tools/nba';

jest.mock('https');
jest.mock('zlib');

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeReq() {
  return { on: jest.fn().mockReturnThis() };
}

function makeRes(data: any, encoding = ''): any {
  const res: any = {
    headers: { 'content-encoding': encoding },
    on: jest.fn((event: string, cb: (...a: any[]) => void) => {
      if (event === 'data') cb(Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)));
      if (event === 'end') cb();
      return res;
    }),
  };
  return res;
}

function mockGet(data: any, encoding = '') {
  (https.get as jest.Mock).mockImplementation((_url: any, _opts: any, cb: any) => {
    if (cb) cb(makeRes(data, encoding));
    return makeReq();
  });
}

function mockGetSequence(responses: Array<{ data: any; encoding?: string }>) {
  let i = 0;
  (https.get as jest.Mock).mockImplementation((_url: any, _opts: any, cb: any) => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    if (cb) cb(makeRes(r.data, r.encoding ?? ''));
    return makeReq();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // zlib: default no-op (plain JSON goes through unchanged)
  (zlib.gunzipSync as jest.Mock).mockImplementation((b: Buffer) => b);
  (zlib.inflateSync as jest.Mock).mockImplementation((b: Buffer) => b);
  (zlib.brotliDecompressSync as jest.Mock).mockImplementation((b: Buffer) => b);
});

// ── news ──────────────────────────────────────────────────────────────────────

describe('nbaQueryHandler — news', () => {
  it('returns articles from ESPN news endpoint', async () => {
    mockGet({ articles: [{ headline: 'LeBron scores 50', summary: '' }] });
    const result = await nbaQueryHandler({ type: 'news', perPage: 5 });
    expect(result.success).toBe(true);
    expect(result.result.articles).toHaveLength(1);
  });

  it('filters articles by headline containing query', async () => {
    mockGet({ articles: [
      { headline: 'LeBron scores 50', summary: '' },
      { headline: 'Curry wins MVP', summary: '' },
    ] });
    const result = await nbaQueryHandler({ type: 'news', query: 'curry', perPage: 5 });
    expect(result.success).toBe(true);
    expect(result.result.articles).toHaveLength(1);
    expect(result.result.articles[0].headline).toMatch(/Curry/);
  });

  it('filters articles by summary containing query', async () => {
    mockGet({ articles: [
      { headline: 'Game recap', summary: 'Heat wins in overtime' },
      { headline: 'Preview', summary: 'Unrelated news' },
    ] });
    const result = await nbaQueryHandler({ type: 'news', query: 'heat wins', perPage: 5 });
    expect(result.success).toBe(true);
    expect(result.result.articles).toHaveLength(1);
  });

  it('falls back to items property when articles absent', async () => {
    mockGet({ items: [{ headline: 'Trade news' }] });
    const result = await nbaQueryHandler({ type: 'news', perPage: 5 });
    expect(result.success).toBe(true);
    expect(result.result.articles).toHaveLength(1);
  });

  it('returns empty articles when query matches nothing', async () => {
    mockGet({ articles: [{ headline: 'Knicks update', summary: '' }] });
    const result = await nbaQueryHandler({ type: 'news', query: 'zzzunknownzzz', perPage: 5 });
    expect(result.success).toBe(true);
    expect(result.result.articles).toHaveLength(0);
  });
});

// ── games ─────────────────────────────────────────────────────────────────────

describe('nbaQueryHandler — games', () => {
  it('returns events for a specific date', async () => {
    const event = { id: 'g1', name: 'Lakers at Celtics', status: { type: { state: 'post' } } };
    mockGet({ events: [event] });
    const result = await nbaQueryHandler({ type: 'games', date: '2025-01-15' });
    expect(result.success).toBe(true);
    expect(result.result.events[0].id).toBe('g1');
    expect(result.result.allScheduled).toBe(false);
  });

  it('returns allScheduled=true when all events are pre-state', async () => {
    mockGet({ events: [{ id: 'g2', name: 'Warriors at Nets', status: { type: { state: 'pre' } } }] });
    const result = await nbaQueryHandler({ type: 'games', date: '2025-06-01' });
    expect(result.success).toBe(true);
    expect(result.result.allScheduled).toBe(true);
  });

  it('filters events by query matching event name', async () => {
    mockGet({ events: [
      { id: 'g1', name: 'Lakers at Celtics', status: { type: { state: 'post' } } },
      { id: 'g2', name: 'Bulls at Heat',     status: { type: { state: 'post' } } },
    ] });
    const result = await nbaQueryHandler({ type: 'games', date: '2025-01-15', query: 'lakers' });
    expect(result.success).toBe(true);
    expect(result.result.events).toHaveLength(1);
    expect(result.result.events[0].id).toBe('g1');
  });

  it('falls back to rolling window when no date requested and scoreboard returns empty', async () => {
    // All https.get calls return empty events (no games in any window date)
    mockGet({ events: [] });
    const result = await nbaQueryHandler({ type: 'games' }); // no date
    expect(result.success).toBe(true);
    expect(result.result.events).toEqual([]);
  });

  it('replaces pre-state events with previous-day finished events when wantsResults=true', async () => {
    const preEvt  = { id: 'g-pre',  name: 'Future Game',   status: { type: { state: 'pre'  } } };
    const postEvt = { id: 'g-post', name: 'Finished Game', status: { type: { state: 'post' } } };
    mockGetSequence([
      { data: { events: [preEvt]  } }, // initial scoreboard fetch
      { data: { events: [postEvt] } }, // previous-day fetch
    ]);
    const result = await nbaQueryHandler({ type: 'games', date: '2025-03-01', wantsResults: true } as any);
    expect(result.success).toBe(true);
    expect(result.result.events[0].id).toBe('g-post');
  });

  it('keeps pre-state events when wantsResults=true but prev day has no finished games', async () => {
    const preEvt = { id: 'g-pre', name: 'Future Game', status: { type: { state: 'pre' } } };
    mockGetSequence([
      { data: { events: [preEvt] } }, // initial fetch
      { data: { events: [] } },       // previous-day fetch returns nothing finished
    ]);
    const result = await nbaQueryHandler({ type: 'games', date: '2025-03-01', wantsResults: true } as any);
    expect(result.success).toBe(true);
    expect(result.result.events[0].id).toBe('g-pre');
  });
});

// ── teams ─────────────────────────────────────────────────────────────────────

describe('nbaQueryHandler — teams', () => {
  it('returns all teams from ESPN', async () => {
    mockGet({ sports: [{ leagues: [{ teams: [
      { team: { id: '1', displayName: 'Los Angeles Lakers' } },
      { team: { id: '2', displayName: 'Boston Celtics' } },
    ] }] }] });
    const result = await nbaQueryHandler({ type: 'teams' });
    expect(result.success).toBe(true);
    expect(result.result.teams).toHaveLength(2);
  });

  it('returns empty teams when ESPN sports data is absent', async () => {
    mockGet({});
    const result = await nbaQueryHandler({ type: 'teams' });
    expect(result.success).toBe(true);
    expect(result.result.teams).toEqual([]);
  });
});

// ── standings ─────────────────────────────────────────────────────────────────

describe('nbaQueryHandler — standings', () => {
  it('returns conference standings with wins/losses/pct/gb/streak', async () => {
    mockGet({ children: [{
      name: 'Eastern Conference',
      standings: { entries: [{
        team: { displayName: 'Boston Celtics' },
        note: { rank: 1 },
        stats: [
          { name: 'wins',        value: 35    },
          { name: 'losses',      value: 10    },
          { name: 'winPercent',  value: 0.778 },
          { name: 'gamesBehind', value: 0     },
          { name: 'streak', displayValue: 'W3' },
        ],
      }] },
    }] });
    const result = await nbaQueryHandler({ type: 'standings' });
    expect(result.success).toBe(true);
    const east = result.result.standings[0];
    expect(east.conference).toBe('Eastern Conference');
    expect(east.teams[0].wins).toBe(35);
    expect(east.teams[0].losses).toBe(10);
    expect(east.teams[0].pct).toMatch(/0\.778/);
    expect(east.teams[0].streak).toBe('W3');
    expect(east.teams[0].gb).toBe('0');
  });

  it('uses abbreviation fallback (W/L/PCT/GB) and streak value when no displayValue', async () => {
    mockGet({ children: [{
      abbreviation: 'West',
      standings: { entries: [{
        team: { shortDisplayName: 'Lakers' },
        stats: [
          { abbreviation: 'W',   value: 20    },
          { abbreviation: 'L',   value: 25    },
          { abbreviation: 'PCT', value: 0.444 },
          { abbreviation: 'GB',  value: 5     },
          { name: 'streak',      value: 'L2'  }, // no displayValue → falls back to .value
        ],
      }] },
    }] });
    const result = await nbaQueryHandler({ type: 'standings' });
    expect(result.success).toBe(true);
    const conf = result.result.standings[0];
    expect(conf.teams[0].wins).toBe(20);
    expect(conf.teams[0].losses).toBe(25);
    expect(conf.teams[0].gb).toBe('5');
    expect(conf.teams[0].streak).toBe('L2');
  });

  it('returns empty standings when children array is absent', async () => {
    mockGet({});
    const result = await nbaQueryHandler({ type: 'standings' });
    expect(result.success).toBe(true);
    expect(result.result.standings).toEqual([]);
  });
});

// ── players ───────────────────────────────────────────────────────────────────

describe('nbaQueryHandler — players', () => {
  afterEach(() => {
    delete process.env.BALDONTLIE_API_KEY;
    delete process.env.BALDONTLIE_KEY;
  });

  it('returns empty players when no ESPN roster match and no API key', async () => {
    mockGetSequence([
      { data: { sports: [{ leagues: [{ teams: [{ team: { id: '1', displayName: 'Team A' } }] }] }] } },
      { data: { athletes: [] } },
    ]);
    const result = await nbaQueryHandler({ type: 'players', query: 'unknownplayer', perPage: 3 });
    expect(result.success).toBe(true);
    expect(result.result.players).toEqual([]);
  });

  it('falls back to balldontlie when API key is set and ESPN yields no results', async () => {
    process.env.BALDONTLIE_API_KEY = 'test-api-key';
    mockGetSequence([
      { data: { sports: [{ leagues: [{ teams: [{ team: { id: '1', displayName: 'Team A' } }] }] }] } },
      { data: { athletes: [] } },
      { data: { data: [{ id: 1, first_name: 'LeBron', last_name: 'James' }] } },
    ]);
    const result = await nbaQueryHandler({ type: 'players', query: 'lebron', perPage: 5 });
    expect(result.success).toBe(true);
    expect(result.result.data).toBeDefined();
  });
});

// ── httpsGet encoding branches ────────────────────────────────────────────────

describe('nbaQueryHandler — httpsGet encoding', () => {
  it('handles non-JSON text response gracefully (teams falls back to empty array)', async () => {
    mockGet('not-json-text');
    const result = await nbaQueryHandler({ type: 'teams' });
    expect(result.success).toBe(true);
    expect(result.result.teams).toEqual([]);
  });

  it('decompresses gzip-encoded response', async () => {
    const payload = JSON.stringify({ articles: [{ headline: 'Gzip article', summary: '' }] });
    (zlib.gunzipSync as jest.Mock).mockReturnValueOnce(Buffer.from(payload));
    mockGet('gzip-bytes', 'gzip');
    const result = await nbaQueryHandler({ type: 'news', perPage: 5 });
    expect(result.success).toBe(true);
    expect(result.result.articles[0].headline).toBe('Gzip article');
    expect(zlib.gunzipSync).toHaveBeenCalled();
  });

  it('decompresses deflate-encoded response', async () => {
    const payload = JSON.stringify({ events: [{ id: 'gd1', name: 'Deflate game', status: { type: { state: 'post' } } }] });
    (zlib.inflateSync as jest.Mock).mockReturnValueOnce(Buffer.from(payload));
    mockGet('deflate-bytes', 'deflate');
    const result = await nbaQueryHandler({ type: 'games', date: '2025-01-15' });
    expect(result.success).toBe(true);
    expect(zlib.inflateSync).toHaveBeenCalled();
  });

  it('decompresses br-encoded response', async () => {
    const payload = JSON.stringify({ articles: [{ headline: 'Brotli news', summary: '' }] });
    (zlib.brotliDecompressSync as jest.Mock).mockReturnValueOnce(Buffer.from(payload));
    mockGet('br-bytes', 'br');
    const result = await nbaQueryHandler({ type: 'news', perPage: 5 });
    expect(result.success).toBe(true);
    expect(result.result.articles[0].headline).toBe('Brotli news');
    expect(zlib.brotliDecompressSync).toHaveBeenCalled();
  });

  it('rejects when https.get emits an error event', async () => {
    (https.get as jest.Mock).mockImplementation((_url: any, _opts: any, _cb: any) => {
      const req: any = {
        on: jest.fn((event: string, cb: (...a: any[]) => void) => {
          if (event === 'error') cb(new Error('ECONNREFUSED 127.0.0.1'));
          return req;
        }),
      };
      return req;
    });
    const result = await nbaQueryHandler({ type: 'teams' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/NBA query failed/);
  });
});
