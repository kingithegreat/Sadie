// Main process for SADIE - Full implementation
import { app, BrowserWindow, ipcMain } from 'electron';
import { createMainWindow } from './window-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { registerMessageRouter } from './message-router';
import { initializeTools } from './tools';
import { getSettings } from './config-manager';

let mainWindow: BrowserWindow | null = null;

// Diagnostic log buffer for main process
(global as any).__SADIE_MAIN_LOG_BUFFER ??= [];

app.whenReady().then(async () => {
  console.log('[MAIN] App ready, initializing...');
  (global as any).__SADIE_MAIN_LOG_BUFFER.push('[MAIN] App ready');

  // Initialize tools before window creation
  try {
    await initializeTools();
    console.log('[MAIN] Tools initialized');
    (global as any).__SADIE_MAIN_LOG_BUFFER.push('[MAIN] Tools initialized');
  } catch (e) {
    console.error('[MAIN] Tool initialization error:', e);
  }

  // Register IPC handlers BEFORE creating window
  registerIpcHandlers();
  
  // Create the main window first
  mainWindow = createMainWindow();
  
  // Register message router with proper parameters
  const settings = getSettings();
  registerMessageRouter(mainWindow, settings.n8nUrl || 'http://localhost:5678');
  
  console.log('[MAIN] IPC handlers registered');
  (global as any).__SADIE_MAIN_LOG_BUFFER.push('[MAIN] IPC handlers registered');

  ipcMain.on('ping', () => console.log('pong'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
