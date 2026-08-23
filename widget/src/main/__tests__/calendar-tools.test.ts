/**
 * calendar-tools.test.ts
 * Tests for src/main/tools/calendar.ts
 *
 * Outlook COM is mocked (always throws) so all tests exercise the local-store
 * path. fs is partially mocked to control the JSON store on disk.
 */

// Mock config-manager to avoid pulling in Electron
jest.mock('../config-manager', () => ({
  getSettings: () => ({ n8nUrl: 'http://localhost:5678' }),
}));

// Mock axios to prevent real HTTP calls to n8n
jest.mock('axios', () => ({
  post: jest.fn().mockRejectedValue(new Error('n8n unavailable in tests')),
}));

// Mock child_process – Outlook always unavailable in CI
const mockExecImpl = jest.fn();
jest.mock('child_process', () => ({ exec: mockExecImpl }));

// Mock fs to avoid writing real files
const mockFsExistsSync = jest.fn();
const mockFsReadFileSync = jest.fn();
const mockFsWriteFileSync = jest.fn();
const mockFsMkdirSync = jest.fn();

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
  writeFileSync: mockFsWriteFileSync,
  mkdirSync: mockFsMkdirSync,
}));

// calendar.ts now authenticates its n8n calls, and webhook-auth reads the
// per-install secret from userData — so this suite needs an app stub. Without
// it the real electron module throws on import and the whole file fails to run
// before a single assertion.
jest.mock('electron', () => ({
  app: { getPath: () => '/tmp/homebot-test-userdata' },
}));

import {
  listCalendarEventsHandler,
  addCalendarEventHandler,
  deleteCalendarEventHandler,
  listCalendarEventsDef,
  addCalendarEventDef,
  deleteCalendarEventDef,
  calendarToolDefs,
} from '../tools/calendar';

// Helper: make exec always throw (Outlook unavailable)
function mockOutlookUnavailable() {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(new Error('Outlook not available'), { stdout: '' });
    return { on: jest.fn() };
  });
}

// Helper: mock an empty local calendar store
function mockEmptyStore() {
  mockFsExistsSync.mockReturnValue(false);
  mockFsReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockFsWriteFileSync.mockImplementation(() => {});
  mockFsMkdirSync.mockImplementation(() => {});
}

// Helper: mock a store with existing events
function mockStoreWith(events: any[]) {
  mockFsExistsSync.mockReturnValue(true);
  mockFsReadFileSync.mockReturnValue(JSON.stringify(events));
  mockFsWriteFileSync.mockImplementation(() => {});
  mockFsMkdirSync.mockImplementation(() => {});
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOutlookUnavailable();
  mockEmptyStore();
});

// ── listCalendarEventsHandler ──────────────────────────────────────────────

