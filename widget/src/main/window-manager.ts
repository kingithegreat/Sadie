import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { isDevelopment } from './env';
import { is } from '@electron-toolkit/utils';

/** Catch handler for fire-and-forget ops — logs instead of silently swallowing */
function safeCatch(e: unknown) { console.error('[SADIE-CATCH]', e); }

let mainWindow: BrowserWindow | null = null;

// Widget mode dimensions and state
const WIDGET_SIZE = { width: 420, height: 620 };
const EXPANDED_SIZE = { width: 1200, height: 800 };
let isWidgetMode = process.env.SADIE_E2E === '1' ? false : true;

export function createMainWindow(): BrowserWindow {
  console.log('[WINDOW] Creating main window...');
  try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Creating main window...'); } catch (e) { safeCatch(e); }

  // Only create window if it doesn't exist
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('[WINDOW] Window already exists, focusing...');
    try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window already exists, focusing'); } catch (e) { safeCatch(e); }
    mainWindow.focus();
    return mainWindow;
  }

  console.log('[WINDOW] Creating new BrowserWindow...');
  try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Creating new BrowserWindow'); } catch (e) { safeCatch(e); }

  // Create the browser window — frameless + transparent for glass morphism widget
  mainWindow = new BrowserWindow({
    width: isWidgetMode ? WIDGET_SIZE.width : EXPANDED_SIZE.width,
    height: isWidgetMode ? WIDGET_SIZE.height : EXPANDED_SIZE.height,
    minWidth: 320,
    minHeight: 400,
    resizable: true,
    maximizable: true,
    minimizable: true,
    closable: true,
    movable: true,
    alwaysOnTop: isWidgetMode,
    frame: false,
    transparent: true,
    hasShadow: false,
    show: false,
    // Don't show in taskbar when in widget mode — acts like a desktop widget
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,       // Disable sandbox to allow Web Speech API
      webviewTag: false     // Not used — web services use dedicated BrowserWindows
    }
  });

  console.log('[WINDOW] Setting permission handlers...');
  try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Setting permission handlers'); } catch (e) { safeCatch(e); }

  // Handle permission requests (microphone for speech recognition)
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowedPermissions = ['media', 'microphone', 'audioCapture'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Prevent the renderer from being navigated away from the app (XSS / open-redirect mitigation)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = is.dev && process.env['ELECTRON_RENDERER_URL']
      ? url.startsWith(process.env['ELECTRON_RENDERER_URL'])
      : url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
      console.warn('[SECURITY] Blocked navigation to:', url);
    }
  });

  const htmlPath = path.join(__dirname, '../renderer/index.html');
  console.log('[WINDOW] Loading HTML from:', htmlPath);
  try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push(`[MAIN] [WINDOW] Loading HTML from: ${htmlPath}`); } catch (e) { safeCatch(e); }

  // Load the renderer — use Vite dev-server in dev mode for HMR, file in production
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    console.log('[WINDOW] Dev mode: loading from Vite dev server:', devUrl);
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(htmlPath);
  }

  // Show window when ready — position in bottom-right of screen
  mainWindow.once('ready-to-show', () => {
    console.log('[WINDOW] Window ready to show, showing...');
    try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window ready to show'); } catch (e) { safeCatch(e); }
    if (mainWindow) {
      if (isWidgetMode) {
        positionWidget(mainWindow);
      } else {
        mainWindow.center();
      }
      mainWindow.show();
    }
  });

  // Handle page load errors
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[WINDOW] Failed to load page:', errorCode, errorDescription);
  });

// Handle console messages from renderer
  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    console.log('[RENDERER]', message);
    try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push(`[MAIN] [RENDERER] ${message}`); } catch (e) { safeCatch(e); }
  });

  // Open DevTools in development
  if (isDevelopment) {
    console.log('[WINDOW] Opening DevTools...');
    try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Opening DevTools'); } catch (e) { safeCatch(e); }
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    console.log('[WINDOW] Window closed');
    try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window closed'); } catch (e) { safeCatch(e); }
    mainWindow = null;
  });

  console.log('[WINDOW] Window creation complete');
  try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window creation complete'); } catch (e) { safeCatch(e); }
  return mainWindow;
}

/** Position the widget in the bottom-right corner of the display the window is currently on */
function positionWidget(win: BrowserWindow) {
  try {
    const bounds = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const workArea = display.workArea;
    const [winW, winH] = win.getSize();
    const padding = 20;
    win.setPosition(
      workArea.x + workArea.width - winW - padding,
      workArea.y + workArea.height - winH - padding
    );
  } catch (e) {
    safeCatch(e);
  }
}

/** Toggle between widget (compact) and expanded (full) mode */
export function toggleWidgetMode(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return isWidgetMode;

  isWidgetMode = !isWidgetMode;

  if (isWidgetMode) {
    // Switch to compact widget
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setSize(WIDGET_SIZE.width, WIDGET_SIZE.height, true);
    positionWidget(mainWindow);
    console.log('[WINDOW] Switched to widget mode');
  } else {
    // Switch to expanded/full mode
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setSize(EXPANDED_SIZE.width, EXPANDED_SIZE.height, true);
    mainWindow.center();
    console.log('[WINDOW] Switched to expanded mode');
  }

  // Notify renderer of mode change
  mainWindow.webContents.send('sadie:widget-mode-changed', isWidgetMode);
  return isWidgetMode;
}

/** Get current widget mode state */
export function getWidgetMode(): boolean {
  return isWidgetMode;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
