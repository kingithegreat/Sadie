import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { createMainWindow } from './window-manager';
import { registerIpcHandlers } from './ipc-handlers';

// Load environment variables
require('dotenv').config();

// Hard-lock production environment for packaged builds (portable safe)
if (process.env.NODE_ENV === undefined || process.env.NODE_ENV === null) {
  process.env.NODE_ENV = app.isPackaged ? 'production' : 'development';
}
// Always set SADIE_ENV to desktop (locked)
process.env.SADIE_ENV = 'desktop';

// Initialize logging early
import { initLogging, logStartup, logError } from './utils/logger';
initLogging();
logStartup(`Starting SADIE, NODE_ENV=${process.env.NODE_ENV}, SADIE_ENV=${process.env.SADIE_ENV}`);

// Enable Chrome flags for Web Speech API
app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI');

// Enable hot reload in development
if (process.env.NODE_ENV !== 'production') {
  try {
    require('electron-reload')(path.join(__dirname, '..'), {
      electron: path.join(__dirname, '..', '..', 'node_modules', 'electron')
    });
  } catch (err) {
    console.log('Electron-reload not available');
  }
}

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Register IPC handlers BEFORE window creation to satisfy early renderer invokes
  registerIpcHandlers();

  logStartup('Registered IPC handlers.');

  mainWindow = createMainWindow();

  // Register message router for SADIE backend communication
  const { registerMessageRouter, setUncensoredMode, getUncensoredMode } = require('./message-router');
  const n8nUrl = process.env.N8N_URL || require('../shared/constants').DEFAULT_N8N_URL;
  if (mainWindow) registerMessageRouter(mainWindow, n8nUrl);
  
  // IPC handler for uncensored mode toggle
  const { ipcMain } = require('electron');
  ipcMain.handle('sadie:set-uncensored-mode', (_event: any, enabled: boolean) => {
    setUncensoredMode(enabled);
    return { success: true, enabled };
  });
  ipcMain.handle('sadie:get-uncensored-mode', () => {
    return { enabled: getUncensoredMode() };
  });
  
  // Restart app handler - relaunch from the correct directory
  ipcMain.handle('sadie:restart-app', () => {
    const execPath = process.execPath;
    const appPath = app.getAppPath();
    app.relaunch({ 
      execPath: execPath,
      args: [appPath]
    });
    app.exit(0);
  });

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle cleanup
app.on('before-quit', () => {
  mainWindow = null;
});

// Global error handlers to write to startup log
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  logError(err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  logError(reason);
});
