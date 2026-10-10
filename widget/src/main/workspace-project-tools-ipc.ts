import { ipcMain } from 'electron';
import { getMainWindow } from './window-manager';
import { handleProjectToolsRequest, disposeProjectToolWorkers } from './workspace-project-tools';
import type { ProjectToolsRequest } from '../shared/workspace-project-tools-types';
export const WORKSPACE_PROJECT_TOOLS_CHANNEL = 'homebot:workspace:project-tools';
export function registerWorkspaceProjectToolsIpc(): void {
  ipcMain.removeHandler(WORKSPACE_PROJECT_TOOLS_CHANNEL);
  ipcMain.handle(WORKSPACE_PROJECT_TOOLS_CHANNEL, (event, request: ProjectToolsRequest) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) return { success: false, error: 'Open a file in the HomeBot workspace first.' };
    return handleProjectToolsRequest(request);
  });
}
export { disposeProjectToolWorkers };
