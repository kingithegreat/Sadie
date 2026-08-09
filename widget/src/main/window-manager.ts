import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { isDevelopment } from './env';
import { is } from '@electron-toolkit/utils';

/** Catch handler for fire-and-forget ops — logs instead of silently swallowing */
function safeCatch(e: unknown) { console.error('[HomeBot-CATCH]', e); }

let mainWindow: BrowserWindow | null = null;

// Widget mode dimensions and state
const WIDGET_SIZE = { width: 560, height: 820 };
const EXPANDED_SIZE = { width: 1200, height: 800 };
let isWidgetMode = process.env.HOMEBOT_E2E === '1' ? false : true;

export function createMainWindow(): BrowserWindow {
  console.log('[WINDOW] Creating main window...');
  try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Creating main window...'); } catch (e) { safeCatch(e); }

  // Only create window if it doesn't exist
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('[WINDOW] Window already exists, focusing...');
    try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window already exists, focusing'); } catch (e) { safeCatch(e); }
    mainWindow.focus();
    return mainWindow;
  }

  console.log('[WINDOW] Creating new BrowserWindow...');
  try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Creating new BrowserWindow'); } catch (e) { safeCatch(e); }

  // Create the browser window — frameless with custom chrome, deliberately NOT
  // transparent. On Windows a transparent window loses its native thick frame,
  // which is what the OS uses for edge-resizing, Win+Arrow snapping and Snap
  // Layouts — `resizable: true` is silently neutered. Opaque + frameless (the
  // VS Code model) keeps the custom titlebar AND normal resize/snap behaviour.
  // The old glass-over-desktop look is now POSSIBLE via backgroundMaterial:
  // 'acrylic' — the Electron 42 upgrade landed (42, not 43: better-sqlite3
  // publishes prebuilds up to ABI 146/Electron 42; 43's ABI 148 isn't
  // published yet). Not enabled here: cosmetic change, own PR.
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
    transparent: false,
    // Pre-paint colour so the first frame isn't a white flash; matches --bg-dark.
    backgroundColor: '#15171b',
    hasShadow: true,
    show: false,
    // Don't show in taskbar when in widget mode — acts like a desktop widget
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false     // Not used — web services use dedicated BrowserWindows
    }
  });

  // Never let the window grow or drift past the visible desktop — anything
  // anchored to its bottom edge (e.g. the Settings Save bar) becomes
  // unreachable, and the user cannot save at all.
  keepWindowOnScreen(mainWindow);

  console.log('[WINDOW] Setting permission handlers...');
  try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Setting permission handlers'); } catch (e) { safeCatch(e); }

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
  try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push(`[MAIN] [WINDOW] Loading HTML from: ${htmlPath}`); } catch (e) { safeCatch(e); }

  // Load the renderer — use Vite dev-server in dev mode for HMR, file in production
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    console.log('[WINDOW] Dev mode: loading from Vite dev server:', devUrl);
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(htmlPath);
  }

  // Show window when ready — position on screen, clamped to fit
  mainWindow.once('ready-to-show', () => {
    console.log('[WINDOW] Window ready to show, showing...');
    try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window ready to show'); } catch (e) { safeCatch(e); }
    if (mainWindow) {
      if (isWidgetMode) {
        positionWidget(mainWindow);
      } else {
        clampToWorkArea(mainWindow);
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
    try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push(`[MAIN] [RENDERER] ${message}`); } catch (e) { safeCatch(e); }
  });

  // Open DevTools in development
  if (isDevelopment) {
    console.log('[WINDOW] Opening DevTools...');
    try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Opening DevTools'); } catch (e) { safeCatch(e); }
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    console.log('[WINDOW] Window closed');
    try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window closed'); } catch (e) { safeCatch(e); }
    mainWindow = null;
  });

  console.log('[WINDOW] Window creation complete');
  try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push('[MAIN] [WINDOW] Window creation complete'); } catch (e) { safeCatch(e); }
  return mainWindow;
}

/**
 * Keep the window inside the visible desktop.
 *
 * Making the window resizable (needed for native snap) also made it possible
 * to size or drag it taller than the screen. Anything anchored to the bottom
 * of the window then sits below the visible area — the Settings panel is
 * capped at 95vh of the WINDOW, so its Cancel/Save footer became unreachable
 * and settings could not be saved at all.
 *
 * Debounced because 'resize' and 'move' fire continuously while dragging;
 * re-positioning mid-drag would fight the user.
 */
function keepWindowOnScreen(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;

  const clamp = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
    try {
      const b = win.getBounds();
      const area = screen.getDisplayMatching(b).workArea;

      const width = Math.min(b.width, area.width);
      const height = Math.min(b.height, area.height);
      // Keep the top-left on screen so the titlebar stays grabbable.
      const x = Math.min(Math.max(b.x, area.x), area.x + area.width - width);
      const y = Math.min(Math.max(b.y, area.y), area.y + area.height - height);

      if (width !== b.width || height !== b.height || x !== b.x || y !== b.y) {
        win.setBounds({ x, y, width, height });
      }
    } catch (e) {
      safeCatch(e);
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(clamp, 220);
  };

  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('closed', () => { if (timer) clearTimeout(timer); });
}

/** Shrink a window if it exceeds the work area of its current display */
function clampToWorkArea(win: BrowserWindow) {
  try {
    const bounds = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const workArea = display.workArea;
    const padding = 20;
    const maxW = workArea.width - padding * 2;
    const maxH = workArea.height - padding * 2;
    let [w, h] = win.getSize();
    if (w > maxW || h > maxH) {
      win.setSize(Math.min(w, maxW), Math.min(h, maxH), true);
    }
  } catch (e) {
    safeCatch(e);
  }
}

/** Position the widget in the bottom-right corner, clamped to fit on screen */
function positionWidget(win: BrowserWindow) {
  try {
    const bounds = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const workArea = display.workArea;
    let [winW, winH] = win.getSize();
    const padding = 20;

    // Shrink the window if it doesn't fit the work area
    const maxW = workArea.width - padding * 2;
    const maxH = workArea.height - padding * 2;
    if (winW > maxW || winH > maxH) {
      winW = Math.min(winW, maxW);
      winH = Math.min(winH, maxH);
      win.setSize(winW, winH, true);
    }

    // Place at bottom-right, clamped so the top-left stays on screen
    const x = Math.max(workArea.x + padding, workArea.x + workArea.width - winW - padding);
    const y = Math.max(workArea.y + padding, workArea.y + workArea.height - winH - padding);
    win.setPosition(x, y);
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
    clampToWorkArea(mainWindow);
    mainWindow.center();
    console.log('[WINDOW] Switched to expanded mode');
  }

  // Notify renderer of mode change
  mainWindow.webContents.send('homebot:widget-mode-changed', isWidgetMode);
  return isWidgetMode;
}

/** Get current widget mode state */
export function getWidgetMode(): boolean {
  return isWidgetMode;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
