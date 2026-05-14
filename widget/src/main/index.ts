// Main process for SADIE - Full implementation
import { app, BrowserWindow, ipcMain, session, globalShortcut } from 'electron';

/** Catch handler for fire-and-forget ops — logs instead of silently swallowing */
function safeCatch(e: unknown) { console.error('[SADIE-CATCH]', e); }

import { createMainWindow } from './window-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { registerMessageRouter } from './message-router';
import { initializeTools } from './tools';
import { getSettings, saveSettings, applyHardwareProfile } from './config-manager';
import { isE2E } from './env';
import { detectGpuVram } from './moa';
import { ensureN8nRunning } from './n8n-lifecycle';
import { initScheduler } from './scheduler';
import { restoreReminders } from './tools/reminder';
import { registerWebServicesHandlers, closeAllServiceWindows } from './web-services';
import { initAutoUpdater, downloadUpdate, installUpdate } from './auto-updater';
import { shutdownMcpServers } from './mcp-client';
import axios from 'axios';
import { spawn } from 'child_process';

let mainWindow: BrowserWindow | null = null;

const ALLOWED_WEB_SERVICE_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'media',
  'microphone',
  'camera',
  'notifications',
]);

const ALLOWED_WEB_SERVICE_POPUP_HOST_SUFFIXES = [
  'chatgpt.com',
  'openai.com',
  'claude.ai',
  'anthropic.com',
  'gemini.google.com',
  'google.com',
  'googleusercontent.com',
  'gstatic.com',
];

function isAllowedWebServicePopupUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_WEB_SERVICE_POPUP_HOST_SUFFIXES.some(
      suffix => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

// Global error handlers — prevent silent crashes and unhandled promise rejections
process.on('uncaughtException', (err) => {
  console.error('[MAIN] Uncaught exception:', err);
  try { pushMainLog(`[MAIN] uncaughtException: ${err.message}`); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
  console.error('[MAIN] Unhandled promise rejection:', reason);
  try { pushMainLog(`[MAIN] unhandledRejection: ${reason}`); } catch (_) {}
});

// Diagnostic log buffer for main process (capped at 500 entries)
const MAX_MAIN_LOG_BUFFER = 500;
(global as any).__SADIE_MAIN_LOG_BUFFER ??= [];
function pushMainLog(line: string) {
  const buf = (global as any).__SADIE_MAIN_LOG_BUFFER;
  buf.push(line);
  if (buf.length > MAX_MAIN_LOG_BUFFER) buf.splice(0, buf.length - MAX_MAIN_LOG_BUFFER);
}

// Apply a safe, idempotent ipcMain.handle patch (keeps behavior local and
// testable via `applyIpcHandlePatch`). See `src/main/utils/ipc-handle-patch.ts`.
import { applyIpcHandlePatch } from './utils/ipc-handle-patch';
applyIpcHandlePatch();

// E2E tests pass a custom userData directory via env var so Playwright doesn't
// need to use Chromium CLI flags that conflict with Node's option parser.
if (process.env.SADIE_E2E_USER_DATA_DIR) {
  app.setPath('userData', process.env.SADIE_E2E_USER_DATA_DIR);
}

// Remove the Chrome automation flag that Cloudflare and anti-bot systems
// (used by Claude, ChatGPT, Gemini) use as their primary detection signal.
// MUST be called before app.whenReady().
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

app.whenReady().then(async () => {
  console.log('[MAIN] App ready, initializing...');
  console.log('[MAIN] Env check: SADIE_DIRECT_OLLAMA=', process.env.SADIE_DIRECT_OLLAMA, 'isE2E=', isE2E);
  pushMainLog('[MAIN] App ready');

  // Register IPC handlers BEFORE creating window
  registerIpcHandlers();
  registerWebServicesHandlers();

  // Spoof a standard Chrome UA on each web-service session partition so that
  // ChatGPT, Claude, and Gemini don't detect Electron and block the page.
  // Must be done before the webviews load (i.e. before the renderer mounts).
  const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  for (const name of ['chatgpt', 'claude', 'gemini']) {
    const sesh = session.fromPartition(`persist:${name}`);
    sesh.setUserAgent(CHROME_UA);
    sesh.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(ALLOWED_WEB_SERVICE_PERMISSIONS.has(permission));
    });
  }

  // Create the main window FIRST for fast first-paint, then init tools in background
  mainWindow = createMainWindow();

  // For every <webview> that gets attached to the main window:
  // 1. Re-apply the Chrome UA at the webContents level (strongest override).
  // 2. Open OAuth / popup URLs as a real BrowserWindow — Google and others
  //    actively block embedded WebView auth; a floating window bypasses this.
  mainWindow.webContents.on('did-attach-webview', (_event, wvContents) => {
    wvContents.setUserAgent(CHROME_UA);
    wvContents.setWindowOpenHandler(({ url }) => {
      if (!isAllowedWebServicePopupUrl(url)) {
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
      return { action: 'deny' }; // prevent internal webview handling
    });
  });

  // Ensure n8n backend is running (auto-starts Docker container if needed)
  ensureN8nRunning((status) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sadie:n8n-status', { status });
      }
    } catch (e) { safeCatch(e); }
  }).catch((e) => console.error('[MAIN] n8n lifecycle error:', e));

  // Register message router with proper parameters
  const settings = getSettings();
  // Allow E2E or env-based override for the n8n URL so tests can route to a
  // mock upstream without changing user settings on disk. Prefer explicit
  // process.env.N8N_URL when present (test runner sets this), then saved
  // settings, then fallback to localhost default.
  const resolvedN8nUrl = process.env.N8N_URL || settings.n8nUrl || 'http://localhost:5678';
  if (process.env.NODE_ENV !== 'production') console.log('[MAIN] Resolved n8nUrl =', resolvedN8nUrl);
  registerMessageRouter(mainWindow, resolvedN8nUrl);
  // Expose a safe bridge so main-process router diagnostics can be pushed
  // into the renderer for E2E tracing and diagnostics. This is idempotent
  // and only used for tests/troubleshooting.
  try {
    (global as any).__SADIE_PUSH_MAIN_LOG = (line: string) => {
      try {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('sadie:router-log', String(line));
        }
      } catch (e) { safeCatch(e); }
    };
    console.log('[MAIN] Router log bridge installed');
    pushMainLog('[MAIN] Router log bridge installed');
  } catch (e) {
    console.error('[MAIN] Failed to install router log bridge', e);
  }
  
  console.log('[MAIN] IPC handlers registered');
  pushMainLog('[MAIN] IPC handlers registered');

  // Deferred background initialization — runs after window is shown
  // so the user sees the UI immediately while tools/scheduler/reminders load.
  setImmediate(async () => {
    try {
      await initializeTools();
      console.log('[MAIN] Tools initialized (deferred)');
      pushMainLog('[MAIN] Tools initialized');
    } catch (e) {
      console.error('[MAIN] Tool initialization error:', e);
    }
    try { initScheduler(); } catch (e) { console.error('[MAIN] Scheduler init error:', e); }
    try { restoreReminders(); } catch (e) { console.error('[MAIN] Reminder restore error:', e); }

    // Ollama health check — ping /api/tags and notify renderer so it can show
    // a banner if Ollama isn't running yet.
    let ollamaOnline = false;
    try {
      const ollamaUrl = getSettings().ollamaUrl || 'http://127.0.0.1:11434';
      try {
        await axios.get(`${ollamaUrl}/api/tags`, { timeout: 3000 });
        ollamaOnline = true;
      } catch { /* not running */ }
      console.log(`[MAIN] Ollama health: ${ollamaOnline ? 'online' : 'offline'} (${ollamaUrl})`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sadie:ollama-status', { online: ollamaOnline, url: ollamaUrl });
      }

      // Validate configured chatModel is actually installed — auto-switch if not
      if (ollamaOnline) {
        try {
          const currentSettings = getSettings();
          const configuredModel = currentSettings.chatModel || 'qwen2.5:7b';
          const tagsRes = await axios.get(`${ollamaUrl}/api/tags`, { timeout: 3000 });
          const installed: string[] = (tagsRes.data?.models || []).map((m: any) => m.name);
          if (!installed.includes(configuredModel)) {
            const preferred = ['qwen2.5:7b', 'mistral:latest', 'qwen2.5:3b', 'phi4-mini', 'llama3.2:3b'];
            const fallback = preferred.find(p => installed.includes(p)) || installed.find(n => !n.includes('embed') && !n.includes('moondream'));
            if (fallback && fallback !== configuredModel) {
              console.warn(`[MAIN] chatModel "${configuredModel}" not installed — switching to "${fallback}"`);
              saveSettings({ ...currentSettings, chatModel: fallback });
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('sadie:model-fallback', { from: configuredModel, to: fallback });
              }
            }
          }
        } catch (e) { console.error('[MAIN] Model validation error:', e); }
      }
    } catch (e) { console.error('[MAIN] Ollama health check error:', e); }

    // Ollama heartbeat — check every 30s and auto-restart if down.
    // Only notify renderer on state CHANGE to avoid toast spam.
    let lastOllamaOnline = ollamaOnline;
    let restartInFlight = false;
    const HEARTBEAT_INTERVAL = 30_000;
    setInterval(async () => {
      try {
        const ollamaUrl = (getSettings().ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
        await axios.get(`${ollamaUrl}/api/tags`, { timeout: 3000 });
        restartInFlight = false;
        if (!lastOllamaOnline) {
          lastOllamaOnline = true;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sadie:ollama-status', { online: true, url: ollamaUrl });
          }
        }
      } catch {
        if (lastOllamaOnline) {
          console.log('[MAIN] Ollama heartbeat: offline — attempting auto-restart');
          lastOllamaOnline = false;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sadie:ollama-status', { online: false, autoRestarting: true });
          }
        }
        if (!restartInFlight) {
          restartInFlight = true;
          try {
            const cmd = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
            const child = spawn(cmd, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
            child.on('error', () => { restartInFlight = false; });
            child.unref();
          } catch { restartInFlight = false; }
        }
      }
    }, HEARTBEAT_INTERVAL);

    // First-time hardware profile detection — runs only when no profile has been
    // set yet (i.e. fresh install or upgrade from an older version).
    // Silently applies model defaults that match the card's VRAM so 4 GB users
    // never accidentally pull dolphin-llama3:8b or llava at startup.
    try {
      const currentSettings = getSettings();
      if (!currentSettings.hardwareProfile) {
        const gpu = await detectGpuVram();
        if (gpu.vramGB !== null) {
          const profile = gpu.vramGB >= 16 ? '16gb+' : gpu.vramGB >= 8 ? '8gb' : '4gb';
          const patched = applyHardwareProfile({ ...currentSettings, hardwareProfile: profile });
          saveSettings(patched);
          console.log(`[MAIN] Hardware profile auto-set: ${profile} (${gpu.vramGB} GB VRAM, ${gpu.gpuName ?? 'unknown GPU'})`);
          // Let the renderer know so it can show a one-time toast
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sadie:hardware-profile-applied', {
              profile,
              vramGB: gpu.vramGB,
              gpuName: gpu.gpuName,
            });
          }
        }
      }
    } catch (e) { console.error('[MAIN] Hardware profile detection error:', e); }
  });

  // Register global hotkey to show/hide SADIE window
  try {
    const hotkey = settings.globalHotkey || settings.widgetHotkey || 'Ctrl+Shift+Space';
    const registered = globalShortcut.register(hotkey, () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    if (registered) {
      console.log(`[MAIN] Global hotkey registered: ${hotkey}`);
    } else {
      console.warn(`[MAIN] Failed to register global hotkey: ${hotkey}`);
    }
  } catch (e) {
    console.error('[MAIN] Global hotkey registration error:', e);
  }

  ipcMain.on('ping', () => console.log('pong'));

  // Auto-updater (skipped in E2E/test to avoid network calls)
  if (!isE2E && process.env.NODE_ENV !== 'test') {
    try {
      initAutoUpdater(mainWindow);
      ipcMain.on('sadie:download-update', () => downloadUpdate());
      ipcMain.on('sadie:install-update', () => installUpdate());
      console.log('[MAIN] Auto-updater initialized');
    } catch (e) {
      console.error('[MAIN] Auto-updater init error:', e);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  closeAllServiceWindows();
  shutdownMcpServers().catch(safeCatch);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
