import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { requestConfirmationFrom } from './message-router';
import { getMainWindow } from './window-manager';
import {
  executeWorkspacePackageTask,
  listWorkspacePackageTasks,
  prepareWorkspacePackageTask,
  workspaceTaskConfirmationMessage,
} from './workspace-tasks';

export const WORKSPACE_TASK_CHANNELS = {
  LIST: 'homebot:workspace:tasks:list',
  RUN: 'homebot:workspace:tasks:run',
} as const;

function trustedSender(event: IpcMainInvokeEvent): boolean {
  const window = getMainWindow();
  return !!window && !window.isDestroyed() && event.sender === window.webContents &&
    !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
}

function objectArg(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function registerWorkspaceTaskIpc(): void {
  ipcMain.removeHandler(WORKSPACE_TASK_CHANNELS.LIST);
  ipcMain.removeHandler(WORKSPACE_TASK_CHANNELS.RUN);

  ipcMain.handle(WORKSPACE_TASK_CHANNELS.LIST, (event, args: unknown) => {
    if (!trustedSender(event)) return { success: false, error: 'Open Tasks in the HomeBot workspace.' };
    if (!objectArg(args) || Object.keys(args).some(key => key !== 'projectDir')) {
      return { success: false, error: 'That task-list request is invalid.' };
    }
    return listWorkspacePackageTasks(args.projectDir);
  });

  ipcMain.handle(WORKSPACE_TASK_CHANNELS.RUN, async (event, args: unknown) => {
    if (!trustedSender(event)) return { success: false, error: 'Open Tasks in the HomeBot workspace.' };
    if (!objectArg(args) || Object.keys(args).some(key => !['projectDir', 'scriptName'].includes(key))) {
      return { success: false, error: 'That task request is invalid.' };
    }
    let snapshot;
    try {
      snapshot = prepareWorkspacePackageTask(args.projectDir, args.scriptName);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    const approved = await requestConfirmationFrom(event.sender, workspaceTaskConfirmationMessage(snapshot));
    if (!approved) return { success: false, cancelled: true, error: 'Task cancelled by user.' };
    // Consent is not authority to run after the originating window/frame has
    // gone away or been replaced while the modal was open.
    if (!trustedSender(event) || event.sender.isDestroyed()) {
      return { success: false, cancelled: true, error: 'Task cancelled because the HomeBot window closed.' };
    }

    // A renderer that disappears cannot leave a package process tree running.
    const controller = new AbortController();
    const abort = () => controller.abort();
    event.sender.once('destroyed', abort);
    try {
      return await executeWorkspacePackageTask(snapshot, { signal: controller.signal });
    } finally {
      event.sender.removeListener('destroyed', abort);
    }
  });
}
