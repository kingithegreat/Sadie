import { ipcMain } from 'electron';
import { getMainWindow } from './window-manager';
import { requestConfirmationFrom } from './message-router';
import { gitWorkspaceConfirmation, performWorkspaceGitAction } from './workspace-git-actions';
import type { WorkspaceGitActionRequest } from '../shared/workspace-git-action-types';
export const WORKSPACE_GIT_ACTION_CHANNEL = 'homebot:workspace:git-action';
export function registerWorkspaceGitActionIpc(): void {
  ipcMain.removeHandler(WORKSPACE_GIT_ACTION_CHANNEL);
  ipcMain.handle(WORKSPACE_GIT_ACTION_CHANNEL, async (event, args: WorkspaceGitActionRequest) => {
    const window = getMainWindow();
    const trusted = () => !!window && !window.isDestroyed() && event.sender === window.webContents && !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
    if (!trusted()) return { success: false, error: 'Open Source control in the HomeBot workspace first.' };
    if (!args || typeof args.action !== 'string') return { success: false, error: 'That Git request is invalid.' };
    const confirmation = gitWorkspaceConfirmation(args);
    if (confirmation && !await requestConfirmationFrom(event.sender, confirmation)) return { success: false, error: 'Git action cancelled.' };
    if (!trusted()) return { success: false, error: 'Git action cancelled because the window closed.' };
    return performWorkspaceGitAction(args);
  });
}