describe('listCalendarEventsHandler', () => {
  test('returns empty events when store is empty', async () => {
    const res = await listCalendarEventsHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.events).toEqual([]);
    expect(res.result.count).toBe(0);
  });

  test('includes upcoming local events within days_ahead window', async () => {
    const future = new Date(Date.now() + 2 * 86400000).toISOString(); // 2 days from now
    mockStoreWith([
      { id: 'e1', title: 'Team meeting', start: future, end: future, source: 'local' },
    ]);
    const res = await listCalendarEventsHandler({ days_ahead: 7 }, {} as any);
    expect(res.result.count).toBe(1);
    expect(res.result.events[0].title).toBe('Team meeting');
  });

  test('excludes past events', async () => {
    const past = new Date(Date.now() - 86400000).toISOString(); // yesterday
    mockStoreWith([
      { id: 'past1', title: 'Old meeting', start: past, end: past, source: 'local' },
    ]);
    const res = await listCalendarEventsHandler({ days_ahead: 7 }, {} as any);
    expect(res.result.count).toBe(0);
  });

  test('respects limit parameter', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`, title: `Event ${i}`, start: future, end: future, source: 'local' as const,
    }));
    mockStoreWith(events);
    const res = await listCalendarEventsHandler({ days_ahead: 7, limit: 3 }, {} as any);
    expect(res.result.events.length).toBe(3);
  });

  test('clamps days_ahead to 1 minimum', async () => {
    const res = await listCalendarEventsHandler({ days_ahead: -5 }, {} as any);
    expect(res.result.days_ahead).toBe(1);
  });

  test('clamps days_ahead to 90 maximum', async () => {
    const res = await listCalendarEventsHandler({ days_ahead: 500 }, {} as any);
    expect(res.result.days_ahead).toBe(90);
  });

  test('defaults to 7 days when days_ahead not provided', async () => {
    const res = await listCalendarEventsHandler({}, {} as any);
    expect(res.result.days_ahead).toBe(7);
  });
});

// ── addCalendarEventHandler ────────────────────────────────────────────────

describe('addCalendarEventHandler', () => {
  test('returns failure when title is missing', async () => {
    const res = await addCalendarEventHandler({
      start: '2026-04-01T09:00:00',
      end: '2026-04-01T10:00:00',
    }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/title/i);
  });

  test('returns failure when start is missing', async () => {
    const res = await addCalendarEventHandler({
      title: 'Meeting',
      end: '2026-04-01T10:00:00',
    }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/start/i);
  });

  test('returns failure when end is missing', async () => {
    const res = await addCalendarEventHandler({
      title: 'Meeting',
      start: '2026-04-01T09:00:00',
    }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/end/i);
  });

  test('returns failure for invalid start date', async () => {
    const res = await addCalendarEventHandler({
      title: 'Test', start: 'not-a-date', end: '2026-04-01T10:00:00',
    }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/invalid start/i);
  });

  test('returns failure for invalid end date', async () => {
    const res = await addCalendarEventHandler({
      title: 'Test', start: '2026-04-01T09:00:00', end: 'garbage',
    }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/invalid end/i);
  });

  test('returns failure when end is before start', async () => {
    const res = await addCalendarEventHandler({
      title: 'Bad order',
      start: '2026-04-01T10:00:00',
      end: '2026-04-01T09:00:00',
    }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/end must be after/i);
  });

  test('adds event to local store (Outlook unavailable)', async () => {
    const res = await addCalendarEventHandler({
      title: 'Sprint planning',
      start: '2026-04-01T09:00:00',
      end: '2026-04-01T10:30:00',
      location: 'Zoom',
      notes: 'Bring backlog',
    }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.added.title).toBe('Sprint planning');
    expect(res.result.added.location).toBe('Zoom');
    expect(res.result.savedToOutlook).toBe(false);
    expect(mockFsWriteFileSync).toHaveBeenCalled();
  });

  test('generated id starts with cal_', async () => {
    const res = await addCalendarEventHandler({
      title: 'Daily standup',
      start: '2026-04-02T09:00:00',
      end: '2026-04-02T09:15:00',
    }, {} as any);
    expect(res.result.added.id).toMatch(/^cal_/);
  });

  test('start and end stored in ISO format', async () => {
    const res = await addCalendarEventHandler({
      title: 'ISO test',
      start: '2026-04-03T14:00:00',
      end: '2026-04-03T15:00:00',
    }, {} as any);
    expect(res.result.added.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.result.added.end).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── deleteCalendarEventHandler ─────────────────────────────────────────────

describe('deleteCalendarEventHandler', () => {
  test('returns failure when id is missing', async () => {
    const res = await deleteCalendarEventHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/id is required/i);
  });

  test('returns failure for unknown event id', async () => {
    mockEmptyStore();
    const res = await deleteCalendarEventHandler({ id: 'fake-id' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no local event/i);
  });

  test('deletes an existing event and saves updated list', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockStoreWith([
      { id: 'to-delete', title: 'Delete me', start: future, end: future, source: 'local' },
      { id: 'keep', title: 'Keep me', start: future, end: future, source: 'local' },
    ]);
    const res = await deleteCalendarEventHandler({ id: 'to-delete' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.deleted.id).toBe('to-delete');
    // Saved list should only contain the kept event
    const saved = JSON.parse(mockFsWriteFileSync.mock.calls[0][1]);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('keep');
  });
});

// ── Tool definitions ───────────────────────────────────────────────────────

describe('calendarToolDefs', () => {
  test('exports 3 definitions', () => {
    expect(calendarToolDefs).toHaveLength(3);
  });

  test('list_calendar_events has no required parameters', () => {
    expect(listCalendarEventsDef.parameters.required).toEqual([]);
  });

  test('add_calendar_event requires title, start, end', () => {
    expect(addCalendarEventDef.parameters.required).toContain('title');
    expect(addCalendarEventDef.parameters.required).toContain('start');
    expect(addCalendarEventDef.parameters.required).toContain('end');
  });

  test('add_calendar_event requires confirmation', () => {
    expect(addCalendarEventDef.requiresConfirmation).toBe(true);
  });

  test('delete_calendar_event requires id', () => {
    expect(deleteCalendarEventDef.parameters.required).toContain('id');
  });

  test('delete_calendar_event requires confirmation', () => {
    expect(deleteCalendarEventDef.requiresConfirmation).toBe(true);
  });
});
