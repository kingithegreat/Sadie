const handlers = new Map<string, Function>();
const removeHandler = jest.fn((name: string) => handlers.delete(name));
const handle = jest.fn((name: string, fn: Function) => handlers.set(name, fn));
let senderDestroyed = false;
let windowDestroyed = false;
const sender = { once: jest.fn(), removeListener: jest.fn(), isDestroyed: () => senderDestroyed };
const mainFrame = {};
const webContents = { ...sender, mainFrame };
const requestConfirmationFrom = jest.fn();
const prepareWorkspacePackageTask = jest.fn();
const executeWorkspacePackageTask = jest.fn();
const listWorkspacePackageTasks = jest.fn();

jest.mock('electron', () => ({ ipcMain: { handle, removeHandler } }));
jest.mock('../window-manager', () => ({ getMainWindow: () => ({ isDestroyed: () => windowDestroyed, webContents }) }));
jest.mock('../message-router', () => ({ requestConfirmationFrom }));
jest.mock('../workspace-tasks', () => ({
  prepareWorkspacePackageTask,
  executeWorkspacePackageTask,
  listWorkspacePackageTasks,
  workspaceTaskConfirmationMessage: () => 'exact commands',
}));

import { registerWorkspaceTaskIpc, WORKSPACE_TASK_CHANNELS } from '../workspace-task-ipc';

const event = () => ({ sender: (require('../window-manager') as any).getMainWindow().webContents, senderFrame: mainFrame });

beforeEach(() => {
  jest.clearAllMocks();
  senderDestroyed = false;
  windowDestroyed = false;
  handlers.clear();
  registerWorkspaceTaskIpc();
});

test('refuses foreign senders and extra renderer-controlled fields', async () => {
  const list = handlers.get(WORKSPACE_TASK_CHANNELS.LIST)!;
  const run = handlers.get(WORKSPACE_TASK_CHANNELS.RUN)!;
  expect(await list({ sender: {}, senderFrame: {} }, { projectDir: 'x' })).toMatchObject({ success: false });
  expect(await run(event(), { projectDir: 'x', scriptName: 'check', command: 'evil' })).toMatchObject({ success: false });
  expect(prepareWorkspacePackageTask).not.toHaveBeenCalled();
});

test('main resolves commands, requires confirmation, and runs only approved snapshot', async () => {
  const snapshot = { projectDir: 'x', scriptName: 'check', lifecycle: [{ name: 'check', command: 'tsc' }] };
  prepareWorkspacePackageTask.mockReturnValue(snapshot);
  requestConfirmationFrom.mockResolvedValue(true);
  executeWorkspacePackageTask.mockResolvedValue({ success: true, problems: [] });
  const result = await handlers.get(WORKSPACE_TASK_CHANNELS.RUN)!(event(), { projectDir: 'x', scriptName: 'check' });
  expect(requestConfirmationFrom).toHaveBeenCalledWith(expect.anything(), 'exact commands');
  expect(executeWorkspacePackageTask).toHaveBeenCalledWith(snapshot, expect.objectContaining({ signal: expect.anything() }));
  expect(result).toEqual({ success: true, problems: [] });
});

test('declined consent never executes', async () => {
  prepareWorkspacePackageTask.mockReturnValue({ projectDir: 'x', scriptName: 'check', lifecycle: [] });
  requestConfirmationFrom.mockResolvedValue(false);
  await expect(handlers.get(WORKSPACE_TASK_CHANNELS.RUN)!(event(), { projectDir: 'x', scriptName: 'check' })).resolves.toMatchObject({ success: false, cancelled: true });
  expect(executeWorkspacePackageTask).not.toHaveBeenCalled();
});

test('approval resolving after the sender is destroyed cannot spawn', async () => {
  prepareWorkspacePackageTask.mockReturnValue({ projectDir: 'x', scriptName: 'check', lifecycle: [] });
  requestConfirmationFrom.mockImplementation(async () => {
    senderDestroyed = true;
    return true;
  });
  await expect(handlers.get(WORKSPACE_TASK_CHANNELS.RUN)!(event(), { projectDir: 'x', scriptName: 'check' })).resolves.toMatchObject({ success: false, cancelled: true });
  expect(executeWorkspacePackageTask).not.toHaveBeenCalled();
});
