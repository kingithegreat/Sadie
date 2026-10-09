import { ipcMain } from 'electron';
import { getMainWindow } from './window-manager';
import { requestConfirmationFrom } from './message-router';
import { performWorkspaceDebug, stopWorkspaceDebuggers } from './workspace-debug';
import type { WorkspaceDebugRequest } from '../shared/workspace-debug-types';
export const WORKSPACE_DEBUG_CHANNEL = 'homebot:workspace:debug';
export function registerWorkspaceDebugIpc(): void {
  ipcMain.removeHandler(WORKSPACE_DEBUG_CHANNEL);
  ipcMain.handle(WORKSPACE_DEBUG_CHANNEL, async (event, request: WorkspaceDebugRequest) => {
    const window = getMainWindow();
    const trusted = () => !!window && getMainWindow() === window && !window.isDestroyed() && event.sender === window.webContents && !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
    if (!trusted()) return { success: false, error: 'Open Debug in the HomeBot workspace.' };
    if (!request || typeof request.action !== 'string') return { success: false, error: 'Invalid debugger request.' };
    if (request.action === 'start') {
      if (!await requestConfirmationFrom(event.sender, `Run ${request.file || 'this program'} with the debugger? Project code can read files, access the network and start processes with your account.`)) return { success: false, error: 'Debug launch cancelled.' };
      if (!trusted()) return { success: false, error: 'Debug launch cancelled because the window closed.' };
      event.sender.once('destroyed', () => { void stopWorkspaceDebuggers(); });
    }
    return performWorkspaceDebug(request, () => {
      if (!trusted()) throw new Error('Debug launch cancelled because the window closed.');
    });
  });
}
