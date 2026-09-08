import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { getMainWindow } from '../window-manager';
import { bundledModuleController, initializeBundledModules, onBundledModulesChanged } from './bundled';

function isModuleControlSender(event: IpcMainInvokeEvent): boolean {
  const window = getMainWindow();
  return !!window && !window.isDestroyed() && event?.sender === window.webContents &&
    !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
}

const invalidSender = () => ({ ok: false, code: 'INVALID_SENDER', error: 'Open Modules in the HomeBot window.' });
let stopObserving: (() => void) | undefined;

export function registerModuleControlIpc(): void {
  initializeBundledModules();
  // Window ownership stays at the IPC boundary; importing the tool registry
  // must not initialize Electron's window-management runtime.
  stopObserving?.();
  stopObserving = onBundledModulesChanged(() => {
    try { getMainWindow()?.webContents.send('homebot:modules:changed'); } catch { /* Window closing. */ }
  });
  ipcMain.handle('homebot:modules:list', (event, ...args) => {
    if (!isModuleControlSender(event)) return invalidSender();
    if (args.length) return { ok: false, code: 'INVALID_ARGUMENT', error: 'That module request is invalid.' };
    return bundledModuleController.list();
  });
  ipcMain.handle('homebot:modules:set-enabled', (event, ...args) => {
    if (!isModuleControlSender(event)) return invalidSender();
    if (args.length !== 2 || typeof args[0] !== 'string' || typeof args[1] !== 'boolean') {
      return { ok: false, code: 'INVALID_ARGUMENT', error: 'Choose a module and whether to enable it.' };
    }
    return bundledModuleController.setEnabled(args[0], args[1]);
  });
}
