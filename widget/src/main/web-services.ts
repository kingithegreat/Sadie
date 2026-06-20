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

// General-purpose browser window for any URL
let browseWindow: BrowserWindow | null = null;

const ALLOWED_PERMISSION_SET = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'media',
  'microphone',
  'camera',
  'notifications',
]);

const ALLOWED_POPUP_HOST_SUFFIXES = [
  'chatgpt.com',
  'openai.com',
  'claude.ai',
  'anthropic.com',
  'gemini.google.com',
  'google.com',
  'googleusercontent.com',
  'gstatic.com',
];

function isAllowedPopupUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_POPUP_HOST_SUFFIXES.some(
      suffix => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

// Registry of open service windows (one per service, kept alive)
const windows: Partial<Record<ServiceId, BrowserWindow>> = {};

function createServiceWindow(id: ServiceId): BrowserWindow {
  const svc = SERVICES[id];

  // Pre-configure the session for this service: Chrome UA + allow all permissions
  const sesh = session.fromPartition(svc.partition);
  sesh.setUserAgent(CHROME_UA);
  sesh.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(ALLOWED_PERMISSION_SET.has(permission));
  });

  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    title: svc.label,
    autoHideMenuBar: true,
    webPreferences: {
      partition: svc.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // sandbox=true is required — sandbox=false is detectable by Cloudflare
      preload: path.join(__dirname, '../preload/webview.js'),
    },
  });

  // Belt-and-suspenders: override UA at webContents level too
  win.webContents.setUserAgent(CHROME_UA);

  // Open OAuth popups (e.g. Google sign-in) in a new BrowserWindow rather
  // than trying to embed them — ensures the full OAuth flow works
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedPopupUrl(url)) {
      return { action: 'deny' };
    }

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

function openBrowseWindow(url: string): void {
  if (browseWindow && !browseWindow.isDestroyed()) {
    browseWindow.loadURL(url);
    if (browseWindow.isMinimized()) browseWindow.restore();
    browseWindow.focus();
    return;
  }

  const sesh = session.fromPartition('persist:browse');
  sesh.setUserAgent(CHROME_UA);
  sesh.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(ALLOWED_PERMISSION_SET.has(permission));
  });

  browseWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    title: 'HomeBot Browser',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:browse',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/webview.js'),
    },
  });

  browseWindow.webContents.setUserAgent(CHROME_UA);

  browseWindow.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    browseWindow?.loadURL(popupUrl);
    return { action: 'deny' };
  });

  browseWindow.loadURL(url);
  browseWindow.on('closed', () => { browseWindow = null; });
}

/** Register the IPC handler called from the renderer via window.electron.openWebService */
export function registerWebServicesHandlers(): void {
  ipcMain.handle('homebot:open-web-service', (_event, id: string) => {
    if (id in SERVICES) openOrFocus(id as ServiceId);
  });

  ipcMain.handle('homebot:web-service-status', () => {
    return Object.fromEntries(
      (Object.keys(SERVICES) as ServiceId[]).map(id => [
        id,
        !!(windows[id] && !windows[id]!.isDestroyed()),
      ])
    );
  });

  // Open a general-purpose browser window
  ipcMain.handle('homebot:open-browse', (_event, url: string) => {
    if (url && typeof url === 'string') {
      let normalized = url.trim();
      if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized;
      openBrowseWindow(normalized);
    }
  });

  // Get the current URL and page content from the browse window
  ipcMain.handle('homebot:grab-browse-content', async () => {
    if (!browseWindow || browseWindow.isDestroyed()) {
      return { success: false, error: 'No browser window open' };
    }

    try {
      const currentUrl = browseWindow.webContents.getURL();
      const content = await browseWindow.webContents.executeJavaScript(`
        (function() {
          var clone = document.cloneNode(true);
          var scripts = clone.querySelectorAll('script, style, noscript, svg, iframe');
          for (var i = 0; i < scripts.length; i++) scripts[i].remove();
          var text = (clone.body || clone.documentElement).innerText || '';
          return text.replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
        })()
      `);
      const title = await browseWindow.webContents.executeJavaScript('document.title');
      return { success: true, url: currentUrl, title: title || '', content: content || '' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to extract page content' };
    }
  });

  // Check if browse window is open and get current URL
  ipcMain.handle('homebot:browse-status', () => {
    if (!browseWindow || browseWindow.isDestroyed()) return { open: false };
    return { open: true, url: browseWindow.webContents.getURL(), title: browseWindow.getTitle() };
  });
}

/** Close all service windows (called on app quit) */
export function closeAllServiceWindows(): void {
  for (const win of Object.values(windows)) {
    if (win && !win.isDestroyed()) win.close();
  }
}
