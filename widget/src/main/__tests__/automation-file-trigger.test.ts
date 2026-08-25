/**
 * File-watch automation trigger — tool-layer tests.
 *
 * The house defect is capability nothing can reach, so these assert what a
 * PERSON gets: creating a file-triggered automation through chat either
 * validates the folder honestly at save time, or says exactly why it refused.
 * The firing half lives in scheduler-file-watch.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// userData must live somewhere writable; 'home' must be the REAL home so the
// watch-path boundary validation behaves exactly as it will on a user machine.
const mockUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-filetrigger-ud-'));

jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'home' ? os.homedir() : mockUserDataDir),
  },
}));

jest.mock('../n8n-api', () => ({
  createAndActivateWorkflow: jest.fn(),
  importWorkflow: jest.fn(),
  activateWorkflow: jest.fn(),
  validateWorkflowJson: jest.requireActual('../n8n-api').validateWorkflowJson,
  extractWebhookUrl: jest.fn(),
}));

import {
  createAutomationHandler,
  updateAutomationHandler,
} from '../tools/automation';

const ctx = {} as any;

/** A folder that legitimately passes the home boundary on any platform. */
function makeHomeFolder(): string {
  const dir = fs.mkdtempSync(path.join(os.homedir(), 'homebot-watch-test-'));
  return dir;
}

let homeFolders: string[] = [];
afterAll(() => {
  for (const d of homeFolders) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(mockUserDataDir, { recursive: true, force: true });
});

describe('create_automation with trigger="file"', () => {
  test('creates with a resolved watch folder and stores the pattern', async () => {
    const dir = makeHomeFolder();
    homeFolders.push(dir);
    const res = await createAutomationHandler(
      { name: 'Inbox watcher', instructions: 'Summarise the file', trigger: 'file', watch_path: dir, watch_pattern: '*.csv' },
      ctx,
    );
    expect(res.success).toBe(true);
    const created = (res.result as any)?.created;
    expect(created.trigger).toBe('file');
    expect(created.watch_path).toBe(fs.realpathSync.native(dir));
    expect(created.watch_pattern).toBe('*.csv');
  });

  test('refuses without a folder and says what is missing', async () => {
    const res = await createAutomationHandler(
      { name: 'No folder', instructions: 'x', trigger: 'file' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/watch_path/i);
  });

  test('refuses a folder outside the user folder', async () => {
    // A drive root cannot be inside any home directory.
    const res = await createAutomationHandler(
      { name: 'Drive root', instructions: 'x', trigger: 'file', watch_path: 'C:\\' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/inside your user folder/i);
  });

  test('refuses a folder that does not exist yet', async () => {
    const ghost = path.join(os.homedir(), 'homebot-watch-test-does-not-exist');
    const res = await createAutomationHandler(
      { name: 'Ghost folder', instructions: 'x', trigger: 'file', watch_path: ghost },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/does not exist/i);
  });

  test('refuses a pattern containing slashes', async () => {
    const dir = makeHomeFolder();
    homeFolders.push(dir);
    const res = await createAutomationHandler(
      { name: 'Bad pattern', instructions: 'x', trigger: 'file', watch_path: dir, watch_pattern: 'a/b/*.csv' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/no slashes/i);
  });
});

describe('update_automation switching triggers', () => {
  test('switching away from file drops the stale watch config', async () => {
    const dir = makeHomeFolder();
    homeFolders.push(dir);
    await createAutomationHandler(
      { name: 'Switcher', instructions: 'x', trigger: 'file', watch_path: dir },
      ctx,
    );

    const res = await updateAutomationHandler(
      { automation: 'Switcher', trigger: 'schedule', schedule_minutes: 30 },
      ctx,
    );
    expect(res.success).toBe(true);
    const updated = (res.result as any)?.updated;
    expect(updated.trigger).toBe('schedule');
    expect(updated.watch_path).toBeUndefined();
    expect(updated.watch_pattern).toBeUndefined();
  });

  test('switching to file validates the new folder instead of trusting it', async () => {
    await createAutomationHandler(
      { name: 'Late switcher', instructions: 'x', trigger: 'manual' },
      ctx,
    );
    const res = await updateAutomationHandler(
      { automation: 'Late switcher', trigger: 'file', watch_path: 'Z:\\nowhere' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/inside your user folder|does not exist/i);
  });
});
