import { ipcMain } from 'electron';
import { getMainWindow } from '../window-manager';
import { requestConfirmationFrom } from '../message-router';
import { performWorkspaceDebug } from '../workspace-debug';
import { registerWorkspaceDebugIpc, WORKSPACE_DEBUG_CHANNEL } from '../workspace-debug-ipc';

jest.mock('electron', () => ({ ipcMain: { removeHandler: jest.fn(), handle: jest.fn() } }));
jest.mock('../window-manager', () => ({ getMainWindow: jest.fn() }));
jest.mock('../message-router', () => ({ requestConfirmationFrom: jest.fn().mockResolvedValue(true) }));
jest.mock('../workspace-debug', () => ({ performWorkspaceDebug: jest.fn().mockResolvedValue({ success: true }), stopWorkspaceDebuggers: jest.fn().mockResolvedValue(undefined) }));

test('consent keeps sender/main-frame ownership in a main-only startup callback', async () => {
  let destroyed = false;
  const sender = { mainFrame: {}, once: jest.fn() };
  const window = { isDestroyed: () => destroyed, webContents: sender };
  (getMainWindow as jest.Mock).mockReturnValue(window);
  registerWorkspaceDebugIpc();
  const handler = (ipcMain.handle as jest.Mock).mock.calls.find(([channel]) => channel === WORKSPACE_DEBUG_CHANNEL)![1];
  const request = { root: 'C:/private/project', action: 'start', file: 'C:/private/project/main.js' };
  expect(await handler({ sender, senderFrame: sender.mainFrame }, request)).toEqual({ success: true });
  expect(requestConfirmationFrom).toHaveBeenCalledTimes(1);
  const callback = (performWorkspaceDebug as jest.Mock).mock.calls[0][1];
  expect(callback).toBeInstanceOf(Function); expect(() => callback()).not.toThrow();
  destroyed = true; expect(() => callback()).toThrow(/window closed/);
  destroyed = false;
  (getMainWindow as jest.Mock).mockReturnValue({ isDestroyed: () => false, webContents: sender });
  expect(() => callback()).toThrow(/window closed/);
  (getMainWindow as jest.Mock).mockReturnValue(window);
  expect((await handler({ sender, senderFrame: {} }, request)).success).toBe(false);
  expect(performWorkspaceDebug).toHaveBeenCalledTimes(1);
});
