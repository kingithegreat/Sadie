import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { getMainWindow } from './window-manager';
import { workspacePtySessions, workspaceTerminalProfiles } from './workspace-terminal-pty';
import type { WorkspaceTerminalCreateRequest, WorkspaceTerminalEvent } from '../shared/workspace-terminal-types';
export const WORKSPACE_TERMINAL_CHANNELS = {
  PROFILES: 'homebot:workspace:terminal:profiles', LIST: 'homebot:workspace:terminal:list', CREATE: 'homebot:workspace:terminal:create',
  WRITE: 'homebot:workspace:terminal:write', RESIZE: 'homebot:workspace:terminal:resize',
  INTERRUPT: 'homebot:workspace:terminal:interrupt', CLOSE: 'homebot:workspace:terminal:close',
  EVENT: 'homebot:workspace:terminal:event',
} as const;
function trusted(event: IpcMainInvokeEvent): boolean {
  const window = getMainWindow();
  return !!window && !window.isDestroyed() && event.sender === window.webContents && !event.sender.isDestroyed() && !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
}
export function registerWorkspaceTerminalIpc(): void {
  const owners = new WeakSet<Electron.WebContents>();
  const protect = (run: (event: IpcMainInvokeEvent, args: any) => unknown) => async (event: IpcMainInvokeEvent, args: unknown) => {
    if (!trusted(event)) return { success: false, error: 'Open the HomeBot workspace to use a terminal.' };
    try { return { success: true, ...(await run(event, args) as object || {}) }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  };
  for (const channel of Object.values(WORKSPACE_TERMINAL_CHANNELS)) if (channel !== WORKSPACE_TERMINAL_CHANNELS.EVENT) ipcMain.removeHandler(channel);
  ipcMain.handle(WORKSPACE_TERMINAL_CHANNELS.PROFILES, protect(() => ({ profiles: workspaceTerminalProfiles() })));
  ipcMain.handle(WORKSPACE_TERMINAL_CHANNELS.LIST, protect(async (event, args) => {
    if (!args || typeof args.projectDir !== 'string' || Object.keys(args).some(key => key !== 'projectDir')) throw new Error('Invalid terminal recovery request.');
    return { sessions: await workspacePtySessions.list(event.sender.id, args.projectDir) };
  }));
  ipcMain.handle(WORKSPACE_TERMINAL_CHANNELS.CREATE, protect(async (event, args: WorkspaceTerminalCreateRequest) => {
    if (!args || typeof args.projectDir !== 'string' || Object.keys(args).some(k => !['projectDir', 'profileId', 'cols', 'rows'].includes(k))) throw new Error('Invalid terminal request.');
    if (!owners.has(event.sender)) { owners.add(event.sender); event.sender.once('destroyed', () => { void workspacePtySessions.closeOwner(event.sender.id).catch(error => { console.error('[HomeBot-CATCH]', error); }); }); }
    const notify = (value: WorkspaceTerminalEvent) => { try { if (!event.sender.isDestroyed()) event.sender.send(WORKSPACE_TERMINAL_CHANNELS.EVENT, value); } catch { /* window disappeared */ } };
    return { session: await workspacePtySessions.create(event.sender.id, args, notify) };
  }));
  ipcMain.handle(WORKSPACE_TERMINAL_CHANNELS.WRITE, protect((e, a) => workspacePtySessions.write(e.sender.id, a?.sessionId, a?.data)));
  ipcMain.handle(WORKSPACE_TERMINAL_CHANNELS.RESIZE, protect((e, a) => workspacePtySessions.resize(e.sender.id, a?.sessionId, a?.cols, a?.rows)));
  ipcMain.handle(WORKSPACE_TERMINAL_CHANNELS.INTERRUPT, protect((e, a) => workspacePtySessions.interrupt(e.sender.id, a?.sessionId)));
  ipcMain.handle(WORKSPACE_TERMINAL_CHANNELS.CLOSE, protect((e, a) => workspacePtySessions.close(e.sender.id, a?.sessionId)));
}
