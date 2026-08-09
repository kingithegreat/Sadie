/**
 * browser-panel.ts — an embedded browser docked inside the HomeBot window.
 *
 * Uses BrowserView, NOT a <webview> tag. web-services.ts documents why that
 * distinction matters: Google/OpenAI/Anthropic detect embedded <webview>
 * contexts and refuse to serve login pages. A BrowserView is a real WebContents
 * attached to the window — same standing as a BrowserWindow, with its own
 * session partition — so it passes those checks while still living inside the
 * app instead of a separate window.
 *
 * The renderer owns layout: it measures where the panel sits and sends those
 * bounds. Main never guesses geometry, so the page always lines up with the
 * chrome drawn around it.
 *
 * Also the "let HomeBot see the page" path — capture() returns a PNG of the
 * live view, which the vision tools can consume directly.
 */

import { BrowserView, BrowserWindow, ipcMain, shell } from 'electron';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const BROWSER_CHANNELS = {
  ATTACH: 'homebot:browser:attach',
  DETACH: 'homebot:browser:detach',
  BOUNDS: 'homebot:browser:bounds',
  NAVIGATE: 'homebot:browser:navigate',
  BACK: 'homebot:browser:back',
  FORWARD: 'homebot:browser:forward',
  RELOAD: 'homebot:browser:reload',
  CAPTURE: 'homebot:browser:capture',
  STATE_PUSH: 'homebot:browser:state',
} as const;

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

let view: BrowserView | null = null;
let attachedTo: BrowserWindow | null = null;
let lastBounds: BrowserBounds | null = null;

/** Only http(s) — a docked view must never be talked into file:// or similar. */
function normalizeUrl(raw: string): string | null {
  const input = (raw || '').trim();
  if (!input) return null;
  const candidate = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function currentState(): BrowserState {
  const wc = view?.webContents;
  if (!wc || wc.isDestroyed()) {
    return { url: '', title: '', canGoBack: false, canGoForward: false, loading: false };
  }
  return {
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
    loading: wc.isLoading(),
  };
}

function pushState(): void {
  try {
    if (attachedTo && !attachedTo.isDestroyed()) {
      attachedTo.webContents.send(BROWSER_CHANNELS.STATE_PUSH, currentState());
    }
  } catch {
    /* renderer went away */
  }
}

function ensureView(): BrowserView {
  if (view && !view.webContents.isDestroyed()) return view;

  view = new BrowserView({
    webPreferences: {
      // Its own persistent profile, like a normal browser tab. No preload and
      // no node access: this renders untrusted web content.
      partition: 'persist:homebot-browser',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const wc = view.webContents;
  wc.setUserAgent(CHROME_UA);

  // Popups (OAuth, "open in new tab") have nowhere to go in a docked panel.
  // Navigate in place for same-origin-ish flows; hand anything else to the
  // real browser rather than silently dropping the click.
  wc.setWindowOpenHandler(({ url }) => {
    const safe = normalizeUrl(url);
    if (safe) {
      // Sign-in flows must stay in this partition or the session is lost.
      if (/accounts\.google|login|signin|oauth|auth\./i.test(safe)) {
        wc.loadURL(safe);
      } else {
        shell.openExternal(safe);
      }
    }
    return { action: 'deny' };
  });

  for (const evt of ['did-navigate', 'did-navigate-in-page', 'page-title-updated',
    'did-start-loading', 'did-stop-loading', 'did-finish-load'] as const) {
    wc.on(evt as any, () => pushState());
  }

  return view;
}

export function registerBrowserPanelIpc(getMainWindow: () => BrowserWindow | null): void {
  for (const channel of [
    BROWSER_CHANNELS.ATTACH, BROWSER_CHANNELS.DETACH, BROWSER_CHANNELS.BOUNDS,
    BROWSER_CHANNELS.NAVIGATE, BROWSER_CHANNELS.BACK, BROWSER_CHANNELS.FORWARD,
    BROWSER_CHANNELS.RELOAD, BROWSER_CHANNELS.CAPTURE,
  ]) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(BROWSER_CHANNELS.ATTACH, async (_e, url?: unknown, bounds?: unknown) => {
    try {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) return { success: false, error: 'No window to attach to.' };

      const v = ensureView();
      if (attachedTo !== win) {
        win.setBrowserView(v);
        attachedTo = win;
      }
      if (bounds && typeof bounds === 'object') {
        lastBounds = bounds as BrowserBounds;
        v.setBounds(lastBounds);
      }

      const target = normalizeUrl(typeof url === 'string' ? url : '') || 'https://duckduckgo.com';
      if (!v.webContents.getURL()) await v.webContents.loadURL(target);
      pushState();
      return { success: true, state: currentState() };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(BROWSER_CHANNELS.DETACH, async () => {
    try {
      // Remove from the window but keep the WebContents alive, so reopening the
      // panel returns to the same page and session rather than a blank tab.
      if (attachedTo && !attachedTo.isDestroyed()) attachedTo.setBrowserView(null);
      attachedTo = null;
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(BROWSER_CHANNELS.BOUNDS, async (_e, bounds?: unknown) => {
    try {
      if (!view || !bounds || typeof bounds !== 'object') return { success: false };
      lastBounds = bounds as BrowserBounds;
      // Round: fractional bounds from CSS measurement leave seams.
      view.setBounds({
        x: Math.round(lastBounds.x),
        y: Math.round(lastBounds.y),
        width: Math.max(0, Math.round(lastBounds.width)),
        height: Math.max(0, Math.round(lastBounds.height)),
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(BROWSER_CHANNELS.NAVIGATE, async (_e, url?: unknown) => {
    try {
      const target = normalizeUrl(typeof url === 'string' ? url : '');
      if (!target) return { success: false, error: 'That does not look like a web address.' };
      await ensureView().webContents.loadURL(target);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(BROWSER_CHANNELS.BACK, async () => {
    if (view?.webContents.canGoBack()) view.webContents.goBack();
    return { success: true };
  });

  ipcMain.handle(BROWSER_CHANNELS.FORWARD, async () => {
    if (view?.webContents.canGoForward()) view.webContents.goForward();
    return { success: true };
  });

  ipcMain.handle(BROWSER_CHANNELS.RELOAD, async () => {
    view?.webContents.reload();
    return { success: true };
  });

  /** A PNG of what the panel is currently showing — the "look at this page" path. */
  ipcMain.handle(BROWSER_CHANNELS.CAPTURE, async () => {
    try {
      if (!view || view.webContents.isDestroyed()) return { success: false, error: 'The browser panel is not open.' };
      const image = await view.webContents.capturePage();
      if (image.isEmpty()) return { success: false, error: 'Nothing to capture yet.' };
      return {
        success: true,
        base64: image.toPNG().toString('base64'),
        mimeType: 'image/png',
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function destroyBrowserPanel(): void {
  try {
    if (attachedTo && !attachedTo.isDestroyed()) attachedTo.setBrowserView(null);
    // BrowserView has no destroy(); closing its WebContents releases it.
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
  } catch {
    /* shutting down */
  }
  view = null;
  attachedTo = null;
  lastBounds = null;
}
