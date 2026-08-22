/**
 * Reading a page with the browser we already ship.
 *
 * Plain `https.get` cannot read a great many sites. Measured against a live
 * search: three results, two HTTP 403 and one too thin to use, 0 of 3 read —
 * so the assistant answered from search-result snippets and never saw an
 * article. The user-agent was already a current Chrome string; that is not what
 * those sites check. They check TLS fingerprints, cookies and JavaScript
 * challenges, and no header will satisfy them.
 *
 * HomeBot is an Electron app, so it HAS a browser. A hidden BrowserWindow is a
 * real browser making a real request: real TLS, real cookies, real JS. It gets
 * the page because it is not imitating a browser — it is one. Nothing here
 * evades a bot check; it simply stops pretending to be something it isn't.
 *
 * Deliberately a FALLBACK. Spawning a window costs far more than an HTTP GET,
 * so the cheap path runs first and this catches what it drops.
 *
 * Safety, since this loads arbitrary remote pages:
 *  - the caller's URL guard runs first (protocol, loopback, private ranges,
 *    and the DNS resolution behind them),
 *  - the window is offscreen, sandboxed, context-isolated, with no node
 *    integration and no preload — the page cannot reach Electron or the app,
 *  - it is destroyed on every path, including timeout,
 *  - only text comes back, capped.
 */

import { BrowserWindow } from 'electron';

/** Long enough for a JS-heavy page to settle; short enough not to hang a chat. */
const DEFAULT_TIMEOUT_MS = 20_000;

/** Matches the ceiling the HTTP path already applies to page text. */
const DEFAULT_MAX_CHARS = 8000;

/**
 * Extraction runs INSIDE the page, and returns a string. Nothing from the page
 * is evaluated back here — the return value is data, never code.
 *
 * Chrome and nav are dropped before the text is taken, or every page arrives
 * wrapped in its own menus.
 */
const EXTRACT_TEXT = `
  (() => {
    try {
      document.querySelectorAll('script,style,noscript,svg,nav,header,footer,aside,iframe').forEach(n => n.remove());
      const main = document.querySelector('article') || document.querySelector('main') || document.body;
      return (main && main.innerText ? main.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim();
    } catch (e) {
      return '';
    }
  })()
`;

export interface BrowserFetchResult {
  text: string;
  /** Final URL after redirects — a consent wall is worth being able to see. */
  url: string;
  title: string;
}

export function isBrowserFetchAvailable(): boolean {
  // Absent under Jest and in any non-Electron host.
  return typeof BrowserWindow === 'function';
}

/**
 * Load a page in a hidden window and return its readable text.
 *
 * Rejects rather than returning empty on failure, so a caller can tell "the
 * page said nothing" from "this did not run".
 */
export async function fetchViaBrowser(
  url: string,
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<BrowserFetchResult> {
  if (!isBrowserFetchAvailable()) {
    throw new Error('Browser fetch is unavailable outside Electron');
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      // The page is hostile until proven otherwise. None of these are
      // conveniences to be relaxed later.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      javascript: true,        // the entire point — the HTTP path already failed
      images: false,           // text is all that is wanted; skip the download
      webviewTag: false,
      preload: undefined,
      partition: 'browser-fetch',   // its own jar: no app session, no logins
    },
  });

  let settled = false;
  const destroy = () => {
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* already gone */ }
  };

  try {
    return await new Promise<BrowserFetchResult>((resolve, reject) => {
      const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      const timer = setTimeout(() => {
        finish(() => reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s loading ${url}`)));
      }, timeoutMs);

      win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
        // Sub-resource failures are normal and irrelevant — a blocked tracker
        // must not fail the page. -3 is ERR_ABORTED, which a redirect raises.
        if (!isMainFrame || code === -3) return;
        clearTimeout(timer);
        finish(() => reject(new Error(`Could not load ${failedUrl || url}: ${desc} (${code})`)));
      });

      win.webContents.on('did-finish-load', () => {
        // A beat for client-rendered pages to paint after load fires.
        setTimeout(async () => {
          try {
            const text = await win.webContents.executeJavaScript(EXTRACT_TEXT, true);
            clearTimeout(timer);
            finish(() => resolve({
              text: String(text || '').slice(0, maxChars),
              url: win.webContents.getURL() || url,
              title: win.webContents.getTitle() || '',
            }));
          } catch (e: any) {
            clearTimeout(timer);
            finish(() => reject(new Error(`Could not read ${url}: ${e?.message || e}`)));
          }
        }, 600);
      });

      win.loadURL(url).catch((e: any) => {
        clearTimeout(timer);
        finish(() => reject(new Error(`Could not open ${url}: ${e?.message || e}`)));
      });
    });
  } finally {
    destroy();
  }
}
