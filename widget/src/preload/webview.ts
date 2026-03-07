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
  // 1. Remove webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

  // 2. Full window.chrome stub — Cloudflare checks loadTimes, csi, and app
  if (!(window as any).chrome) {
    const chrome = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      },
      runtime: {
        OnInstalledReason: {},
        OnRestartRequiredReason: {},
        PlatformArch: {},
        PlatformNaclArch: {},
        PlatformOs: {},
        RequestUpdateCheckStatus: {},
        id: undefined,
        connect: () => {},
        sendMessage: () => {},
        getManifest: () => ({}),
      },
      loadTimes: function() { return {}; },
      csi:        function() { return { startE: Date.now(), onloadT: Date.now(), pageT: Date.now(), tran: 15 }; },
    };
    Object.defineProperty(window, 'chrome', { value: chrome, enumerable: true, configurable: false, writable: false });
  }

  // 3. Non-empty plugins list
  if (navigator.plugins.length === 0) {
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5], configurable: true });
  }

  // 4. Non-empty mimeTypes list
  if (navigator.mimeTypes.length === 0) {
    Object.defineProperty(navigator, 'mimeTypes', { get: () => [1], configurable: true });
  }

  // 5. Convincing permissions stub — automation returns 'denied' for notifications
  const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
  if (origQuery) {
    Object.defineProperty(navigator.permissions, 'query', {
      value: (params: any) => {
        if (params?.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission } as PermissionStatus);
        }
        return origQuery(params);
      },
      configurable: true,
    });
  }
} catch (_e) {
  // Never crash
}
