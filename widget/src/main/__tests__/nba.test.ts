/**
 * Tests for nba.ts – focuses on exported, injector-friendly utilities.
 * Network calls are avoided by using the injected fetcher in fetchEventsInWindow.
 */
import {
  fetchEventsInWindow,
  fetchSeasonEvents,
  nbaQueryDef,
  nbaQueryHandler,
  FALLBACK_PAST_DAYS,
  FALLBACK_FUTURE_DAYS,
} from '../../main/tools/nba';

// ─── constants ────────────────────────────────────────────────────────────────

test('FALLBACK_PAST_DAYS is 3', () => {
  expect(FALLBACK_PAST_DAYS).toBe(3);
});

test('FALLBACK_FUTURE_DAYS is 30', () => {
  expect(FALLBACK_FUTURE_DAYS).toBe(30);
});

// ─── nbaQueryDef ─────────────────────────────────────────────────────────────

test('nbaQueryDef.name is nba_query', () => {
  expect(nbaQueryDef.name).toBe('nba_query');
});

test('nbaQueryDef.parameters.required includes type', () => {
  expect(nbaQueryDef.parameters.required).toContain('type');
});

test('nbaQueryDef has correct type enum', () => {
  const props = nbaQueryDef.parameters.properties as any;
  expect(props.type.enum).toEqual(
    expect.arrayContaining(['games', 'teams', 'players', 'standings'])
  );
});

// ─── fetchEventsInWindow ──────────────────────────────────────────────────────

test('returns empty array when fetcher always returns no events', async () => {
  const fetcher = jest.fn().mockResolvedValue({ events: [] });
  const result = await fetchEventsInWindow(fetcher);
  expect(result).toEqual([]);
});

test('aggregates events returned by the fetcher', async () => {
  const fetcher = jest.fn()
    .mockResolvedValueOnce({ events: [{ id: 'g1', name: 'Lakers vs Celtics' }] })
    .mockResolvedValue({ events: [] });
  const result = await fetchEventsInWindow(fetcher);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe('g1');
});

test('deduplicates events that appear on multiple dates', async () => {
  const sharedEvent = { id: 'g1', name: 'Nets vs Heat' };
  const fetcher = jest.fn().mockResolvedValue({ events: [sharedEvent] });
  const result = await fetchEventsInWindow(fetcher);
  // Even though every day returns the same event, only one copy should survive
  expect(result).toHaveLength(1);
});

test('ignores individual date fetch errors and continues', async () => {
  const fetcher = jest.fn()
    .mockRejectedValueOnce(new Error('network error'))
    .mockResolvedValue({ events: [{ id: 'g2', name: 'Bulls vs Hawks' }] });
  const result = await fetchEventsInWindow(fetcher);
  // Should still collect events from the successful fetches
  expect(result.length).toBeGreaterThan(0);
});

test('calls fetcher for each day in the window', async () => {
  const fetcher = jest.fn().mockResolvedValue({ events: [] });
  const fixedDate = new Date('2025-01-15T12:00:00Z');
  await fetchEventsInWindow(fetcher, fixedDate);
  const expectedCalls = FALLBACK_PAST_DAYS + FALLBACK_FUTURE_DAYS + 1; // inclusive range
  expect(fetcher).toHaveBeenCalledTimes(expectedCalls);
});

test('fetcher is called with /scoreboard path', async () => {
  const fetcher = jest.fn().mockResolvedValue({ events: [] });
  const fixedDate = new Date('2025-06-01T12:00:00Z');
  await fetchEventsInWindow(fetcher, fixedDate);
  for (const call of fetcher.mock.calls) {
    expect(call[0]).toBe('/scoreboard');
  }
});

test('passes formatted dates as YYYYMMDD in params', async () => {
  const fetcher = jest.fn().mockResolvedValue({ events: [] });
  const fixedDate = new Date('2025-06-01T12:00:00Z');
  await fetchEventsInWindow(fetcher, fixedDate);
  const dateCalls = fetcher.mock.calls.map((c: any[]) => c[1]?.dates);
  // The date for the fixedDate itself should appear (offset 0)
  expect(dateCalls.some((d: string) => d && /^\d{8}$/.test(d))).toBe(true);
});

// ─── fetchSeasonEvents ────────────────────────────────────────────────────────

test('fetchSeasonEvents calls fetcher with date-range param', async () => {
  const fetcher = jest.fn().mockResolvedValue({ events: [] });
  const fixedDate = new Date(2026, 1, 15, 12, 0, 0); // Feb 15 local
  await fetchSeasonEvents(fetcher, fixedDate);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('/scoreboard', expect.objectContaining({
    dates: '20251001-20260215',
    limit: 1000,
  }));
});

test('fetchSeasonEvents filters to completed games by default', async () => {
  const fetcher = jest.fn().mockResolvedValue({
    events: [
      { id: 'g1', status: { type: { state: 'post' } } },
      { id: 'g2', status: { type: { state: 'pre' } } },
    ],
  });
  const result = await fetchSeasonEvents(fetcher, new Date(2026, 0, 10, 12));
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe('g1');
});

test('fetchSeasonEvents includes scheduled games when flag is set', async () => {
  const fetcher = jest.fn().mockResolvedValue({
    events: [
      { id: 'g1', status: { type: { state: 'post' } } },
      { id: 'g2', status: { type: { state: 'pre' } } },
    ],
  });
  const result = await fetchSeasonEvents(fetcher, new Date(2026, 0, 10, 12), true);
  expect(result).toHaveLength(2);
});

test('fetchSeasonEvents returns empty array on network error', async () => {
  const fetcher = jest.fn().mockRejectedValue(new Error('timeout'));
  const result = await fetchSeasonEvents(fetcher, new Date(2026, 0, 10, 12));
  expect(result).toEqual([]);
});

test('fetchSeasonEvents uses previous year for Oct-Dec dates', async () => {
  const fetcher = jest.fn().mockResolvedValue({ events: [] });
  const fixedDate = new Date(2025, 10, 20, 12, 0, 0); // Nov 20 local
  await fetchSeasonEvents(fetcher, fixedDate);
  expect(fetcher).toHaveBeenCalledWith('/scoreboard', expect.objectContaining({
    dates: '20251001-20251120',
  }));
});

test('fetchSeasonEvents uses previous year for Jan-Sep dates', async () => {
  const fetcher = jest.fn().mockResolvedValue({ events: [] });
  const fixedDate = new Date(2026, 3, 10, 12, 0, 0); // Apr 10 local
  await fetchSeasonEvents(fetcher, fixedDate);
  expect(fetcher).toHaveBeenCalledWith('/scoreboard', expect.objectContaining({
    dates: '20251001-20260410',
  }));
});

// ─── nbaQueryHandler – pure error paths (no http) ────────────────────────────

test('returns error for invalid type', async () => {
  const result = await nbaQueryHandler({ type: 'invalid_type' }, {} as any);
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/invalid type/i);
});

test('returns error for stats type without query', async () => {
  const result = await nbaQueryHandler({ type: 'stats' }, {} as any);
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/query.*required/i);
});

test('returns error for roster without query', async () => {
  const result = await nbaQueryHandler({ type: 'roster', query: '' }, {} as any);
  expect(result.success).toBe(false);
  expect(result.error).toBeTruthy();
});
