import { ipcMain } from 'electron';
import { getMainWindow } from './window-manager';
import { requestConfirmationFrom } from './message-router';
import { performWorkspaceTests, prepareWorkspaceTestCommand, stopWorkspaceTestRuns } from './workspace-tests';
import type { WorkspaceTestRequest } from '../shared/workspace-test-types';
export const WORKSPACE_TEST_CHANNEL = 'homebot:workspace:tests';
export function registerWorkspaceTestIpc(): void {
  ipcMain.removeHandler(WORKSPACE_TEST_CHANNEL);
  ipcMain.handle(WORKSPACE_TEST_CHANNEL, async (event, request: WorkspaceTestRequest) => {
    const window = getMainWindow(); const trusted = () => !!window && !window.isDestroyed() && event.sender === window.webContents && !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
    if (!trusted()) return { success: false, error: 'Open Tests in the HomeBot workspace.' };
    try {
      if (request.action === 'run') {
        const prepared = prepareWorkspaceTestCommand(request);
        if (!await requestConfirmationFrom(event.sender, `Run ${request.testName || 'all tests in'} ${request.file}? Project tests can access files, the network and processes. Working folder: ${prepared.cwd}`)) return { success: false, error: 'Test run cancelled.' };
        if (!trusted()) return { success: false, error: 'Test run cancelled because the window closed.' };
        event.sender.once('destroyed', () => { void stopWorkspaceTestRuns(); });
      }
      return performWorkspaceTests(request);
    } catch (error) { return { success: false, error: String(error) }; }
  });
}
