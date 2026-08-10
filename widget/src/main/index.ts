// Main process for HomeBot - Full implementation
import { app, BrowserWindow, ipcMain, session, globalShortcut, protocol } from 'electron';

/** Catch handler for fire-and-forget ops — logs instead of silently swallowing */
function safeCatch(e: unknown) { console.error('[HomeBot-CATCH]', e); }

import { createMainWindow } from './window-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { registerMessageRouter } from './message-router';
import { initializeTools } from './tools';
import { getSettings, saveSettings, applyHardwareProfile, getAndClearConfigRecovery } from './config-manager';
import { isE2E } from './env';
import { detectGpuVram } from './moa';
import { ensureN8nRunning } from './n8n-lifecycle';
import { startSupervisorService, SupervisorServiceHandle } from './supervisor-service';
import { registerTrustIpc } from './trust-ipc';
import { registerTerminalIpc } from './terminal-ipc';
import { registerWorkspaceIpc } from './workspace-ipc';
import { startAssistantBridge, stopAssistantBridge } from './assistant-bridge';
import { setAssistantBridgeProvider } from './custom-llm-client';
import { requestConfirmationFrom } from './message-router';
// Static import, NOT a runtime require(). electron-vite bundles the main
// process into a single out/main/index.js, so a bare require('./morning-briefing')
// resolves to a file that does not exist at runtime — which silently disabled
// the startup briefing in every built app. See bundle-integrity.test.ts.
import { shouldOfferBriefing, markBriefingDelivered, generateBriefing } from './morning-briefing';
import { setBatchSummaryForwarder } from './tools';
import { initScheduler } from './scheduler';
import { restoreReminders } from './tools/reminder';
import { registerWebServicesHandlers, closeAllServiceWindows } from './web-services';
import { initAutoUpdater, downloadUpdate, installUpdate } from './auto-updater';
import { logStartupTime } from './utils/perf-logger';
import { installConsoleGate } from './utils/console-gate';
import { shutdownMcpServers } from './mcp-client';
import { DEFAULT_OLLAMA_URL } from '../shared/constants';
import axios from 'axios';
import { spawn } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let supervisorHandle: SupervisorServiceHandle | null = null;
function normalizeOllamaBaseUrl(raw?: string): string {
  const input = (raw || DEFAULT_OLLAMA_URL).trim();
  let withScheme = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  withScheme = withScheme.replace(/:\/\/localhost(:|\/|$)/i, '://127.0.0.1$1');
  try {
    const u = new URL(withScheme);
    u.pathname = u.pathname.replace(/\/api(?:\/tags)?\/?$/i, '');
    const base = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '');
    return base || DEFAULT_OLLAMA_URL;
  } catch {
    return DEFAULT_OLLAMA_URL;
  }
}

async function tryStartOllamaBackground(): Promise<void> {
  const candidates = process.platform === 'win32'
    ? [
        'ollama.exe',
        `${process.env.LOCALAPPDATA || ''}\\Programs\\Ollama\\ollama.exe`,
        `${process.env.ProgramFiles || 'C:\\Program Files'}\\Ollama\\ollama.exe`,
      ]
    : ['ollama'];

  for (const cmd of candidates) {
    if (!cmd) continue;
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const child = spawn(cmd, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
        let settled = false;
        child.once('error', () => {
          if (settled) return;
          settled = true;
          resolve(false);
        });
        child.unref();
        setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(true);
        }, 200);
      } catch {
        resolve(false);
      }
    });
    if (ok) return;
  }
}

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
(global as any).__HOMEBOT_MAIN_LOG_BUFFER ??= [];
function pushMainLog(line: string) {
  const buf = (global as any).__HOMEBOT_MAIN_LOG_BUFFER;
  buf.push(line);
  if (buf.length > MAX_MAIN_LOG_BUFFER) buf.splice(0, buf.length - MAX_MAIN_LOG_BUFFER);
}

