import { ipcMain } from 'electron';
import { getMainWindow } from '../window-manager';
import { requestConfirmationFrom } from '../message-router';
import { performWorkspaceTests } from '../workspace-tests';
import { registerWorkspaceTestIpc, WORKSPACE_TEST_CHANNEL } from '../workspace-test-ipc';
jest.mock('electron', () => ({ ipcMain: { handle: jest.fn(), removeHandler: jest.fn() } }));
jest.mock('../window-manager', () => ({ getMainWindow: jest.fn() }));
jest.mock('../message-router', () => ({ requestConfirmationFrom: jest.fn(async () => true) }));
jest.mock('../workspace-tests', () => ({ prepareWorkspaceTestCommand: jest.fn(() => ({ cwd: '/project' })), performWorkspaceTests: jest.fn(), stopWorkspaceTestRuns: jest.fn(async () => {}) }));

test.each(['window', 'frame', 'sender'])('the final test execution fence rejects a changed %s after consent', async changed => {
  const mainFrame = {}, sender = { mainFrame, isDestroyed: jest.fn(() => false), once: jest.fn() };
  const window = { webContents: sender, isDestroyed: jest.fn(() => false) };
  (getMainWindow as jest.Mock).mockReturnValue(window);
  (requestConfirmationFrom as jest.Mock).mockResolvedValue(true);
  const event = { sender, senderFrame: mainFrame };
  let finish!: () => void;
  (performWorkspaceTests as jest.Mock).mockImplementationOnce(async (_request, assertCurrent) => {
    await new Promise<void>(resolve => { finish = resolve; });
    assertCurrent(); return { success: true };
  });
  registerWorkspaceTestIpc();
  const handler = (ipcMain.handle as jest.Mock).mock.calls.find(call => call[0] === WORKSPACE_TEST_CHANNEL)![1];
  const result = handler(event, { root: '/project', action: 'run', file: '/project/test.js' });
  for (let index = 0; index < 10 && !finish; index++) await Promise.resolve();
  expect(finish).toBeDefined();
  if (changed === 'window') (getMainWindow as jest.Mock).mockReturnValue({ ...window });
  else if (changed === 'frame') event.senderFrame = {};
  else sender.isDestroyed.mockReturnValue(true);
  finish();
  expect(await result).toMatchObject({ success: false, error: expect.stringContaining('window changed') });
});
