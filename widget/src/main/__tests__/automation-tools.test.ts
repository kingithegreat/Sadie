/**
 * Automation Tools Tests
 *
 * Covers the chat-facing Automation Center tools: create_automation,
 * list_automations, run_automation, update_automation, delete_automation.
 * Uses a temp userData dir so the real automations.json is never touched.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mockUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-automation-test-'));

jest.mock('electron', () => ({
  app: {
    getPath: (_name: string) => mockUserDataDir,
  },
}));

import {
  createAutomationHandler,
  listAutomationsHandler,
  runAutomationHandler,
  updateAutomationHandler,
  deleteAutomationHandler,
  registerAutomationRunner,
  registerAutomationTierProvider,
  automationToolDefs,
} from '../tools/automation';

const AUTOMATIONS_FILE = path.join(mockUserDataDir, 'automations.json');
const ctx = {} as any;

function readFileState(): any[] {
  return JSON.parse(fs.readFileSync(AUTOMATIONS_FILE, 'utf8'));
}

beforeEach(() => {
  if (fs.existsSync(AUTOMATIONS_FILE)) fs.unlinkSync(AUTOMATIONS_FILE);
  // Default: no tier gate (Pro) so the functional tests below run unblocked.
  registerAutomationTierProvider(() => 'pro');
});

afterAll(() => {
  fs.rmSync(mockUserDataDir, { recursive: true, force: true });
});

describe('tool definitions', () => {
  test('exposes all five automation tools', () => {
    expect(automationToolDefs.map(d => d.name)).toEqual([
      'create_automation',
      'list_automations',
      'run_automation',
      'update_automation',
      'delete_automation',
    ]);
  });

  test('only delete_automation requires confirmation', () => {
    for (const def of automationToolDefs) {
      expect(!!def.requiresConfirmation).toBe(def.name === 'delete_automation');
    }
  });
});

describe('create_automation', () => {
  test('creates a manual automation and persists it', async () => {
    const res = await createAutomationHandler(
      { name: 'Morning News', instructions: 'Summarise top tech news' },
      ctx
    );
    expect(res.success).toBe(true);
    expect(res.result.created.id).toMatch(/^auto-/);
    expect(res.result.created.trigger).toBe('manual');
    expect(res.result.created.enabled).toBe(true);

    const stored = readFileState();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Morning News');
    expect(stored[0].instructions).toBe('Summarise top tech news');
  });

  test('creates a scheduled automation with default 60-minute interval', async () => {
    const res = await createAutomationHandler(
      { name: 'Hourly Check', instructions: 'Check system health', trigger: 'schedule' },
      ctx
    );
    expect(res.success).toBe(true);
    expect(res.result.created.trigger).toBe('schedule');
    expect(res.result.created.schedule_minutes).toBe(60);
  });

  test('respects explicit schedule_minutes', async () => {
    const res = await createAutomationHandler(
      { name: 'Daily Digest', instructions: 'Morning digest', trigger: 'schedule', schedule_minutes: 1440 },
      ctx
    );
    expect(res.success).toBe(true);
    expect(res.result.created.schedule_minutes).toBe(1440);
  });

  test('rejects missing name or instructions', async () => {
    expect((await createAutomationHandler({ instructions: 'x' }, ctx)).success).toBe(false);
    expect((await createAutomationHandler({ name: 'x' }, ctx)).success).toBe(false);
  });

  test('rejects a duplicate name (case-insensitive)', async () => {
    await createAutomationHandler({ name: 'Backup', instructions: 'zip docs' }, ctx);
    const res = await createAutomationHandler({ name: 'backup', instructions: 'other' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toContain('already exists');
  });

  test('run_now fires the automation via the registered runner', async () => {
    const runner = jest.fn().mockResolvedValue({ success: true, result: 'News summary here' });
    registerAutomationRunner(runner);
    const res = await createAutomationHandler(
      { name: 'Fire Test', instructions: 'do the thing', run_now: true },
      ctx
    );
    expect(res.success).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0].instructions).toBe('do the thing');
    expect(res.result.first_run).toEqual({ status: 'success', output: 'News summary here' });

    // Run status persisted so the Automation Center UI shows it
    const stored = readFileState();
    expect(stored[0].lastStatus).toBe('success');
    expect(stored[0].lastResult).toBe('News summary here');
    expect(stored[0].lastRun).toBeTruthy();
  });
});

describe('Pro gate', () => {
  test('a Free tier blocks create/run/update with an upgrade message; list stays open', async () => {
    registerAutomationTierProvider(() => 'free');
    const create = await createAutomationHandler({ name: 'X', instructions: 'y' }, ctx);
    expect(create.success).toBe(false);
    expect(create.error).toMatch(/Pro/i);

    // Nothing was written.
    expect(fs.existsSync(AUTOMATIONS_FILE)).toBe(false);

    const run = await runAutomationHandler({ automation: 'anything' }, ctx);
    expect(run.success).toBe(false);
    expect(run.error).toMatch(/Pro/i);

    const update = await updateAutomationHandler({ automation: 'anything', enabled: true }, ctx);
    expect(update.success).toBe(false);
    expect(update.error).toMatch(/Pro/i);

    // Listing is not gated.
    const list = await listAutomationsHandler({}, ctx);
    expect(list.success).toBe(true);
  });

  test('a Pro tier allows creation', async () => {
    registerAutomationTierProvider(() => 'pro');
    const res = await createAutomationHandler({ name: 'Pro OK', instructions: 'do it' }, ctx);
    expect(res.success).toBe(true);
  });
});

describe('list_automations', () => {
  test('lists an empty store', async () => {
    const res = await listAutomationsHandler({}, ctx);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(0);
  });

  test('lists created automations with summaries', async () => {
    await createAutomationHandler({ name: 'A', instructions: 'a' }, ctx);
    await createAutomationHandler({ name: 'B', instructions: 'b', trigger: 'schedule', schedule_minutes: 30 }, ctx);
    const res = await listAutomationsHandler({}, ctx);
    expect(res.result.count).toBe(2);
    expect(res.result.automations[1]).toMatchObject({ name: 'B', trigger: 'schedule', schedule_minutes: 30 });
  });
});

describe('run_automation', () => {
  test('fires by exact name, case-insensitively', async () => {
    const runner = jest.fn().mockResolvedValue({ success: true, result: 'ok' });
    registerAutomationRunner(runner);
    await createAutomationHandler({ name: 'Weather Report', instructions: 'get weather' }, ctx);

    const res = await runAutomationHandler({ automation: 'weather report' }, ctx);
    expect(res.success).toBe(true);
    expect(res.result.output).toBe('ok');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  test('fires by id and by unique partial name', async () => {
    const runner = jest.fn().mockResolvedValue({ success: true, result: 'ok' });
    registerAutomationRunner(runner);
    const created = await createAutomationHandler({ name: 'Project Status', instructions: 'git status' }, ctx);

    expect((await runAutomationHandler({ automation: created.result.created.id }, ctx)).success).toBe(true);
    expect((await runAutomationHandler({ automation: 'project' }, ctx)).success).toBe(true);
  });

  test('reports ambiguous partial matches with candidates', async () => {
    registerAutomationRunner(jest.fn().mockResolvedValue({ success: true, result: 'ok' }));
    await createAutomationHandler({ name: 'News AM', instructions: 'x' }, ctx);
    await createAutomationHandler({ name: 'News PM', instructions: 'y' }, ctx);
    const res = await runAutomationHandler({ automation: 'news' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Multiple automations match');
  });

  test('errors clearly when the automation does not exist', async () => {
    const res = await runAutomationHandler({ automation: 'ghost' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });

  test('surfaces runner failure and persists error status', async () => {
    registerAutomationRunner(jest.fn().mockResolvedValue({ success: false, error: 'n8n exploded' }));
    await createAutomationHandler({ name: 'Fragile', instructions: 'x' }, ctx);
    const res = await runAutomationHandler({ automation: 'Fragile' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toBe('n8n exploded');
    expect(readFileState()[0].lastStatus).toBe('error');
  });
});

describe('update_automation', () => {
  test('disables and re-enables an automation', async () => {
    await createAutomationHandler({ name: 'Toggle Me', instructions: 'x' }, ctx);
    const off = await updateAutomationHandler({ automation: 'Toggle Me', enabled: false }, ctx);
    expect(off.success).toBe(true);
    expect(readFileState()[0].enabled).toBe(false);
    await updateAutomationHandler({ automation: 'Toggle Me', enabled: true }, ctx);
    expect(readFileState()[0].enabled).toBe(true);
  });

  test('renames and reschedules', async () => {
    await createAutomationHandler({ name: 'Old Name', instructions: 'x' }, ctx);
    const res = await updateAutomationHandler(
      { automation: 'Old Name', new_name: 'New Name', trigger: 'schedule', schedule_minutes: 15 },
      ctx
    );
    expect(res.success).toBe(true);
    expect(res.result.updated).toMatchObject({ name: 'New Name', trigger: 'schedule', schedule_minutes: 15 });
  });

  test('switching to schedule without an interval defaults to 60 minutes', async () => {
    await createAutomationHandler({ name: 'Sched', instructions: 'x' }, ctx);
    await updateAutomationHandler({ automation: 'Sched', trigger: 'schedule' }, ctx);
    expect(readFileState()[0].scheduleMinutes).toBe(60);
  });

  test('rejects an invalid interval', async () => {
    await createAutomationHandler({ name: 'Bad Interval', instructions: 'x' }, ctx);
    const res = await updateAutomationHandler({ automation: 'Bad Interval', schedule_minutes: 0 }, ctx);
    expect(res.success).toBe(false);
  });
});

describe('delete_automation', () => {
  test('deletes by name and leaves others intact', async () => {
    await createAutomationHandler({ name: 'Keep', instructions: 'x' }, ctx);
    await createAutomationHandler({ name: 'Remove', instructions: 'y' }, ctx);
    const res = await deleteAutomationHandler({ automation: 'Remove' }, ctx);
    expect(res.success).toBe(true);
    expect(res.result.deleted.name).toBe('Remove');
    const stored = readFileState();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Keep');
  });

  test('errors on unknown automation', async () => {
    const res = await deleteAutomationHandler({ automation: 'nope' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });
});

describe('runner not registered', () => {
  test('run_automation explains the engine is unavailable', async () => {
    jest.resetModules();
    // Fresh module instance with no runner registered
    const freshModule = require('../tools/automation');
    fs.writeFileSync(
      AUTOMATIONS_FILE,
      JSON.stringify([{ id: 'auto-1', name: 'Orphan', description: '', instructions: 'x', trigger: 'manual', enabled: true, createdAt: new Date().toISOString() }]),
      'utf8'
    );
    const res = await freshModule.runAutomationHandler({ automation: 'Orphan' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toContain('execution engine is not available');
  });
});
