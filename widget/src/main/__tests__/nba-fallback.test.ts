import { fetchEventsInWindow, FALLBACK_FUTURE_DAYS, FALLBACK_PAST_DAYS } from '../tools/nba';

test('fetchEventsInWindow aggregates events across the fallback window', async () => {
  // Create a fake fetcher that returns no events except on a single future date
  const now = new Date('2026-02-01T00:00:00Z');
  const targetOffset = 20; // within the 30-day future window
  const targetDate = new Date(now);
  targetDate.setDate(now.getDate() + targetOffset);
  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getDate()).padStart(2, '0');
  const targetDateParam = `${y}${m}${d}`;

  const fakeFetcher = jest.fn(async (path: string, params?: Record<string, string | number>) => {
    const dates = params?.dates as string | undefined;
    if (dates === targetDateParam) {
      return { events: [{ id: 'evt-1', name: 'Team A at Team B' }] };
    }
    return { events: [] };
  });

  const events = await fetchEventsInWindow(fakeFetcher, now);
  expect(fakeFetcher).toHaveBeenCalled();
  // Should have found our single event
  expect(events.some(e => e.id === 'evt-1')).toBe(true);
  // Ensure the window covers our target offset
  expect(targetOffset).toBeLessThanOrEqual(FALLBACK_FUTURE_DAYS);
  expect(FALLBACK_PAST_DAYS).toBeGreaterThanOrEqual(0);
});
