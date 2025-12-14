import { BrowserWindow } from 'electron';
import * as path from 'path';
import { isDevelopment } from './env';

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  console.log('[WINDOW] Creating main window...');
  try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Creating main window...'); } catch (e) {}

  // Only create window if it doesn't exist
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('[WINDOW] Window already exists, focusing...');
    try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window already exists, focusing'); } catch (e) {}
    mainWindow.focus();
    return mainWindow;
  }

  console.log('[WINDOW] Creating new BrowserWindow...');
  try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Creating new BrowserWindow'); } catch (e) {}

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // Allow OS-level resizing by default; keep other flags that make the
    // window behave like a widget. Frameless windows remove native resize
    // controls on some OSes, so set "frame: true" if you want a native
    // titlebar and system resize handles. You can also use a custom
    // draggable/resizable UI if you prefer to keep frameless.
    resizable: true,
    maximizable: true,
    minimizable: true,
    closable: true,
    movable: true,
    alwaysOnTop: false,
    frame: true,
    transparent: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false  // Disable sandbox to allow Web Speech API
    }
  });

  console.log('[WINDOW] Setting permission handlers...');
  try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Setting permission handlers'); } catch (e) {}

  // Handle permission requests (microphone for speech recognition)
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'microphone', 'audioCapture'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  const htmlPath = path.join(__dirname, '../renderer/index.html');
  console.log('[WINDOW] Loading HTML from:', htmlPath);
  try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push(`[MAIN] [WINDOW] Loading HTML from: ${htmlPath}`); } catch (e) {}

  // Load the renderer HTML
  mainWindow.loadFile(htmlPath);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    console.log('[WINDOW] Window ready to show, showing...');
    try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window ready to show'); } catch (e) {}
    if (mainWindow) {
      mainWindow.show();
    }
  });

  // Handle page load errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[WINDOW] Failed to load page:', errorCode, errorDescription);
  });

  // Handle console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log('[RENDERER]', message);
    try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push(`[MAIN] [RENDERER] ${message}`); } catch (e) {}
  });

  // Open DevTools in development
  if (isDevelopment) {
    console.log('[WINDOW] Opening DevTools...');
    try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Opening DevTools'); } catch (e) {}
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    console.log('[WINDOW] Window closed');
    try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window closed'); } catch (e) {}
    mainWindow = null;
  });

  console.log('[WINDOW] Window creation complete');
  try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window creation complete'); } catch (e) {}
  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
