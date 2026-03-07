/**
 * web-services.ts — Manages dedicated BrowserWindows for ChatGPT, Claude, Gemini.
 *
 * Why BrowserWindow instead of <webview> tags:
 *  - No navigator.webdriver spoofing needed (it's false by default)
 *  - OAuth popups work natively without setWindowOpenHandler hacks
 *  - Session partitions work identically to a normal Chrome profile
 *  - Google/OpenAI/Anthropic all detect embedded <webview> contexts and
 *    refuse to show login pages; a BrowserWindow passes all their checks
 */

import { BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'path';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SERVICES = {
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com',              partition: 'persist:chatgpt' },
  claude:  { label: 'Claude',  url: 'https://claude.ai',                partition: 'persist:claude'  },
  gemini:  { label: 'Gemini',  url: 'https://gemini.google.com/app',    partition: 'persist:gemini'  },
} as const;

type ServiceId = keyof typeof SERVICES;

// Registry of open service windows (one per service, kept alive)
const windows: Partial<Record<ServiceId, BrowserWindow>> = {};

function createServiceWindow(id: ServiceId): BrowserWindow {
  const svc = SERVICES[id];

  // Pre-configure the session for this service: Chrome UA + allow all permissions
  const sesh = session.fromPartition(svc.partition);
  sesh.setUserAgent(CHROME_UA);
  sesh.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));

  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    title: svc.label,
    autoHideMenuBar: true,
    webPreferences: {
      partition: svc.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Webview preload compiled alongside the main preload
      preload: path.join(__dirname, '../preload/webview.js'),
    },
  });

  // Belt-and-suspenders: override UA at webContents level too
  win.webContents.setUserAgent(CHROME_UA);

  // Open OAuth popups (e.g. Google sign-in) in a new BrowserWindow rather
  // than trying to embed them — ensures the full OAuth flow works
  win.webContents.setWindowOpenHandler(({ url }) => {
    const popup = new BrowserWindow({
      width: 520,
      height: 760,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    popup.webContents.setUserAgent(CHROME_UA);
    popup.loadURL(url);
    return { action: 'deny' };
  });

  win.loadURL(svc.url);

  win.on('closed', () => {
    delete windows[id];
  });

  return win;
}

/**
 * Open or focus the window for the given service.
 * Returns immediately — the window shows asynchronously.
 */
function openOrFocus(id: ServiceId): void {
  const existing = windows[id];
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
  windows[id] = createServiceWindow(id);
  windows[id]!.show();
}

/** Register the IPC handler called from the renderer via window.electron.openWebService */
export function registerWebServicesHandlers(): void {
  ipcMain.handle('sadie:open-web-service', (_event, id: string) => {
    if (id in SERVICES) openOrFocus(id as ServiceId);
  });

  ipcMain.handle('sadie:web-service-status', () => {
    return Object.fromEntries(
      (Object.keys(SERVICES) as ServiceId[]).map(id => [
        id,
        !!(windows[id] && !windows[id]!.isDestroyed()),
      ])
    );
  });
}

/** Close all service windows (called on app quit) */
export function closeAllServiceWindows(): void {
  for (const win of Object.values(windows)) {
    if (win && !win.isDestroyed()) win.close();
  }
}
