/**
 * File-watch automation trigger — the FIRING half, end to end.
 *
 * A trigger type with no firing mechanism is worse than none, so this drives
 * the real chain: automations.json on disk → initFileWatchTriggers() → a file
 * actually appearing in the watched folder → fireAutomationById called for
 * the right automation. The execution engine itself is stubbed; everything
 * around it is real (fs.watch, the store watcher, debouncing, pattern match).
 *
 * These tests use REAL filesystem watches under the user's home, so they only
 * run where that is safe — Windows and macOS. That is also the honest scope:
 * HomeBot ships Windows-only.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const isWindowsish = process.platform === 'win32' || process.platform === 'darwin';
const d = !isWindowsish ? describe.skip : describe;

// userData gets its own temp dir inside the home dir so the boundary checks
// and fs.watch both operate on real, same-volume paths.
const mockUserDataDir = fs.mkdtempSync(path.join(os.homedir(), 'homebot-watch-engine-ud-'));

jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'home' ? os.homedir() : mockUserDataDir),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

const mockFire = jest.fn().mockResolvedValue({ fired: true, success: true });

jest.mock('../tools/automation', () => ({
  ...jest.requireActual('../tools/automation'),
  // The engine must call THIS to run an automation — assert it directly.
  fireAutomationById: (...args: any[]) => mockFire(...args),
}));

import {
  initFileWatchTriggers,
  stopFileWatchTriggers,
  resyncFileWatchTriggers,
} from '../scheduler';

const STORE = path.join(mockUserDataDir, 'automations.json');

function writeStore(automations: any[]): void {
  fs.writeFileSync(STORE, JSON.stringify(automations, null, 2), 'utf8');
}

/** Poll until fn() is truthy — never an instantaneous count(). */
async function until(fn: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('condition not met in time');
}

let watchedDir: string;

beforeEach(() => {
  jest.clearAllMocks();
  watchedDir = fs.mkdtempSync(path.join(os.homedir(), 'homebot-watch-folder-'));
  if (fs.existsSync(STORE)) fs.unlinkSync(STORE);
});

afterEach(() => {
  stopFileWatchTriggers();
  fs.rmSync(watchedDir, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(mockUserDataDir, { recursive: true, force: true });
});

d('file-watch trigger engine', () => {
  test('a new matching file fires the automation', async () => {
    writeStore([
      { id: 'a1', name: 'CSV watcher', trigger: 'file', enabled: true, watchPath: watchedDir, watchPattern: '*.csv' },
    ]);
    initFileWatchTriggers();

    fs.writeFileSync(path.join(watchedDir, 'report.csv'), 'a,b,c');

    await until(() => mockFire.mock.calls.length > 0);
    expect(mockFire).toHaveBeenCalledWith('a1', expect.objectContaining({ fileName: 'report.csv' }));
  });

  test('a non-matching file does not fire it', async () => {
    writeStore([
      { id: 'a2', name: 'Only CSVs', trigger: 'file', enabled: true, watchPath: watchedDir, watchPattern: '*.csv' },
    ]);
    initFileWatchTriggers();

    fs.writeFileSync(path.join(watchedDir, 'notes.txt'), 'hello');

    await new Promise(r => setTimeout(r, 900));
    expect(mockFire).not.toHaveBeenCalled();
  });

  test('a disabled automation does not fire even though the folder matches', async () => {
    writeStore([
      { id: 'a3', name: 'Disabled watcher', trigger: 'file', enabled: false, watchPath: watchedDir },
    ]);
    initFileWatchTriggers();

    fs.writeFileSync(path.join(watchedDir, 'anything.csv'), 'x');

    await new Promise(r => setTimeout(r, 900));
    expect(mockFire).not.toHaveBeenCalled();
  });

  test('adding an automation by editing the store behind the engine arms it anyway', async () => {
    // Start with NO file-trigger automations — the engine must still be
    // listening for changes to automations.json itself.
    writeStore([{ id: 'manual1', name: 'Manual thing', trigger: 'manual', enabled: true }]);
    initFileWatchTriggers();

    writeStore([
      { id: 'manual1', name: 'Manual thing', trigger: 'manual', enabled: true },
      { id: 'late', name: 'Late addition', trigger: 'file', enabled: true, watchPath: watchedDir, watchPattern: '*' },
    ]);

    // The store event goes through a debounced resync; rather than sleeping a
    // fixed guess, re-drop the probe file until the automation fires — each
    // retry also re-fires the store event, so a missed one self-heals.
    const deadline = Date.now() + 8000;
    let fired = false;
    while (Date.now() < deadline) {
      fs.writeFileSync(path.join(watchedDir, 'probe.txt'), `probe-${Date.now()}`);
      try {
        await until(() => mockFire.mock.calls.some(c => c[0] === 'late'), 1200);
        fired = true;
        break;
      } catch { /* not armed yet — rewrite the store and retry */ }
      writeStore([
        { id: 'manual1', name: 'Manual thing', trigger: 'manual', enabled: true },
        { id: 'late', name: 'Late addition', trigger: 'file', enabled: true, watchPath: watchedDir, watchPattern: '*' },
      ]);
    }
    expect(fired).toBe(true);
    expect(mockFire).toHaveBeenCalledWith('late', expect.objectContaining({ fileName: expect.stringMatching(/^probe/) }));
  });

  test('removing or disabling via the store disarms without firing again', async () => {
    writeStore([
      { id: 'gone', name: 'Soon gone', trigger: 'file', enabled: true, watchPath: watchedDir },
    ]);
    initFileWatchTriggers();

    writeStore([]); // deleted through the UI would do exactly this
    resyncFileWatchTriggers(); // the reconcile under test, called directly

    fs.writeFileSync(path.join(watchedDir, 'after-delete.csv'), 'x');

    await new Promise(r => setTimeout(r, 900));
    expect(mockFire).not.toHaveBeenCalled();
  });

  test('a pattern-less watch fires for any file', async () => {
    writeStore([
      { id: 'any', name: 'Any file', trigger: 'file', enabled: true, watchPath: watchedDir },
    ]);
    initFileWatchTriggers();

    fs.writeFileSync(path.join(watchedDir, 'whatever.log'), 'x');

    await until(() => mockFire.mock.calls.length > 0);
    expect(mockFire).toHaveBeenCalledWith('any', expect.objectContaining({ fileName: 'whatever.log' }));
  });
});
