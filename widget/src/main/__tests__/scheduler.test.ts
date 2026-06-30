/**
 * scheduler.test.ts
 * Tests for src/main/scheduler.ts
 *
 * Uses jest.resetModules() + jest.doMock() in beforeEach so each test suite
 * gets a fresh module instance (resetting the module-level `jobs` array).
 */

// Type-only import for shape reference; actual module loaded dynamically
import type { ScheduledJob } from '../scheduler';

type SchedulerModule = {
  initScheduler: () => void;
  listJobs: () => ScheduledJob[];
  addJob: (input: Omit<ScheduledJob, 'id' | 'createdAt'>) => ScheduledJob;
  removeJob: (id: string) => boolean;
  toggleJob: (id: string, enabled: boolean) => ScheduledJob | null;
};

let scheduler: SchedulerModule;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();

  jest.doMock('fs', () => ({
    writeFileSync: jest.fn(),
    readFileSync: jest.fn().mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    }),
  }));

  jest.doMock('electron', () => ({
    app: {
      getPath: jest.fn().mockReturnValue('/tmp/homebot-test-scheduler'),
      isPackaged: false,
    },
    BrowserWindow: {
      getAllWindows: jest.fn().mockReturnValue([]),
    },
  }));

  scheduler = require('../scheduler') as SchedulerModule;
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

// ── listJobs ────────────────────────────────────────────────────────────────

describe('listJobs', () => {
  test('returns empty array on fresh module with no persisted jobs', () => {
    expect(scheduler.listJobs()).toEqual([]);
  });
});

// ── addJob ──────────────────────────────────────────────────────────────────

describe('addJob', () => {
  test('creates a job with auto-generated id and createdAt', () => {
    const input: Omit<ScheduledJob, 'id' | 'createdAt'> = {
      name: 'Daily Standup',
      message: 'Time for standup!',
      intervalMinutes: 60,
      enabled: true,
    };
    const job = scheduler.addJob(input);
    expect(job.id).toMatch(/^job-/);
    expect(job.createdAt).toBeGreaterThan(0);
    expect(job.name).toBe('Daily Standup');
    expect(job.message).toBe('Time for standup!');
    expect(job.intervalMinutes).toBe(60);
    expect(job.enabled).toBe(true);
  });

  test('added job appears in listJobs()', () => {
    scheduler.addJob({ name: 'Reminder', message: 'Check email', intervalMinutes: 30, enabled: true });
    const jobs = scheduler.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('Reminder');
  });

  test('each job gets a unique id', () => {
    const j1 = scheduler.addJob({ name: 'A', message: 'a', intervalMinutes: 10, enabled: true });
    const j2 = scheduler.addJob({ name: 'B', message: 'b', intervalMinutes: 20, enabled: true });
    expect(j1.id).not.toBe(j2.id);
  });

  test('disabled job is added but no timer started', () => {
    const j = scheduler.addJob({ name: 'Off', message: 'noop', intervalMinutes: 5, enabled: false });
    expect(j.enabled).toBe(false);
    expect(scheduler.listJobs()).toHaveLength(1);
  });

  test('job with dailyTime is stored correctly', () => {
    const j = scheduler.addJob({
      name: 'Morning',
      message: 'Good morning!',
      intervalMinutes: 0,
      dailyTime: '08:30',
      enabled: true,
    });
    expect(j.dailyTime).toBe('08:30');
  });

  test('saves jobs to disk (calls writeFileSync)', () => {
    const fsMock = require('fs');
    scheduler.addJob({ name: 'Test', message: 'hi', intervalMinutes: 1, enabled: false });
    expect(fsMock.writeFileSync).toHaveBeenCalled();
  });
});

// ── removeJob ───────────────────────────────────────────────────────────────

describe('removeJob', () => {
  test('removes an existing job and returns true', () => {
    const j = scheduler.addJob({ name: 'ToRemove', message: 'bye', intervalMinutes: 5, enabled: false });
    expect(scheduler.listJobs()).toHaveLength(1);
    const result = scheduler.removeJob(j.id);
    expect(result).toBe(true);
    expect(scheduler.listJobs()).toHaveLength(0);
  });

  test('returns false for unknown id', () => {
    const result = scheduler.removeJob('nonexistent-id');
    expect(result).toBe(false);
  });

  test('removes only the targeted job when multiple exist', () => {
    const j1 = scheduler.addJob({ name: 'Keep', message: 'k', intervalMinutes: 5, enabled: false });
    const j2 = scheduler.addJob({ name: 'Remove', message: 'r', intervalMinutes: 5, enabled: false });
    scheduler.removeJob(j2.id);
    const jobs = scheduler.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(j1.id);
  });
});

// ── toggleJob ───────────────────────────────────────────────────────────────

