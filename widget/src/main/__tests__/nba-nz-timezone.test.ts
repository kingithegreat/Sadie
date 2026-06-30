/**
 * NBA wantsResults NZ/AU timezone edge-case tests
 *
 * When a NZ or AU user asks "who won last night?" their system date is already
 * tomorrow relative to US Eastern time.  The scoreboard for their local "today"
 * returns games that are still in pre-game state.  nbaQueryHandler should
 * detect this via wantsResults=true and transparently look up the previous
 * calendar day, returning the finished results instead.
 */

// Must be declared before any imports so Jest hoists the factory.
jest.mock('https');

import * as https from 'https';
import { nbaQueryHandler } from '../tools/nba';

// ── helpers ────────────────────────────────────────────────────────────────

function makeEvent(state: 'pre' | 'in' | 'post', name = 'Team A vs Team B') {
  return {
    name,
    shortName: name,
    status: { type: { state } },
    competitions: [
      {
        competitors: [
          { team: { displayName: 'Team A', abbreviation: 'TA' }, score: '110' },
          { team: { displayName: 'Team B', abbreviation: 'TB' }, score: '105' },
        ],
      },
    ],
  };
}

/** Wire up https.get to return payloads in sequence. */
function mockHttpsSequence(payloads: (object | 'error')[]) {
  let callIndex = 0;
  (https.get as jest.Mock).mockImplementation((_url: any, _opts: any, cb: any) => {
    const payload = payloads[callIndex] ?? { events: [] };
    callIndex++;

    if (payload === 'error') {
      const req: any = {
        on(evt: string, h: any) { if (evt === 'error') setTimeout(() => h(new Error('network failure')), 0); return req; },
      };
      return req;
    }

    const body = Buffer.from(JSON.stringify(payload));
    const res: any = {
      headers: {},
      on(event: string, handler: (...args: any[]) => void) {
        if (event === 'data') handler(body);
        if (event === 'end') handler();
        return res;
      },
    };
    const resolveCb = typeof cb === 'function' ? cb : typeof _opts === 'function' ? _opts : null;
    if (resolveCb) resolveCb(res);
    return { on: () => {} } as any;
  });
  return https.get as jest.Mock;
}

// ── tests ──────────────────────────────────────────────────────────────────

beforeEach(() => (https.get as jest.Mock).mockReset());
afterEach(() => jest.clearAllMocks());

describe('nbaQueryHandler — NZ/AU previous-day fallback', () => {
  test('returns finished games from previous day when today has only pre-game events and wantsResults=true', async () => {
    const todayDate = '20260307';
    const finishedEvent = makeEvent('post', 'Lakers vs Celtics');

    // First call: scoreboard for today → all pre-game
    // Second call: scoreboard for yesterday → finished game
    mockHttpsSequence([
      { events: [makeEvent('pre'), makeEvent('pre')] },
      { events: [finishedEvent] },
    ]);

    const result = await nbaQueryHandler(
      { type: 'games', date: todayDate, wantsResults: true } as any,
      {} as any,
    );

    expect(result.success).toBe(true);
    const events: any[] = result.result.events;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e: any) => e.status?.type?.state === 'post')).toBe(true);
    expect(events[0].name).toBe('Lakers vs Celtics');
  });

  test('does NOT fall back when wantsResults is false (user just wants schedule)', async () => {
    const todayDate = '20260307';

    // Only one network call should be made
    const spy = mockHttpsSequence([
      { events: [makeEvent('pre'), makeEvent('pre')] },
      { events: [makeEvent('post')] }, // should never be reached
    ]);

    const result = await nbaQueryHandler(
      { type: 'games', date: todayDate, wantsResults: false } as any,
      {} as any,
    );

    expect(result.success).toBe(true);
    const events: any[] = result.result.events;
    // All events should still be pre-game (no fallback triggered)
    expect(events.every((e: any) => e.status?.type?.state === 'pre')).toBe(true);
    // Second payload never fetched
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('keeps today events when previous day has no finished games', async () => {
    const todayDate = '20260307';
    const todayPre = makeEvent('pre', 'Warriors vs Suns');

    mockHttpsSequence([
      { events: [todayPre] },
      { events: [makeEvent('pre')] }, // yesterday also pre → no finished games
    ]);

    const result = await nbaQueryHandler(
      { type: 'games', date: todayDate, wantsResults: true } as any,
      {} as any,
    );

    expect(result.success).toBe(true);
    const events: any[] = result.result.events;
    expect(events[0].name).toBe('Warriors vs Suns');
  });

  test('keeps today events when previous day fetch fails', async () => {
    const todayDate = '20260307';
    const todayPre = makeEvent('pre', 'Heat vs Bulls');

    mockHttpsSequence([
      { events: [todayPre] },
      'error',
    ]);

    const result = await nbaQueryHandler(
      { type: 'games', date: todayDate, wantsResults: true } as any,
      {} as any,
    );

    expect(result.success).toBe(true);
    const events: any[] = result.result.events;
    expect(events[0].name).toBe('Heat vs Bulls');
  });

  test('does NOT fall back when today has a mix of live and pre-game events', async () => {
    const todayDate = '20260307';

    mockHttpsSequence([
      { events: [makeEvent('in', 'Knicks vs Nets'), makeEvent('pre', 'Mavs vs Thunder')] },
      { events: [makeEvent('post')] },
    ]);

    const result = await nbaQueryHandler(
      { type: 'games', date: todayDate, wantsResults: true } as any,
      {} as any,
    );

    expect(result.success).toBe(true);
    // Live game should be present; fallback should NOT have fired
    const events: any[] = result.result.events;
    expect(events.some((e: any) => e.status?.type?.state === 'in')).toBe(true);
  });
});
