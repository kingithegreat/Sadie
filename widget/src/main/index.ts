import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { createMainWindow } from './window-manager';
import { registerIpcHandlers } from './ipc-handlers';

// Load environment variables
require('dotenv').config();

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

  mainWindow = createMainWindow();

  // Register message router for SADIE backend communication
  const { registerMessageRouter } = require('./message-router');
  const n8nUrl = process.env.N8N_URL || require('../shared/constants').DEFAULT_N8N_URL;
  if (mainWindow) registerMessageRouter(mainWindow, n8nUrl);

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