// Apply a safe, idempotent ipcMain.handle patch (keeps behavior local and
// testable via `applyIpcHandlePatch`). See `src/main/utils/ipc-handle-patch.ts`.
import { applyIpcHandlePatch } from './utils/ipc-handle-patch';
// Static imports: electron-vite inlines these. A runtime require() of a
// relative path is emitted verbatim and dies as MODULE_NOT_FOUND in the build.
import { reloadSkills } from './skills';
import { seedSkills } from './skills-seed';
import { migrateLegacyUserDataIfNeeded } from './migrate-userdata';
import { registerBrowserPanelIpc, destroyBrowserPanel, captureBrowserPage } from './browser-panel';
import { setBrowserCaptureProvider } from './tools/vision';
applyIpcHandlePatch();

// E2E tests pass a custom userData directory via env var so Playwright doesn't
// need to use Chromium CLI flags that conflict with Node's option parser.
if (process.env.HOMEBOT_E2E_USER_DATA_DIR) {
  app.setPath('userData', process.env.HOMEBOT_E2E_USER_DATA_DIR);
}

// Register homebot-img scheme as privileged so it can load in <img> tags
protocol.registerSchemesAsPrivileged([
  { scheme: 'homebot-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// Remove the Chrome automation flag that Cloudflare and anti-bot systems
// (used by Claude, ChatGPT, Gemini) use as their primary detection signal.
// MUST be called before app.whenReady().
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

app.whenReady().then(async () => {
  // Silence verbose console.log/debug/info in packaged builds (warn/error kept;
  // set HOMEBOT_DEBUG_CONSOLE=1 to restore full output). Must run before the
  // startup logging below.
  installConsoleGate();
  console.log('[MAIN] App ready, initializing...');
  console.log('[MAIN] Env check: HOMEBOT_DIRECT_OLLAMA=', process.env.HOMEBOT_DIRECT_OLLAMA, 'isE2E=', isE2E);
  pushMainLog('[MAIN] App ready');

  // FIRST profile touch: rescue the pre-rename SADIE profile into this one.
  // Must run before anything reads or writes userData (settings, skills,
  // conversations), or the fresh profile's files win over the user's history.
  try {
    migrateLegacyUserDataIfNeeded();
  } catch (e) {
    console.error('[MAIN] Legacy profile migration failed (non-fatal):', e);
  }

  // Write the shipped skills into userData/skills on first run (never
  // overwrites), then load the catalogue so it is ready before the first
  // message builds a system prompt.
  try {
    const seeded = seedSkills();
    const skills = reloadSkills();
    console.log(`[MAIN] Skills: ${skills.length} loaded${seeded ? ` (${seeded} seeded)` : ''}`);
  } catch (e) {
    console.error('[MAIN] Skill loading failed (non-fatal):', e);
  }

  // Register custom protocol to serve generated images securely from sandbox
  const imgPath = require('path');
  const imgFs = require('fs');
  const imgDir = imgPath.join(app.getPath('userData'), 'generated-images');
  protocol.registerFileProtocol('homebot-img', (request, callback) => {
    const url = request.url.replace('homebot-img:///', '').replace('homebot-img://', '');
    const filename = decodeURIComponent(url);
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      callback({ statusCode: 403 } as any);
      return;
    }
    const filePath = imgPath.join(imgDir, filename);
    if (imgFs.existsSync(filePath)) {
      callback({ path: filePath });
    } else {
      callback({ statusCode: 404 } as any);
    }
  });

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

  // Browser side panel. Registered after the window exists because the view is
  // attached to it; getMainWindow is passed as a getter rather than the window
  // itself so a re-created window (macOS reactivate) still resolves.
  try {
    registerBrowserPanelIpc(() => getMainWindow());
    // Let the look_at_browser tool reach the panel without importing it —
    // a relative require there would not survive bundling.
    setBrowserCaptureProvider(() => captureBrowserPage());
  } catch (e) {
    console.error('[MAIN] Browser panel IPC registration failed (non-fatal):', e);
  }

  // ── Baseline perf metric: total startup time ──────────────────────────
  // Record ms from process spawn to the renderer being ready (first usable
  // UI). Persisted to userData/logs/perf.log via perf-logger. Guarded so a
  // logging failure can never affect launch.
  try {
    mainWindow.webContents.once('did-finish-load', () => {
      try {
        logStartupTime(Math.round(process.uptime() * 1000), { event: 'did-finish-load' });
      } catch (e) { safeCatch(e); }
      // One-time notice if getSettings() found an existing-but-corrupt
      // settings file and reset it to defaults (see config-manager.ts).
      try {
        const recovery = getAndClearConfigRecovery();
        if (recovery && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('homebot:config-recovered', recovery);
        }
      } catch (e) { safeCatch(e); }
    });
  } catch (e) { safeCatch(e); }

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
        mainWindow.webContents.send('homebot:n8n-status', { status });
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

  // Phase 0 reliability: continuous service supervision (probe + auto-recover).
  // Startup checks above are one-shot; this watches ollama/n8n/qdrant for the
  // whole session and self-heals n8n if it dies mid-run. No-ops in E2E mode.
  supervisorHandle = startSupervisorService({
    ollamaUrl: normalizeOllamaBaseUrl(settings.ollamaUrl),
    n8nUrl: resolvedN8nUrl,
    getWindow: () => mainWindow,
  });
  // Phase 2 trust layer: read-only IPC so the renderer can show live service
  // health and the CRM activity trail. Returns null status in E2E (handle is
  // a no-op there), which the panel renders as "supervision off".
  registerTrustIpc(() => supervisorHandle?.getStatus() ?? null);
  // Interactive Terminal panel. Shares the destructive-command blocklist and
  // home-directory sandbox with the LLM-facing terminal tool.
  registerTerminalIpc();
  // Explorer + code editor. Shares the home-directory sandbox with the
  // LLM-facing filesystem tools (validatePath), so the two can never diverge.
  registerWorkspaceIpc(() => getSettings()?.projectPath);

  // Assistant bridge: exposes HomeBot's permission-gated tools to Claude Code
  // over loopback MCP, so the subscription provider can act as a coding and
  // filing assistant without ever bypassing the confirmation modal.
  startAssistantBridge({
    requestConfirmation: async (message: string) => {
      // No window means no way to ask — refuse rather than assume consent.
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      return await requestConfirmationFrom(mainWindow.webContents, message);
    },
    onToolActivity: (info) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('homebot:assistant-tool-activity', info);
        }
      } catch (e) { safeCatch(e); }
    },
  }).then((bridge) => {
    // Hand the live endpoint to the LLM client via a hook rather than an import,
    // so the client never pulls the tool registry into its import chain.
    setAssistantBridgeProvider(() => ({ url: bridge.url, token: bridge.token }));
  }).catch((e) => console.error('[MAIN] assistant bridge failed to start:', e));
  // Batch transparency: forward every tool-batch summary to the renderer so
  // the Trust panel can show what ran (and what was blocked) in real time.
  setBatchSummaryForwarder((summary) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('homebot:batch-summary', summary);
      }
    } catch (e) {
      console.error('[HomeBot-CATCH]', e);
    }
  });
  registerMessageRouter(mainWindow, resolvedN8nUrl);
  // Expose a safe bridge so main-process router diagnostics can be pushed
  // into the renderer for E2E tracing and diagnostics. This is idempotent
  // and only used for tests/troubleshooting.
  try {
    (global as any).__HOMEBOT_PUSH_MAIN_LOG = (line: string) => {
      try {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('homebot:router-log', String(line));
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
      const ollamaUrl = normalizeOllamaBaseUrl(getSettings().ollamaUrl || 'http://127.0.0.1:11434');
      try {
        await axios.get(`${ollamaUrl}/api/tags`, { timeout: 3000 });
        ollamaOnline = true;
      } catch { /* not running */ }
      if (!ollamaOnline) {
        // Try to launch Ollama, then poll until it responds (it can take 5–15 s to bind).
        await tryStartOllamaBackground();
        const RETRY_DELAYS = [2000, 4000, 5000, 5000, 5000]; // up to ~21 s total
        for (const delay of RETRY_DELAYS) {
          await new Promise(r => setTimeout(r, delay));
          try {
            await axios.get(`${ollamaUrl}/api/tags`, { timeout: 4000 });
            ollamaOnline = true;
            // Notify renderer as soon as Ollama comes online mid-poll.
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('homebot:ollama-status', { online: true, url: ollamaUrl });
            }
            break;
          } catch { /* still starting */ }
        }
      }
      console.log(`[MAIN] Ollama health: ${ollamaOnline ? 'online' : 'offline'} (${ollamaUrl})`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('homebot:ollama-status', { online: ollamaOnline, url: ollamaUrl });
      }

      // Validate configured chatModel is actually installed — auto-switch if not
      if (ollamaOnline) {
        try {
          const currentSettings = getSettings();
          const configuredModel = currentSettings.chatModel || 'qwen2.5:7b';
          const tagsRes = await axios.get(`${ollamaUrl}/api/tags`, { timeout: 3000 });
          const installed: string[] = (tagsRes.data?.models || []).map((m: any) => m.name);
          if (!installed.includes(configuredModel)) {
            const preferred = ['qwen2.5:7b', 'gemma4:e4b', 'qwen2.5-coder:7b'];
            const fallback = preferred.find(p => installed.includes(p)) || installed.find(n => !n.includes('embed') && !n.includes('moondream'));
            if (fallback && fallback !== configuredModel) {
              console.warn(`[MAIN] chatModel "${configuredModel}" not installed — switching to "${fallback}"`);
              saveSettings({ ...currentSettings, chatModel: fallback });
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('homebot:model-fallback', { from: configuredModel, to: fallback });
              }
            }
          }
        } catch (e) { console.error('[MAIN] Model validation error:', e); }
      }
    } catch (e) { console.error('[MAIN] Ollama health check error:', e); }

    // ── Proactive Morning Briefing on startup ────────────────────────────
    // Fire the daily briefing as a chat message when the app opens, without
    // waiting for the user to type first. This is what makes HomeBot proactive.
    if (ollamaOnline && mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (shouldOfferBriefing()) {
          markBriefingDelivered();
          generateBriefing().then((briefing: string | null) => {
            if (briefing && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('homebot:proactive-briefing', { content: briefing });
              console.log('[MAIN] Proactive morning briefing delivered on startup');
            }
          }).catch((e: any) => console.error('[MAIN] Startup briefing error:', e?.message));
        }
      } catch (e) { console.error('[MAIN] Briefing init error:', e); }
    }

    // Ollama heartbeat — check every 30s and auto-restart if down.
    // Only notify renderer on state CHANGE to avoid toast spam.
    let lastOllamaOnline = ollamaOnline;
    let restartInFlight = false;
    const HEARTBEAT_INTERVAL = 30_000;
    setInterval(async () => {
      try {
        const ollamaUrl = normalizeOllamaBaseUrl(getSettings().ollamaUrl || 'http://127.0.0.1:11434');
        await axios.get(`${ollamaUrl}/api/tags`, { timeout: 3000 });
        restartInFlight = false;
        if (!lastOllamaOnline) {
          lastOllamaOnline = true;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('homebot:ollama-status', { online: true, url: ollamaUrl });
          }
        }
      } catch {
        if (lastOllamaOnline) {
          console.log('[MAIN] Ollama heartbeat: offline — attempting auto-restart');
          lastOllamaOnline = false;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('homebot:ollama-status', { online: false, autoRestarting: true });
          }
        }
        if (!restartInFlight) {
          restartInFlight = true;
          try {
            await tryStartOllamaBackground();
          } catch { }
          restartInFlight = false;
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
            mainWindow.webContents.send('homebot:hardware-profile-applied', {
              profile,
              vramGB: gpu.vramGB,
              gpuName: gpu.gpuName,
            });
          }
        }
      }
    } catch (e) { console.error('[MAIN] Hardware profile detection error:', e); }
  });

  // Register global hotkey to show/hide HomeBot window
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
      ipcMain.on('homebot:download-update', () => downloadUpdate());
      ipcMain.on('homebot:install-update', () => installUpdate());
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
  try { stopAssistantBridge(); } catch (e) { safeCatch(e); }
  try { destroyBrowserPanel(); } catch (e) { safeCatch(e); }
  globalShortcut.unregisterAll();
  closeAllServiceWindows();
  if (supervisorHandle) supervisorHandle.stop();
  shutdownMcpServers().catch(safeCatch);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
