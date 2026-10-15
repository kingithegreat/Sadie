import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-auto-edit-'));
const file = path.join(userData, 'automations.json');
const handlers: Record<string, Function> = {};

jest.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Function) => { handlers[channel] = fn; }, on: jest.fn() },
  BrowserWindow: Object.assign(jest.fn(), { getAllWindows: () => [] }),
  app: { isPackaged: false, getPath: () => userData, getAppPath: () => userData },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
}));

jest.mock('../n8n-api', () => ({
  createAndActivateWorkflow: jest.fn(),
  deleteWorkflow: jest.fn(),
  ensureWebFetchWorkflow: jest.fn(),
  registerN8nConnectionProvider: jest.fn(),
  verifyN8nConnection: jest.fn(),
}));
jest.mock('../licensing', () => ({
  ...jest.requireActual('../licensing'),
  getCurrentTier: () => 'pro',
}));

import { registerIpcHandlers } from '../ipc-handlers';
import { updateAutomationHandler, registerAutomationTierProvider } from '../tools/automation';
import * as n8nApi from '../n8n-api';

const deployed = {
  id: 'auto-1', name: 'Morning News', description: 'local task', instructions: 'Summarise news',
  trigger: 'manual', enabled: true, createdAt: '2026-01-01T00:00:00Z',
  n8nWorkflowId: 'wf-1', n8nWebhookUrl: 'http://localhost:5678/webhook/auto-1',
};

beforeAll(() => {
  (global as any).__homebot_ipc_registered = false;
  registerIpcHandlers();
  registerAutomationTierProvider(() => 'pro');
});

beforeEach(() => {
  jest.clearAllMocks();
  fs.writeFileSync(file, JSON.stringify([deployed]), 'utf8');
});

afterAll(() => fs.rmSync(userData, { recursive: true, force: true }));

const saved = () => JSON.parse(fs.readFileSync(file, 'utf8'))[0];
const uiUpdate = (data: any) => handlers['homebot:update-automation'](null, data);

test('UI edit rejects changed name and instructions on a deployed workflow without changing local data', async () => {
  const before = fs.readFileSync(file, 'utf8');
  const result = await uiUpdate({ id: deployed.id, name: 'Evening News', instructions: 'Ignore news' });
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/n8n/i);
  expect(fs.readFileSync(file, 'utf8')).toBe(before);
  expect(n8nApi.createAndActivateWorkflow).not.toHaveBeenCalled();
  expect(n8nApi.deleteWorkflow).not.toHaveBeenCalled();
});

test('chat edit rejects changed instructions on a deployed workflow without changing local data', async () => {
  const before = fs.readFileSync(file, 'utf8');
  const result = await updateAutomationHandler({ automation: deployed.id, instructions: 'Ignore news' }, {} as any);
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/n8n/i);
  expect(fs.readFileSync(file, 'utf8')).toBe(before);
  expect(n8nApi.createAndActivateWorkflow).not.toHaveBeenCalled();
  expect(n8nApi.deleteWorkflow).not.toHaveBeenCalled();
});

test('UI edit cannot clear the URL while an app-managed n8n workflow is still live', async () => {
  const before = fs.readFileSync(file, 'utf8');
  const result = await uiUpdate({ id: deployed.id, n8nWebhookUrl: '' });
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/n8n/i);
  expect(fs.readFileSync(file, 'utf8')).toBe(before);
});

test('legacy URL-only links also reject silent chat prompt changes', async () => {
  fs.writeFileSync(file, JSON.stringify([{ ...deployed, n8nWorkflowId: undefined }]), 'utf8');
  const before = fs.readFileSync(file, 'utf8');
  const result = await updateAutomationHandler({ automation: deployed.id, new_name: 'Evening News' }, {} as any);
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/disconnect.*webhook/i);
  expect(fs.readFileSync(file, 'utf8')).toBe(before);
});

test('an unchanged prompt sent by the UI stays editable', async () => {
  const result = await uiUpdate({ id: deployed.id, name: deployed.name, instructions: deployed.instructions, description: 'updated' });
  expect(result.success).toBe(true);
  expect(saved()).toMatchObject({ description: 'updated', n8nWorkflowId: 'wf-1' });
});

test('non-prompt settings on a deployed workflow and local-only prompt edits still save', async () => {
  const toggle = await uiUpdate({ id: deployed.id, enabled: false, description: 'new description' });
  expect(toggle.success).toBe(true);
  expect(saved()).toMatchObject({ enabled: false, description: 'new description', instructions: deployed.instructions });

  fs.writeFileSync(file, JSON.stringify([{ ...deployed, n8nWorkflowId: undefined, n8nWebhookUrl: undefined }]), 'utf8');
  const local = await updateAutomationHandler({ automation: deployed.id, new_name: 'Local News', instructions: 'New summary' }, {} as any);
  expect(local.success).toBe(true);
  expect(saved()).toMatchObject({ name: 'Local News', instructions: 'New summary' });
});
