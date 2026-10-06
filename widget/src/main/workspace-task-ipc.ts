import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { requestConfirmationFrom } from './message-router';
import { getMainWindow } from './window-manager';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { WorkspaceTaskEvent } from '../shared/workspace-task-types';
import {
  executeWorkspacePackageTask,
  listWorkspacePackageTasks,
  prepareWorkspacePackageTask,
  workspaceTaskConfirmationMessage,
} from './workspace-tasks';

export const WORKSPACE_TASK_CHANNELS = {
  LIST: 'homebot:workspace:tasks:list',
  RUN: 'homebot:workspace:tasks:run',
  STOP: 'homebot:workspace:tasks:stop',
  STATUS: 'homebot:workspace:tasks:status',
  EVENT: 'homebot:workspace:tasks:event',
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
  const records = new Map<string, { owner: Electron.WebContents; controller: AbortController; state: WorkspaceTaskEvent }>();
  const key = (owner: number, id: string) => `${owner}:${id}`;
  const push = (record: { owner: Electron.WebContents; state: WorkspaceTaskEvent }) => { try { if (!record.owner.isDestroyed()) record.owner.send(WORKSPACE_TASK_CHANNELS.EVENT, { ...record.state }); } catch { /* window disappeared */ } };
  ipcMain.removeHandler(WORKSPACE_TASK_CHANNELS.LIST);
  ipcMain.removeHandler(WORKSPACE_TASK_CHANNELS.RUN);
  ipcMain.removeHandler(WORKSPACE_TASK_CHANNELS.STOP);
  ipcMain.removeHandler(WORKSPACE_TASK_CHANNELS.STATUS);
  ipcMain.handle(WORKSPACE_TASK_CHANNELS.STOP, (event, args: unknown) => {
    if (!trustedSender(event) || !objectArg(args) || typeof args.taskId !== 'string') return { success: false, error: 'Invalid task Stop request.' };
    const record = records.get(key(event.sender.id, args.taskId));
    if (!record || !record.state.running) return { success: false, error: 'This task has already stopped or belongs to another window.' };
    record.controller.abort('user');
    return { success: true };
  });
  ipcMain.handle(WORKSPACE_TASK_CHANNELS.STATUS, (event, args: unknown) => {
    if (!trustedSender(event) || !objectArg(args) || typeof args.projectDir !== 'string') return { success: false, error: 'Invalid task status request.' };
    const found = [...records.values()].filter(r => r.owner === event.sender && path.resolve(r.state.projectDir) === path.resolve(String(args.projectDir)));
    const running = found.filter(record => record.state.running);
    return { success: true, task: (running[running.length - 1] || found[found.length - 1])?.state || null };
  });

  ipcMain.handle(WORKSPACE_TASK_CHANNELS.LIST, (event, args: unknown) => {
    if (!trustedSender(event)) return { success: false, error: 'Open Tasks in the HomeBot workspace.' };
    if (!objectArg(args) || Object.keys(args).some(key => key !== 'projectDir')) {
      return { success: false, error: 'That task-list request is invalid.' };
    }
    return listWorkspacePackageTasks(args.projectDir);
  });

  ipcMain.handle(WORKSPACE_TASK_CHANNELS.RUN, async (event, args: unknown) => {
    if (!trustedSender(event)) return { success: false, error: 'Open Tasks in the HomeBot workspace.' };
    if (!objectArg(args) || Object.keys(args).some(key => !['projectDir', 'scriptName', 'taskId', 'longRunning'].includes(key)) || (args.longRunning !== undefined && typeof args.longRunning !== 'boolean')) {
      return { success: false, error: 'That task request is invalid.' };
    }
    const taskId = args.taskId === undefined ? randomUUID() : args.taskId;
    if (typeof taskId !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(taskId)) return { success: false, error: 'Invalid task identifier.' };
    if (records.has(key(event.sender.id, taskId))) return { success: false, error: 'This task identifier has already been used.' };
    let snapshot;
    try {
      snapshot = prepareWorkspacePackageTask(args.projectDir, args.scriptName);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    const controller = new AbortController();
    const record = { owner: event.sender, controller, state: { taskId, projectDir: String(args.projectDir), scriptName: String(args.scriptName), running: true, outputExcerpt: '', problems: [] } as WorkspaceTaskEvent };
    records.set(key(event.sender.id, taskId), record);
    let approved = false;
    try { approved = await requestConfirmationFrom(event.sender, workspaceTaskConfirmationMessage(snapshot) + (args.longRunning ? '\n\nThis watch/server task can run until you select Stop.' : '')); }
    catch { record.state.running = false; return { success: false, error: 'Could not request task approval.' }; }
    if (!approved || controller.signal.aborted) { record.state.running = false; push(record); return { success: false, cancelled: true, error: 'Task cancelled by user.' }; }
    // Consent is not authority to run after the originating window/frame has
    // gone away or been replaced while the modal was open.
    if (!trustedSender(event) || event.sender.isDestroyed()) {
      record.state.running = false;
      return { success: false, cancelled: true, error: 'Task cancelled because the HomeBot window closed.' };
    }

    // A renderer that disappears cannot leave a package process tree running.
    const abort = () => controller.abort();
    event.sender.once('destroyed', abort);
    let lastPush = 0;
    try {
      push(record);
      const result = await executeWorkspacePackageTask(snapshot, {
        signal: controller.signal,
        longRunning: args.longRunning === true,
        onProgress: progress => { record.state = { ...record.state, ...progress }; if (Date.now() - lastPush >= 100) { lastPush = Date.now(); push(record); } },
        // Keep the renderer's raw root: the click path must be returned in a
        // form the renderer's lexical HOME sandbox accepts even when the
        // project canonicalises differently (junction/8.3/symlink homes).
        rawProjectDir: typeof args.projectDir === 'string' ? args.projectDir : undefined,
      });
      record.state = { ...record.state, running: false, result, outputExcerpt: result.outputExcerpt || record.state.outputExcerpt, problems: result.problems || record.state.problems };
      push(record);
      return result;
    } finally {
      event.sender.removeListener('destroyed', abort);
      record.state.running = false;
      // Retain recent results for reopening the panel, with bounded history.
      for (const [id, prior] of [...records].slice(0, Math.max(0, records.size - 20))) if (!prior.state.running) records.delete(id);
    }
  });
}
