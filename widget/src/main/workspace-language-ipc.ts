import { ipcMain } from 'electron';
import { getMainWindow } from './window-manager';
import { queryWorkspaceLanguage } from './workspace-language';
import type { WorkspaceLanguageRequest } from '../shared/workspace-language-types';
export const WORKSPACE_LANGUAGE_CHANNEL = 'homebot:workspace:language';
export function registerWorkspaceLanguageIpc(): void {
  ipcMain.removeHandler(WORKSPACE_LANGUAGE_CHANNEL);
  ipcMain.handle(WORKSPACE_LANGUAGE_CHANNEL, (event, args: WorkspaceLanguageRequest) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) return { success: false, error: 'Open a file in the HomeBot workspace first.' };
    return queryWorkspaceLanguage(args);
  });
}
