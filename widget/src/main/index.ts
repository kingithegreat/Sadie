// Main process for SADIE - Full implementation
import { app, BrowserWindow, ipcMain } from 'electron';
import { createMainWindow } from './window-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { registerMessageRouter } from './message-router';
import { initializeTools } from './tools';
import { getSettings } from './config-manager';
import { isE2E } from './env';

let mainWindow: BrowserWindow | null = null;

// Diagnostic log buffer for main process
(global as any).__SADIE_MAIN_LOG_BUFFER ??= [];

// Apply a safe, idempotent ipcMain.handle patch (keeps behavior local and
// testable via `applyIpcHandlePatch`). See `src/main/utils/ipc-handle-patch.ts`.
import { applyIpcHandlePatch } from './utils/ipc-handle-patch';
applyIpcHandlePatch();


app.whenReady().then(async () => {
  console.log('[MAIN] App ready, initializing...');
  console.log('[MAIN] Env check: SADIE_DIRECT_OLLAMA=', process.env.SADIE_DIRECT_OLLAMA, 'isE2E=', isE2E);
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
  // Allow E2E or env-based override for the n8n URL so tests can route to a
  // mock upstream without changing user settings on disk. Prefer explicit
  // process.env.N8N_URL when present (test runner sets this), then saved
  // settings, then fallback to localhost default.
  const resolvedN8nUrl = process.env.N8N_URL || settings.n8nUrl || 'http://localhost:5678';
  if (process.env.NODE_ENV !== 'production') console.log('[MAIN] Resolved n8nUrl =', resolvedN8nUrl);
  registerMessageRouter(mainWindow, resolvedN8nUrl);
  // Expose a safe bridge so main-process router diagnostics can be pushed
  // into the renderer for E2E tracing and diagnostics. This is idempotent
  // and only used for tests/troubleshooting.
  try {
    (global as any).__SADIE_PUSH_MAIN_LOG = (line: string) => {
      try {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('sadie:router-log', String(line));
        }
      } catch (e) {}
    };
    console.log('[MAIN] Router log bridge installed');
    (global as any).__SADIE_MAIN_LOG_BUFFER.push('[MAIN] Router log bridge installed');
  } catch (e) {
    console.error('[MAIN] Failed to install router log bridge', e);
  }
  
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