describe('toggleJob', () => {
  test('enables a disabled job', () => {
    const j = scheduler.addJob({ name: 'Toggle', message: 'hello', intervalMinutes: 5, enabled: false });
    const updated = scheduler.toggleJob(j.id, true);
    expect(updated).not.toBeNull();
    expect(updated!.enabled).toBe(true);
  });

  test('disables an enabled job', () => {
    const j = scheduler.addJob({ name: 'Toggle2', message: 'bye', intervalMinutes: 5, enabled: true });
    const updated = scheduler.toggleJob(j.id, false);
    expect(updated!.enabled).toBe(false);
  });

  test('returns null for unknown job id', () => {
    const result = scheduler.toggleJob('bad-id', true);
    expect(result).toBeNull();
  });

  test('toggle is reflected in listJobs()', () => {
    const j = scheduler.addJob({ name: 'Flip', message: 'flip', intervalMinutes: 10, enabled: false });
    scheduler.toggleJob(j.id, true);
    const found = scheduler.listJobs().find(x => x.id === j.id);
    expect(found!.enabled).toBe(true);
  });
});

// ── initScheduler ──────────────────────────────────────────────────────────

describe('initScheduler', () => {
  test('loads empty job list when no persisted file exists', () => {
    scheduler.initScheduler();
    expect(scheduler.listJobs()).toEqual([]);
  });

  test('loads jobs from persisted JSON when file exists', () => {
    const fsMock = require('fs');
    const persistedJobs = [
      {
        id: 'job-123-abc',
        name: 'Morning brief',
        message: 'Good morning!',
        intervalMinutes: 60,
        enabled: false, // disabled so no timer starts
        createdAt: Date.now(),
      },
    ];
    fsMock.readFileSync.mockReturnValueOnce(JSON.stringify(persistedJobs));

    scheduler.initScheduler();
    const jobs = scheduler.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('job-123-abc');
    expect(jobs[0].name).toBe('Morning brief');
  });

  test('handles malformed JSON gracefully (falls back to empty list)', () => {
    const fsMock = require('fs');
    fsMock.readFileSync.mockReturnValueOnce('NOT_VALID_JSON{{');
    scheduler.initScheduler();
    expect(scheduler.listJobs()).toEqual([]);
  });

  test('handles non-array JSON (falls back to empty list)', () => {
    const fsMock = require('fs');
    fsMock.readFileSync.mockReturnValueOnce(JSON.stringify({ jobs: [] }));
    scheduler.initScheduler();
    // Non-array → falls back to empty
    expect(scheduler.listJobs()).toEqual([]);
  });

  test('starts interval timer for enabled interval job after init', () => {
    const fsMock = require('fs');
    const persistedJobs = [
      {
        id: 'job-timer-test',
        name: 'Interval Job',
        message: 'tick',
        intervalMinutes: 5,
        enabled: true,
        createdAt: Date.now(),
      },
    ];
    fsMock.readFileSync.mockReturnValueOnce(JSON.stringify(persistedJobs));

    jest.useFakeTimers();
    scheduler.initScheduler();

    const win = {
      isDestroyed: jest.fn().mockReturnValue(false),
      webContents: { send: jest.fn() },
    };
    const electronMock = require('electron');
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([win]);

    // Advance 5+ minutes → job should fire
    jest.advanceTimersByTime(5 * 60_000 + 1000);
    expect(win.webContents.send).toHaveBeenCalledWith('homebot:reminder-fired', expect.objectContaining({ message: 'tick', label: 'Interval Job' }));
  });
});

describe('initScheduler', () => {
  test('handles missing jobs file gracefully (starts with empty list)', () => {
    // readFileSync already mocked to throw ENOENT in beforeEach
    scheduler.initScheduler();
    expect(scheduler.listJobs()).toEqual([]);
  });

  test('loads persisted jobs from JSON', () => {
    const persisted: ScheduledJob[] = [
      { id: 'job-1', name: 'Saved', message: 'persist', intervalMinutes: 15, enabled: false, createdAt: 1000 },
    ];
    const fsMock = require('fs');
    fsMock.readFileSync.mockReturnValueOnce(JSON.stringify(persisted));

    // Reset and re-require to get fresh state with readFileSync returning data
    jest.resetModules();
    jest.doMock('fs', () => ({
      writeFileSync: jest.fn(),
      readFileSync: jest.fn().mockReturnValue(JSON.stringify(persisted)),
    }));
    jest.doMock('electron', () => ({
      app: { getPath: jest.fn().mockReturnValue('/tmp/homebot-test-scheduler'), isPackaged: false },
      BrowserWindow: { getAllWindows: jest.fn().mockReturnValue([]) },
    }));
    const freshScheduler: SchedulerModule = require('../scheduler');
    freshScheduler.initScheduler();
    expect(freshScheduler.listJobs()).toHaveLength(1);
    expect(freshScheduler.listJobs()[0].name).toBe('Saved');
  });
});
