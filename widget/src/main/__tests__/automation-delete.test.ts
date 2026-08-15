/**
 * Deleting an automation must take its n8n workflow with it.
 *
 * The handler used to filter the array and write the file. Any workflow the
 * automation had deployed stayed live in n8n, firing on its own trigger, with
 * nothing in HomeBot pointing at it — findable only by opening n8n. The id it
 * needed was already stored on the record, and `deleteWorkflow` already existed
 * in n8n-api with no caller anywhere in the repo.
 *
 * The case worth pinning down is the failure: when n8n cannot be reached, the
 * automation is KEPT. Removing the HomeBot side while the workflow survives is
 * precisely what creates the orphan, so a half-delete is worse than no delete.
 * `force` exists for the user who wants the row gone regardless, and says so.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-autodel-'));
const AUTOMATIONS = path.join(userData, 'automations.json');

const handlers: Record<string, Function> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Function) => { handlers[channel] = fn; },
    on: jest.fn(),
  },
  BrowserWindow: Object.assign(jest.fn(), { getAllWindows: () => [] }),
  app: { isPackaged: false, getPath: () => userData, getAppPath: () => userData },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
}));

const deleteWorkflow = jest.fn();
jest.mock('../n8n-api', () => ({
  deleteWorkflow: (...args: any[]) => deleteWorkflow(...args),
  createAndActivateWorkflow: jest.fn(),
  ensureWebFetchWorkflow: jest.fn(),
  registerN8nConnectionProvider: jest.fn(),
  verifyN8nConnection: jest.fn(),
}));

import { registerIpcHandlers } from '../ipc-handlers';

const readFile = () => JSON.parse(fs.readFileSync(AUTOMATIONS, 'utf8'));

function seed(automations: any[]) {
  fs.writeFileSync(AUTOMATIONS, JSON.stringify(automations, null, 2), 'utf8');
}

const withWorkflow = {
  id: 'auto-1',
  name: 'Morning News',
  instructions: 'summarise the news',
  trigger: 'manual',
  enabled: true,
  n8nWorkflowId: 'wf-123',
  n8nWebhookUrl: 'http://localhost:5678/webhook/x',
};

const localOnly = {
  id: 'auto-2',
  name: 'Tidy Downloads',
  instructions: 'tidy up',
  trigger: 'manual',
  enabled: true,
};

describe('deleting an automation', () => {
  beforeAll(() => {
    (global as any).__homebot_ipc_registered = false;
    registerIpcHandlers();
  });

  beforeEach(() => {
    deleteWorkflow.mockReset();
    seed([withWorkflow, localOnly]);
  });

  const del = (data: any) => handlers['homebot:delete-automation'](null, data);

  it('removes the n8n workflow the automation deployed', async () => {
    deleteWorkflow.mockResolvedValue(undefined);

    const res = await del({ id: 'auto-1' });

    expect(res.success).toBe(true);
    expect(deleteWorkflow).toHaveBeenCalledWith('wf-123');
    expect(readFile().map((a: any) => a.id)).toEqual(['auto-2']);
  });

  it('does not call n8n for an automation that never deployed one', async () => {
    const res = await del({ id: 'auto-2' });

    expect(res.success).toBe(true);
    expect(deleteWorkflow).not.toHaveBeenCalled();
    expect(readFile().map((a: any) => a.id)).toEqual(['auto-1']);
  });

  it('KEEPS the automation when the workflow cannot be removed', async () => {
    deleteWorkflow.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await del({ id: 'auto-1' });

    expect(res.success).toBe(false);
    // The whole point: the record survives, so the workflow is still reachable.
    expect(readFile().map((a: any) => a.id)).toEqual(['auto-1', 'auto-2']);
    expect(res.error).toContain('wf-123');
    expect(res.error).toContain('connect ECONNREFUSED');
  });

  it('force deletes the record and reports the workflow it left behind', async () => {
    deleteWorkflow.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await del({ id: 'auto-1', force: true });

    expect(res.success).toBe(true);
    expect(readFile().map((a: any) => a.id)).toEqual(['auto-2']);
    // A forced delete must not be silent about what it stranded.
    expect(res.warning).toContain('wf-123');
    expect(res.warning).toContain('still in n8n');
  });

  it('reports a missing automation rather than claiming success', async () => {
    const res = await del({ id: 'does-not-exist' });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(readFile()).toHaveLength(2);
  });
});
