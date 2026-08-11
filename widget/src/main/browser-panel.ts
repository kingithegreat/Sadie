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
  ipcMain.handle(BROWSER_CHANNELS.CAPTURE, async () => captureBrowserPage());
}

export interface BrowserCapture {
  success: boolean;
  error?: string;
  base64?: string;
  mimeType?: string;
  url?: string;
  title?: string;
}

/**
 * PNG of the live browser panel.
 *
 * Exported, not just wired to IPC, because the renderer is not the only caller
 * that matters: the look_at_browser tool needs it so the assistant can answer
 * "what does this page say?" — which was the point of building capture in the
 * first place. It sat behind an IPC channel nothing called until now.
 */
export async function captureBrowserPage(): Promise<BrowserCapture> {
  try {
    if (!view || view.webContents.isDestroyed()) {
      return { success: false, error: 'The browser panel is not open. Open it from the workspace first.' };
    }
    const image = await view.webContents.capturePage();
    if (image.isEmpty()) return { success: false, error: 'The page has not rendered anything yet.' };
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
}

/**
 * Navigate the panel from the main process.
 *
 * The IPC handler above does this for the renderer; a tool call has no
 * renderer to go through, and duplicating normalizeUrl + loadURL in the tool
 * layer would be a second copy of the same rule.
 */
export async function navigateBrowserPanel(url: string): Promise<{ success: boolean; error?: string }> {
  try {
    const target = normalizeUrl(url);
    if (!target) return { success: false, error: 'That does not look like a web address.' };
    await ensureView().webContents.loadURL(target);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Read the page as text the model can reason about.
 *
 * A screenshot alone forces vision on every question, and the local vision
 * model (moondream) is weak at reading UI. Text is cheaper, more accurate, and
 * works on any model — so this is the default way to "see" a page, with the
 * screenshot reserved for questions genuinely about layout or images.
 *
 * Runs in the page, so it sees what a person sees: rendered text, not source.
 */
export async function readBrowserPage(maxChars = 8000): Promise<
  { success: true; url: string; title: string; text: string; truncated: boolean }
  | { success: false; error: string }
> {
  if (!view || view.webContents.isDestroyed()) {
    return { success: false, error: 'The browser panel is not open. Open it with the Browser button first.' };
  }
  try {
    const text: string = await view.webContents.executeJavaScript(`
      (function () {
        // Strip the furniture people ignore, so the model reads the content.
        const drop = ['script','style','noscript','svg','nav','footer','header','aside'];
        const clone = document.body ? document.body.cloneNode(true) : null;
        if (!clone) return '';
        drop.forEach(function (sel) {
          Array.prototype.slice.call(clone.querySelectorAll(sel)).forEach(function (n) { n.remove(); });
        });
        return (clone.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
      })()
    `);
    const truncated = text.length > maxChars;
    return {
      success: true,
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
      text: truncated ? text.slice(0, maxChars) : text,
      truncated,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The interactive elements on the page, each with an index.
 *
 * This is what makes control possible without pixel coordinates: the model
 * picks an index from a list it can read, rather than guessing where to click
 * from a screenshot. Coordinate-guessing is where browser agents on small
 * models fall apart.
 */
export async function listBrowserTargets(limit = 60): Promise<
  { success: true; url: string; targets: Array<{ i: number; kind: string; label: string }> }
  | { success: false; error: string }
> {
  if (!view || view.webContents.isDestroyed()) {
    return { success: false, error: 'The browser panel is not open.' };
  }
  try {
    const targets = await view.webContents.executeJavaScript(`
      (function () {
        var sel = 'a[href], button, input, textarea, select, [role=button], [role=link]';
        var out = [];
        var els = Array.prototype.slice.call(document.querySelectorAll(sel));
        for (var i = 0; i < els.length && out.length < ${limit}; i++) {
          var el = els[i];
          var r = el.getBoundingClientRect();
          // Only what a person could actually click right now.
          if (r.width < 2 || r.height < 2) continue;
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          var st = window.getComputedStyle(el);
          if (st.visibility === 'hidden' || st.display === 'none') continue;
          var label = (el.getAttribute('aria-label') || el.innerText || el.value ||
                       el.getAttribute('placeholder') || el.getAttribute('title') ||
                       el.getAttribute('name') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
          if (!label) continue;
          out.push({ i: out.length, kind: el.tagName.toLowerCase(), label: label });
        }
        return out;
      })()
    `);
    return { success: true, url: view.webContents.getURL(), targets };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Click the nth element from listBrowserTargets, using the same ordering. */
export async function clickBrowserTarget(index: number): Promise<{ success: boolean; error?: string; clicked?: string }> {
  if (!view || view.webContents.isDestroyed()) {
    return { success: false, error: 'The browser panel is not open.' };
  }
  try {
    const res = await view.webContents.executeJavaScript(`
      (function () {
        var sel = 'a[href], button, input, textarea, select, [role=button], [role=link]';
        var out = [];
        var els = Array.prototype.slice.call(document.querySelectorAll(sel));
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          var r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          var st = window.getComputedStyle(el);
          if (st.visibility === 'hidden' || st.display === 'none') continue;
          var label = (el.getAttribute('aria-label') || el.innerText || el.value ||
                       el.getAttribute('placeholder') || el.getAttribute('title') ||
                       el.getAttribute('name') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
          if (!label) continue;
          out.push({ el: el, label: label });
        }
        var t = out[${Math.max(0, Math.floor(index))}];
        if (!t) return { ok: false, error: 'No element with that number is on screen.' };
        t.el.click();
        return { ok: true, label: t.label };
      })()
    `);
    return res?.ok ? { success: true, clicked: res.label } : { success: false, error: res?.error || 'Click failed.' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Type into the nth target, firing the events frameworks listen for. */
export async function typeIntoBrowserTarget(index: number, text: string): Promise<{ success: boolean; error?: string; into?: string }> {
  if (!view || view.webContents.isDestroyed()) {
    return { success: false, error: 'The browser panel is not open.' };
  }
  try {
    const res = await view.webContents.executeJavaScript(`
      (function () {
        var els = Array.prototype.slice.call(document.querySelectorAll('input, textarea, [contenteditable=true]'))
          .filter(function (el) {
            var r = el.getBoundingClientRect();
            return r.width > 2 && r.height > 2 && r.top <= window.innerHeight && r.bottom >= 0;
          });
        var el = els[${Math.max(0, Math.floor(index))}];
        if (!el) return { ok: false, error: 'No text field with that number is on screen.' };
        el.focus();
        var value = ${JSON.stringify(text)};
        if (el.isContentEditable) { el.textContent = value; }
        else {
          // React and friends listen for input/change, not assignment.
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        var label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || 'the field');
        return { ok: true, label: String(label).slice(0, 80) };
      })()
    `);
    return res?.ok ? { success: true, into: res.label } : { success: false, error: res?.error || 'Typing failed.' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
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
