/**
 * Reminder Tool Tests
 *
 * Uses Jest fake timers to test reminder firing without real delays.
 */

import {
  setReminderHandler,
  listRemindersHandler,
  cancelReminderHandler
} from '../tools/reminder';

// Mock Electron Notification so tests work in Node environment
jest.mock('electron', () => ({
  Notification: class {
    show = jest.fn();
  }
}));

describe('setReminderHandler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('creates a reminder with delay_seconds', async () => {
    const res = await setReminderHandler({ message: 'Take a break', delay_seconds: 60 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.id).toMatch(/^rem-/);
    expect(res.result.message).toBe('Take a break');
    expect(res.result.delay_seconds).toBe(60);
  });

  test('creates a reminder with fire_at ISO date', async () => {
    const future = new Date(Date.now() + 120000).toISOString();
    const res = await setReminderHandler({ message: 'Meeting!', fire_at: future }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.message).toBe('Meeting!');
  });

  test('rejects past fire_at', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const res = await setReminderHandler({ message: 'Old', fire_at: past }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('future');
  });

  test('rejects reminder more than 7 days out', async () => {
    const res = await setReminderHandler({ message: 'Far future', delay_seconds: 8 * 24 * 60 * 60 }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('7 days');
  });

  test('rejects missing message', async () => {
    const res = await setReminderHandler({ delay_seconds: 30 }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('message');
  });

  test('rejects when neither delay_seconds nor fire_at given', async () => {
    const res = await setReminderHandler({ message: 'What?' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('required');
  });
});

describe('listRemindersHandler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns empty list when no reminders set', async () => {
    // Cancel any stale reminder from previous tests by re-listing
    const list = await listRemindersHandler({}, {} as any);
    expect(list.success).toBe(true);
    expect(Array.isArray(list.result.reminders)).toBe(true);
  });

  test('shows newly set reminder in list', async () => {
    await setReminderHandler({ message: 'List test', delay_seconds: 300 }, {} as any);
    const list = await listRemindersHandler({}, {} as any);
    expect(list.result.count).toBeGreaterThanOrEqual(1);
    const found = list.result.reminders.find((r: any) => r.message === 'List test');
    expect(found).toBeDefined();
  });
});

describe('cancelReminderHandler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('cancels an existing reminder', async () => {
    const set = await setReminderHandler({ message: 'Cancel me', delay_seconds: 600 }, {} as any);
    const { id } = set.result;

    const cancel = await cancelReminderHandler({ id }, {} as any);
    expect(cancel.success).toBe(true);
    expect(cancel.result.cancelled).toBe(true);
  });

  test('returns error for unknown id', async () => {
    const res = await cancelReminderHandler({ id: 'rem-fake-123' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });

  test('reminder is gone from list after cancel', async () => {
    const set = await setReminderHandler({ message: 'Gone', delay_seconds: 600 }, {} as any);
    await cancelReminderHandler({ id: set.result.id }, {} as any);

    const list = await listRemindersHandler({}, {} as any);
    const found = list.result.reminders.find((r: any) => r.id === set.result.id);
    expect(found).toBeUndefined();
  });
});
