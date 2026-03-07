/**
 * webview.ts — Preload script injected into every <webview> guest page.
 *
 * Runs before ANY page script so that auth sites (ChatGPT, Claude, Gemini)
 * cannot detect they are inside an Electron WebView and refuse to render
 * the login page.
 *
 * Key spoofs:
 *  - navigator.webdriver  → undefined  (set to true by Chromium automation)
 *  - navigator.plugins    → non-empty  (Electron webview often has 0 plugins)
 *  - window.chrome        → minimal stub (some sites gate on its presence)
 */

try {
  // 1. Remove webdriver flag — the #1 signal sites use to detect automation
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  // 2. Minimal window.chrome stub so pages don't bail out on missing chrome APIs
  if (!(window as any).chrome) {
    Object.defineProperty(window, 'chrome', {
      value: { runtime: {} },
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }

  // 3. Ensure navigator.plugins is non-empty (Electron webview defaults to 0)
  if (navigator.plugins.length === 0) {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
      configurable: true,
    });
  }
} catch (_e) {
  // Never crash — a failing preload would break all webviews
}
