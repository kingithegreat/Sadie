import { app, ipcMain } from 'electron';
import { getMainWindow } from '../window-manager';
import { handleLspRequest, disposeLanguageServers } from './lsp-manager';
import type { LspRequest } from '../../shared/workspace-lsp-types';
export const WORKSPACE_LSP_CHANNEL = 'homebot:workspace:lsp';
let quitHooked = false;
export function registerWorkspaceLspIpc(): void {
  if (!quitHooked) { quitHooked = true; app.on('will-quit', disposeLanguageServers); }
  ipcMain.removeHandler(WORKSPACE_LSP_CHANNEL);
  ipcMain.handle(WORKSPACE_LSP_CHANNEL, (event, request: LspRequest) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) return { success: false, error: 'Open a file in the HomeBot workspace first.' };
    return handleLspRequest(request);
  });
}
