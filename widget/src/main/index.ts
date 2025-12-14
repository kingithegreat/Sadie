import { app, BrowserWindow, ipcMain, IpcMainEvent } from 'electron';
import { spawn } from 'child_process';
import { mkdirSync, existsSync, appendFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
(global as any).__SADIE_DIAG_DIR = path.join(os.homedir(), 'SADIE_DIAG');
if (!existsSync((global as any).__SADIE_DIAG_DIR)) mkdirSync((global as any).__SADIE_DIAG_DIR, { recursive: true });
(global as any).__SADIE_DIAG_FILE = path.join((global as any).__SADIE_DIAG_DIR, 'sadie-runtime.log');
function appendDiagLog(line: string) {
  try { appendFileSync((global as any).__SADIE_DIAG_FILE, `${new Date().toISOString()} ${line}\n`, { encoding: 'utf8' }); } catch (e) {}
}
// Diagnostics buffer capture
(global as any).__SADIE_MAIN_LOG_BUFFER ??= [];
function pushMainLog(line: string) {
  try { (global as any).__SADIE_MAIN_LOG_BUFFER.push(`[MAIN] ${String(line)}`); } catch (e) {}
  try { appendDiagLog(String(line)); } catch (e) {}
}
// Expose a global push function for other modules
(global as any).__SADIE_PUSH_MAIN_LOG = pushMainLog;
import { createMainWindow } from './window-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { sanitizeEnvForPackaged, isPackagedBuild } from './env';

// Load environment variables
require('dotenv').config();

// Sanitize env when running a packaged build so test flags cannot be honored
sanitizeEnvForPackaged();

// Hard-lock NODE_ENV based on packaging status if not set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = isPackagedBuild ? 'production' : 'development';
}

// Always set SADIE_ENV to desktop (locked)
process.env.SADIE_ENV = 'desktop';

// Initialize logging early
import { initLogging, logStartup, logError } from './utils/logger';
initLogging();
logStartup(`Starting SADIE, NODE_ENV=${process.env.NODE_ENV}, SADIE_ENV=${process.env.SADIE_ENV}`);
// Top-level startup trace
console.log('[Startup] SADIE app booted; tracing enabled');
pushMainLog('[Startup] SADIE app booted; tracing enabled');

// Enable Chrome flags for Web Speech API
app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI');

// Enable hot reload in development
import { isDevelopment } from './env';
if (isDevelopment) {
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
  // === DIAGNOSTICS: Print runtime mode and paths ===
  const { isE2E, isReleaseBuild } = require('./env');
  if (process.env.NODE_ENV !== 'production') {
    console.log('[DIAG] isE2E =', isE2E);
    console.log('[DIAG] app.isPackaged =', app.isPackaged);
    console.log('[DIAG] isReleaseBuild =', isReleaseBuild);
    console.log('[DIAG] userData path =', app.getPath('userData'));
  }

  // Release build logging (only in production)
  if (process.env.NODE_ENV === 'production') {
    console.log(`[BUILD] mode=release; userData=${app.getPath('userData')}`);
  }
  if (process.env.NODE_ENV !== 'production') console.log('[DIAG] userData Path =', app.getPath('userData'));
  // Register IPC handlers BEFORE window creation to satisfy early renderer invokes
  registerIpcHandlers();
  pushMainLog('Registered IPC handlers.');
  logStartup('Registered IPC handlers.');

  // Auto-start n8n on Windows using the shipped helper script. This ensures the
  // local orchestrator is running before the renderer attempts to reach it.
  if (process.platform === 'win32') {
    try {
      const scriptPath = require('path').join(process.cwd(), 'scripts', 'start-n8n.ps1');
      spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
      pushMainLog('Invoked start-n8n.ps1');
    } catch (e) {
      console.error('Failed to invoke start-n8n.ps1:', e);
      pushMainLog('Failed to invoke start-n8n.ps1');
    }
  }

  mainWindow = createMainWindow();
  pushMainLog('Main window created');

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

  // Diagnostic env handler
  ipcMain.handle('sadie:get-env', () => {
    const { isE2E, isPackagedBuild, isReleaseBuild } = require('./env');
    return {
      isE2E,
      isPackagedBuild,
      isReleaseBuild,
      userDataPath: app.getPath('userData')
    };
  });
  // Allow renderer to append a log string to the runtime diag file
  ipcMain.on('sadie:append-renderer-log', (_e: IpcMainEvent, line: string) => {
    try { appendDiagLog(`[RENDERER] ${line}`); } catch (e) {}
  });

  // Handler invoked by renderer to capture logs and return the file path
  ipcMain.handle('sadie:capture-logs', async () => {
    try {
      const TS = new Date().toISOString().replace(/[:.]/g, '-');
      const outPath = path.join((global as any).__SADIE_DIAG_DIR, `sadie-diagnostics-${TS}.log`);
      // Copy runtime log file to snapshot
      const src = (global as any).__SADIE_DIAG_FILE;
      if (src && existsSync(src)) {
        const content = require('fs').readFileSync(src, 'utf8');
        require('fs').writeFileSync(outPath, content, 'utf8');
        return { success: true, path: outPath };
      }
      // If not present, return success with path but no content
      require('fs').writeFileSync(outPath, 'No runtime log captured.', 'utf8');
      return { success: true, path: outPath };
    } catch (e) {
      return { success: false, error: String(e) };
    }
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
