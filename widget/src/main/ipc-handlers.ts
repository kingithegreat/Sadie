import { ipcMain, BrowserWindow, app, shell, dialog } from 'electron';
import { getMainWindow, toggleWidgetMode, getWidgetMode } from './window-manager';
import { readPerfAggregates, readPerfHistory } from './utils/perf-logger';

/** Catch handler for fire-and-forget ops — logs instead of silently swallowing */
function safeCatch(e: unknown) { console.error('[HomeBot-CATCH]', e); }

import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { reloadSkills, skillsDir, type Skill } from './skills';
import { listChanges, getChange } from './file-change-log';
import { diffText, toHunks } from '../../../src/diff/line-diff';
import * as os from 'os';
import * as https from 'https';
import { spawn, execFile } from 'child_process';
import { saveGeneratedImage } from './generated-images';

// ── Timeout constants (ms) ─────────────────────────────────────────────────
const HEALTH_CHECK_TIMEOUT = 2000;
const OLLAMA_OP_TIMEOUT = 30_000;
const OLLAMA_PULL_TIMEOUT = 600_000;
const SPEECH_RECOGNITION_TIMEOUT = 20_000;
const OLLAMA_READY_POLL_TIMEOUT = 1500;

import {
  getSettings, 
  saveSettings, 
  assertPermission, 
  getSettingsPath, 
  resetPermissions, 
  exportTelemetryConsent,
  getDefaultSettings
} from './config-manager';
import { fetchAvailableCustomModels, generateFromCustomLLM } from './custom-llm-client';
import { fetchPageContentHandler } from './tools/browser';
import { setSearxngUrl, setTavilyApiKey, setSerperApiKey, setStableHordeApiKey, webToolHandlers, getSDCppDir, findSDCppBinary, findSDCppModel } from './tools/web';
import { ragToolHandlers } from './tools/rag';
import { setUncensoredMode, getUncensoredMode as routerGetUncensoredMode, ensureHydrated, clearHistory, resyncHistoryFromStore } from './message-router';
import { getAllToolDefinitions, executeTool, getFocusedOllamaTools, registerTool } from './tools/index';
import { registerAutomationRunner, registerAutomationTierProvider } from './tools/automation';
import type { ToolContext } from './tools/index';
import { detectGpuVram, recommendConfig } from './moa';
import { speakHandler, stopSpeakingHandler } from './tools/voice';
import { listJobs, addJob, removeJob, toggleJob } from './scheduler';
import { readPermissionAudit, clearPermissionAudit, exportPermissionAudit } from './permission-audit-log';
import {
  loadMcpConfig,
  saveMcpConfig,
  getMcpStatus,
  connectSingleServer,
  type McpServerConfig
} from './mcp-client';
import {
  MemoryManager,
  StoredConversation,
  ConversationSearchResult,
} from './memory-manager';
import { Message } from '../shared/types';
import { resolveCloudLLM, describeActiveModel } from '../shared/cloud-llm';
import { DEFAULT_OLLAMA_URL } from '../shared/constants';
import { isDevelopment, isDemoMode } from './env';
import { resolveWithinHome } from './utils/path-guard';
import { sanitizeImportedSettings, analyzeImportedEndpoints, stripImportedSettings } from './utils/settings-import';
import { homebotWebhookHeaders } from './webhook-auth';
import { logTelemetryEvent, readToolCallAggregates } from './utils/logger';
import { createAndActivateWorkflow, deleteWorkflow, ensureWebFetchWorkflow, registerN8nConnectionProvider, verifyN8nConnection } from './n8n-api';
import { gatedAutomationHandler } from '../../../src/handlers/automationCenter';
import { buildAvoidClause, fillQuiz } from '../../../src/quiz/generate';
import {
  getCurrentTier,
  getLicenseStatus,
  activateLicense,
  validateLicense,
  deactivateLicense,
} from './licensing';

function normalizeOllamaBaseUrl(raw?: string): string {
  const input = (raw || DEFAULT_OLLAMA_URL).trim();
  let withScheme = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  // Replace localhost with 127.0.0.1 because Ollama on Windows binds to IPv4 127.0.0.1
  // and Node.js >= 17 prefers IPv6 (::1), causing ECONNREFUSED or timeouts.
  withScheme = withScheme.replace(/:\/\/localhost(:|\/|$)/i, '://127.0.0.1$1');
  try {
    const u = new URL(withScheme);
    // Users sometimes paste /api or /api/tags into settings; normalize to host root.
    u.pathname = u.pathname.replace(/\/api(?:\/tags)?\/?$/i, '');
    const base = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '');
    return base || DEFAULT_OLLAMA_URL;
  } catch {
    return DEFAULT_OLLAMA_URL;
  }
}

function getConfiguredOllamaBaseUrl(): string {
  const settings = getSettings();
  return normalizeOllamaBaseUrl(process.env.OLLAMA_URL || settings.ollamaUrl || DEFAULT_OLLAMA_URL);
}

async function launchOllamaServe(): Promise<{ started: boolean; error?: string }> {
  const candidates = process.platform === 'win32'
    ? [
        'ollama.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe'),
      ]
    : ['ollama'];

  for (const cmd of candidates) {
    if (!cmd) continue;
    const outcome = await new Promise<{ ok: boolean; notFound: boolean; message?: string }>((resolve) => {
      try {
        const child = spawn(cmd, ['serve'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        let settled = false;
        child.once('error', (err: any) => {
          if (settled) return;
          settled = true;
          resolve({ ok: false, notFound: err?.code === 'ENOENT', message: String(err?.message || err) });
        });
        child.unref();
        setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve({ ok: true, notFound: false });
        }, 200);
      } catch (e: any) {
        resolve({ ok: false, notFound: true, message: String(e?.message || e) });
      }
    });

    if (outcome.ok) return { started: true };
    if (!outcome.notFound) return { started: false, error: outcome.message || 'Failed to start Ollama.' };
  }

  return {
    started: false,
    error: 'Ollama executable not found. Install from https://ollama.com/download or add it to PATH.',
  };
}


/**
 * Register all IPC handlers for communication between renderer and main process
 */
export function registerIpcHandlers(mainWindow?: BrowserWindow): void {
    // Idempotency guard: prevent duplicate registrations which Electron disallows.
    // Handlers should be registered before any BrowserWindow exists to satisfy
    // early renderer invokes during startup without races.
    // Note: we store a flag on the global to persist across reloads in dev.
    const g = global as any;
    if (g.__homebot_ipc_registered) {
      // Only log idempotent registration warnings in development
      if (isDevelopment) {
        console.log('[IPC] registerIpcHandlers already executed — skipping');
        try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push('[MAIN] registerIpcHandlers already executed — skipping'); } catch (e) { safeCatch(e); }
      }
      return;
    }
    // Align runtime uncensored flag with persisted settings at startup
    try {
      const initialSettings = getSettings();
      setUncensoredMode(!!initialSettings.uncensoredMode);
    } catch (e) {
      console.error('[IPC] Failed to hydrate uncensored mode from settings:', (e as any)?.message || e);
    }

    // Health check: verify n8n and Ollama statuses
    ipcMain.handle('homebot:check-connection', async () => {
      const settings = getSettings();
      const n8nBase = settings.n8nUrl || 'http://localhost:5678';
      const n8nHealth = `${n8nBase.replace(/\/$/, '')}/healthz`;
      const result = { n8n: 'checking', ollama: 'checking', lastChecked: new Date().toISOString() } as any;
      try {
        const r = await axios.get(n8nHealth, { timeout: HEALTH_CHECK_TIMEOUT });
        if (r && r.status && r.status >= 200 && r.status < 300) {
          result.n8n = 'online';
          ensureWebFetchWorkflow().catch(e => console.log('[WebFetch] n8n workflow deploy skipped:', e?.message));
        }
        else result.n8n = 'offline';
      } catch (e) {
        result.n8n = 'offline';
      }

      try {
        // Ollama may not expose /healthz; a simple GET on base URL will suffice for a quick check
        const ollamaBase = getConfiguredOllamaBaseUrl();
        const r2 = await axios.get(ollamaBase, { timeout: HEALTH_CHECK_TIMEOUT });
        result.ollama = (r2 && r2.status && r2.status >= 200 && r2.status < 500) ? 'online' : 'offline';
      } catch (e) {
        result.ollama = 'offline';
      }

      result.lastChecked = new Date().toISOString();
      return result as { n8n: 'online'|'offline'|'checking'; ollama: 'online'|'offline'|'checking'; lastChecked: string };
    });

    // Uncensored Mode Handlers
    ipcMain.handle('homebot:get-uncensored-mode', async () => {
      try {
        return { enabled: routerGetUncensoredMode() };
      } catch (e) {
        const settings = getSettings();
        return { enabled: !!settings.uncensoredMode };
      }
    });

    ipcMain.handle('homebot:set-uncensored-mode', async (_event, enabled: boolean) => {
      const settings = getSettings();
      settings.uncensoredMode = enabled;
      saveSettings(settings); // This function is already imported from config-manager
      try { setUncensoredMode(enabled); } catch (e) { console.error('[IPC] Failed to set uncensored mode runtime flag:', (e as any)?.message || e); }
      return { success: true, enabled: settings.uncensoredMode };
    });

    // Baseline perf metrics (startup + first-token/TTFT aggregates) for the Diagnostics & Performance UI
    ipcMain.handle('homebot:get-perf-aggregates', async () => {
      try {
        return readPerfAggregates();
      } catch (e) {
        console.error('[IPC] get-perf-aggregates failed:', (e as any)?.message || e);
        const empty = { count: 0, avg_ms: 0, p50_ms: 0, p95_ms: 0, min_ms: 0, max_ms: 0, last_ms: null };
        return { startup: empty, firstToken: { ...empty } };
      }
    });

    // Raw recent samples (chronological) for the Diagnostics trend sparklines
    ipcMain.handle('homebot:get-perf-history', async (_evt, limit?: number) => {
      try {
        return readPerfHistory(typeof limit === 'number' ? limit : 20);
      } catch (e) {
        console.error('[IPC] get-perf-history failed:', (e as any)?.message || e);
        return { startup: [], firstToken: [] };
      }
    });

    ipcMain.on('window-minimize', () => {
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.minimize();
      }
    });

    ipcMain.on('window-maximize', () => {
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      }
    });

    ipcMain.on('window-close', () => {
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.close();
      }
    });

    ipcMain.handle('homebot:toggle-widget-mode', () => {
      return toggleWidgetMode();
    });

    ipcMain.handle('homebot:get-widget-mode', () => {
      return getWidgetMode();
    });

    ipcMain.on('homebot:set-always-on-top', (_event, value: boolean) => {
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(value);
      }
    });
  
  /**
   * Handle message from renderer → forward to n8n orchestrator
   */
  ipcMain.on('homebot:message', async (_event, { message, conversationId }) => {
    try {
      console.log('[Main] Received sendMessage', { conversationId, preview: String(message).substring(0,120) });
      try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push(`[MAIN] Received sendMessage conv=${conversationId} preview=${String(message).substring(0,120)}`); } catch (e) { safeCatch(e); }
          // Load settings to get n8n URL
          const settings = getSettings();
      console.log('[Main] Calling messageRouter.sendStreamRequest (via axios post)');
      try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push('[MAIN] Calling messageRouter.sendStreamRequest (via axios post)'); } catch (e) { safeCatch(e); }

      // Send message to n8n orchestrator
      const response = await axios.post(`${settings.n8nUrl}/webhook/homebot/chat`, {
        user_id: 'desktop-user',
        conversation_id: conversationId || 'default',
        message: message,
        timestamp: new Date().toISOString()
      }, {
        timeout: OLLAMA_OP_TIMEOUT,
        headers: homebotWebhookHeaders()
      });

      // Send response back to renderer
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('homebot:reply', {
        success: true,
        data: response.data
        });
      }
      console.log('[Main] sendStreamRequest returned', { status: response.status });
      try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER?.push(`[MAIN] sendStreamRequest returned status=${response.status}`); } catch (e) { safeCatch(e); }

    } catch (err: any) {
      console.error('Error communicating with n8n orchestrator:', err.message);
      
      // Send error response back to renderer
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('homebot:reply', {
          success: false,
          error: true,
          message: 'HomeBot could not reach the orchestrator.',
          details: err.message,
          response: 'I\'m having trouble connecting to my backend. Please make sure n8n is running.'
        });
      }
    }
  });

  // Image generation panel: delegates to the same tool handler used in chat
  // Pro-gated (imageGen) — free users get a structured upgrade_required response.
  ipcMain.handle('homebot:automation:image:generate', gatedAutomationHandler(
    'homebot:automation:image:generate',
    getCurrentTier,
    async (_event, { payload }) => {
    const rawPrompt = String(payload?.prompt || '').trim();
    // Parse resolution string (e.g. '512x512') into width/height
    let width = 512, height = 512;
    const resParts = String(payload?.resolution || '').match(/^(\d+)x(\d+)$/);
    if (resParts) {
      width = Math.min(2048, Math.max(128, Number(resParts[1])));
      height = Math.min(2048, Math.max(128, Number(resParts[2])));
    } else if (payload?.width) {
      width = Math.min(2048, Math.max(128, Number(payload.width) || 512));
      height = Math.min(2048, Math.max(128, Number(payload.height) || 512));
    }
    const steps = Math.min(150, Math.max(1, Number(payload?.steps) || 20));
    const backend = payload?.backend || 'hybrid';

    // Incorporate style into prompt
    const styleMap: Record<string, string> = {
      realistic: 'photorealistic, highly detailed, 8k,',
      artistic: 'artistic, painterly, expressive brushstrokes,',
      cartoon: 'cartoon style, bold outlines, vibrant colors,',
      anime: 'anime style, cel shaded, detailed anime art,',
    };
    const stylePrefix = styleMap[payload?.style] || '';
    const prompt = stylePrefix ? `${stylePrefix} ${rawPrompt}` : rawPrompt;

    if (!prompt) {
      return { status: 'failure', timestamp: new Date().toISOString(), operation: 'image_generate', source: null, image: null, metadata: { prompt }, validation: { validated: false }, error: { message: 'Prompt is required', code: 'INVALID_INPUT' } };
    }

    try {
      const toolResult = await webToolHandlers['image_generate'](
        { prompt, width, height, steps, backend },
        { executionId: `img-panel-${Date.now()}` } as any
      );

      if (toolResult.success && toolResult.result?.image_base64) {
        // Rung 1 of the image-edit ladder: the result must be durable. The
        // chat path has always written here; the panel used to keep the image
        // in React state only, so Clear or closing the panel destroyed it.
        const imgDir = path.join(app.getPath('userData'), 'generated-images');
        const filename = saveGeneratedImage(toolResult.result.image_base64, imgDir);
        return {
          status: 'success',
          timestamp: new Date().toISOString(),
          operation: 'image_generate',
          source: toolResult.result.source || 'unknown',
          image: toolResult.result.image_base64,
          filename,
          savedPath: filename ? path.join(imgDir, filename) : null,
          metadata: { prompt, width, height, steps, seed: '', model: toolResult.result.source || '' },
          validation: { validated: true },
          error: { message: '', code: '' }
        };
      }

      return {
        status: 'failure',
        timestamp: new Date().toISOString(),
        operation: 'image_generate',
        source: null,
        image: null,
        metadata: { prompt, width, height, steps },
        validation: { validated: false },
        error: {
          message: toolResult.error || 'Image generation failed',
          code: 'GENERATION_FAILED'
        }
      };
    } catch (err: any) {
      return {
        status: 'failure',
        timestamp: new Date().toISOString(),
        operation: 'image_generate',
        source: null,
        image: null,
        metadata: { prompt, width, height, steps },
        validation: { validated: false },
        error: {
          message: err.message || 'Unexpected error during image generation',
          code: 'INTERNAL_ERROR'
        }
      };
    }
  }));

  // sd-cpp local image generation status & setup
  ipcMain.handle('homebot:sd-cpp:status', async () => {
    const dir = getSDCppDir();
    const binary = findSDCppBinary();
    const model = findSDCppModel();
    return {
      ready: !!(binary && model),
      hasBinary: !!binary,
      hasModel: !!model,
      dir,
      modelsDir: require('path').join(dir, 'models'),
    };
  });

  // One-click setup: downloads the engine and a model itself, streaming
  // progress to the renderer. The manual homebot:sd-cpp:setup below remains as
  // the fallback ("Show me how") and for anyone who prefers their own model.
  ipcMain.handle('homebot:sd-cpp:auto-setup', async (e) => {
    const { runAutoSetup, isSetupRunning } = await import('./sd-cpp-setup');
    if (isSetupRunning()) return { success: false, error: 'Setup is already running.' };
    try {
      const message = await runAutoSetup((p) => {
        try { e.sender.send('homebot:sd-cpp:setup-progress', p); } catch { /* window gone */ }
      });
      return { success: true, message };
    } catch (err: any) {
      const msg = err?.message || 'Setup failed.';
      try { e.sender.send('homebot:sd-cpp:setup-progress', { phase: 'error', note: msg }); } catch {}
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('homebot:sd-cpp:setup', async () => {
    const dir = getSDCppDir();
    const modelsDir = require('path').join(dir, 'models');
    const fs = require('fs');

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });

    const binary = findSDCppBinary();
    const model = findSDCppModel();

    if (binary && model) return { success: true, message: 'Already set up and ready.' };

    const instructions: string[] = [];
    if (!binary) {
      instructions.push(
        `Download the file ending in "win-cpu-x64.zip" from: https://github.com/leejet/stable-diffusion.cpp/releases`,
        `Unzip ALL of it (sd-cli.exe needs the .dll files beside it) into: ${dir}`
      );
    }
    if (!model) {
      instructions.push(
        `Download a GGUF model from: https://huggingface.co/leejet/FLUX.1-schnell-GGUF (fast) or https://huggingface.co/second-state/stable-diffusion-v1-5-GGUF (classic)`,
        `Place the .gguf file into: ${modelsDir}`
      );
    }

    // Open the sd-cpp directory so user can drop files in
    try { require('electron').shell.openPath(dir); } catch {}

    return {
      success: false,
      message: 'Local image generation setup needed.',
      instructions,
      dir,
      modelsDir,
    };
  });

  /**
   * Get user settings from file
   */
  ipcMain.handle('homebot:get-settings', async () => {
    try {
      return getSettings();
    } catch (err: any) {
      console.error('Error loading settings:', err.message);
      return getDefaultSettings();
    }
  });

  ipcMain.handle('homebot:list-custom-llm-models', async (_event, payload) => {
    try {
      console.log('[IPC] Fetching custom LLM models with config:', {
        apiUrl: payload?.apiUrl,
        provider: payload?.provider,
        hasApiKey: !!payload?.apiKey
      });
      
      // Claude Code runs as a LOCAL CLI — there is no endpoint, so there is no
      // apiUrl to demand or validate. Its optional apiUrl is a path to the
      // executable, not a URL, and would fail the protocol check below.
      // fetchAvailableCustomModels already special-cases it; this guard ran
      // first and rejected Connect with "API URL is required".
      // codex is the same shape as claude-code: a CLI, not an endpoint.
      if (payload?.provider !== 'claude-code' && payload?.provider !== 'codex') {
        if (!payload?.apiUrl) {
          return { success: false, error: 'API URL is required' };
        }

        // Validate URL protocol to prevent non-HTTP SSRF (file://, ftp://, etc.)
        try {
          const parsed = new URL(payload.apiUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { success: false, error: 'Only HTTP and HTTPS URLs are allowed' };
          }
        } catch {
          return { success: false, error: 'Invalid URL format' };
        }
      }

      const models = await fetchAvailableCustomModels(payload || {});
      console.log('[IPC] Successfully fetched', models.length, 'models');
      return { success: true, models };
    } catch (err: any) {
      console.error('[IPC] Failed to fetch custom LLM models:', err?.message || err);
      return { success: false, error: err?.message || 'Unable to fetch models' };
    }
  });

  // Check a single permission for a given tool (used by renderer to hide/disable UI)
  ipcMain.handle('homebot:has-permission', async (_event, toolName: string) => {
    try {
      const allowed = assertPermission(toolName);
      return { success: true, allowed };
    } catch (err: any) {
      console.error('Error checking permission:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Save user settings to file
   */
  ipcMain.handle('homebot:save-settings', async (_event, settings) => {
    try {
      const prev = getSettings();
      const merged = { ...prev, ...settings };
      saveSettings(merged);

      // Track model changes
      if (merged.chatModel && merged.chatModel !== prev.chatModel) {
        try { logTelemetryEvent('model_switch', { from: prev.chatModel, to: merged.chatModel }); } catch (_e) {}
      }

      // Refresh search API keys in memory
      setSearxngUrl((merged as any).searxngUrl || null);
      setTavilyApiKey(merged.tavilyApiKey || null);
      setSerperApiKey(merged.serperApiKey || null);
      setStableHordeApiKey(merged.stableHordeApiKey || null);

      return { success: true, data: merged };
    } catch (err: any) {
      console.error('Error saving settings:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get the absolute path to the config file (for E2E testing)
   */
  ipcMain.handle('homebot:get-config-path', async () => {
    return getSettingsPath();
  });

  ipcMain.handle('homebot:get-generated-image', async (_event, filename: string) => {
    try {
      const path = require('path');
      const fs = require('fs');
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) return null;
      const filePath = path.join(app.getPath('userData'), 'generated-images', filename);
      if (!fs.existsSync(filePath)) return null;
      const buf = fs.readFileSync(filePath);
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
      const mime = isJpeg ? 'image/jpeg' : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch { return null; }
  });

  ipcMain.handle('homebot:get-env', async () => {
    return {
      isE2E: !!process.env.HOMEBOT_E2E,
      isPackagedBuild: app.isPackaged,
      isReleaseBuild: app.isPackaged,
      userDataPath: app.getPath('userData')
    };
  });

  ipcMain.handle('homebot:reset-permissions', async () => {
    try {
      const updated = resetPermissions();
      return { success: true, data: updated };
    } catch (err: any) {
      console.error('Error resetting permissions:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('homebot:export-consent', async () => {
    try {
      const result = exportTelemetryConsent();
      return result;
    } catch (err: any) {
      console.error('Error exporting telemetry consent:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── Fetch web page content (called from Web Browser panel) ──
  // Try n8n first (it runs in Docker and can fetch any URL), fall back to local
  ipcMain.handle('homebot:fetch-page-content', async (_event, url: string) => {
    try {
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'url is required' };
      }

      // Try n8n webhook route first
      try {
        const settings = getSettings();
        const n8nBase = (settings.n8nUrl || 'http://localhost:5678').replace(/\/$/, '');
        const webhookUrl = `${n8nBase}/webhook/homebot/web-fetch`;

        console.log('[WebFetch] Trying n8n webhook:', webhookUrl);
        const n8nRes = await axios.post(webhookUrl, { url, max_length: 20000 }, {
          timeout: 30_000,
          headers: homebotWebhookHeaders()
        });

        if (n8nRes.data?.success) {
          console.log('[WebFetch] n8n returned content:', (n8nRes.data.content?.length || 0), 'chars');
          return n8nRes.data;
        }
        console.log('[WebFetch] n8n returned non-success, falling back to local');
      } catch (n8nErr: any) {
        console.log('[WebFetch] n8n unavailable, falling back to local:', n8nErr?.message);
      }

      // Local fallback
      return await fetchPageContentHandler({ url, max_length: 20000 }, { executionId: `web-fetch-${Date.now()}` });
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // ── RAG: index a local file or web content ──
  ipcMain.handle('homebot:rag-index', async (_event, filePath: string, content?: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'filePath is required' };
      }
      if (content && typeof content === 'string') {
        const result = await ragToolHandlers.rag_index({ path: filePath, web_content: content }, {} as any);
        return result;
      }
      const result = await ragToolHandlers.rag_index({ path: filePath }, {} as any);
      return result;
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // ── RAG: list all indexed documents ──
  ipcMain.handle('homebot:rag-list', async () => {
    try {
      return await ragToolHandlers.rag_list({}, {} as any);
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // ── RAG: remove a document from the index ──
  ipcMain.handle('homebot:rag-clear', async (_event, docId: string) => {
    try {
      if (!docId || typeof docId !== 'string') {
        return { success: false, error: 'doc_id is required' };
      }
      return await ragToolHandlers.rag_clear({ doc_id: docId }, {} as any);
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('homebot:list-tools', async () => {
    try {
      const tools = getAllToolDefinitions().map(t => ({
        name: t.name,
        description: t.description,
        category: t.category || 'utility',
      }));
      return { success: true, tools };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Export chat history as markdown, DOCX, or PDF
  ipcMain.handle('homebot:export-chat', async (_event, markdown: string, format?: string) => {
    try {
      const desktop = app.getPath('desktop');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

      if (format === 'docx') {
        const { Document: Doc, Packer: Pack, Paragraph: Para, TextRun: TR, HeadingLevel: HL } = await import('docx');
        const paragraphs: any[] = [];
        for (const line of markdown.split('\n')) {
          if (line.startsWith('# ')) {
            paragraphs.push(new Para({ text: line.slice(2), heading: HL.HEADING_1 }));
          } else if (line.startsWith('### ')) {
            paragraphs.push(new Para({ children: [new TR({ text: line.slice(4), bold: true, size: 24 })] }));
          } else if (line === '---') {
            paragraphs.push(new Para({ text: '' }));
          } else {
            paragraphs.push(new Para({ text: line }));
          }
        }
        const doc = new Doc({ sections: [{ children: paragraphs }] });
        const buf = Buffer.from(await Pack.toBuffer(doc));
        const filePath = path.join(desktop, `homebot-chat-${ts}.docx`);
        fs.writeFileSync(filePath, buf);
        return { success: true, path: filePath };
      }

      if (format === 'pdf') {
        const PDFDoc = (await import('pdfkit')).default;
        const buf: Buffer = await new Promise((resolve, reject) => {
          const doc = new PDFDoc({ margin: 50 });
          const chunks: Buffer[] = [];
          doc.on('data', (c: Buffer) => chunks.push(c));
          doc.on('end', () => resolve(Buffer.concat(chunks)));
          doc.on('error', reject);
          for (const line of markdown.split('\n')) {
            if (line.startsWith('# ')) {
              doc.fontSize(20).font('Helvetica-Bold').text(line.slice(2));
              doc.moveDown(0.3);
            } else if (line.startsWith('### ')) {
              doc.fontSize(12).font('Helvetica-Bold').text(line.slice(4));
              doc.moveDown(0.2);
            } else if (line === '---') {
              doc.moveDown(0.3);
            } else {
              doc.fontSize(10).font('Helvetica').text(line, { lineGap: 2 });
            }
          }
          doc.end();
        });
        const filePath = path.join(desktop, `homebot-chat-${ts}.pdf`);
        fs.writeFileSync(filePath, buf);
        return { success: true, path: filePath };
      }

      const filePath = path.join(desktop, `homebot-chat-${ts}.md`);
      fs.writeFileSync(filePath, markdown, 'utf-8');
      return { success: true, path: filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // E2E ping helper - used by tests to ensure main is responsive
  ipcMain.handle('homebot:__e2e_ping', async () => {
    try { (global as any).__HOMEBOT_ROUTER_LOG_BUFFER = (global as any).__HOMEBOT_ROUTER_LOG_BUFFER || []; (global as any).__HOMEBOT_ROUTER_LOG_BUFFER.push('[E2E] ping'); } catch (e) { safeCatch(e); }
    return { ok: true };
  });

  // Expose current app mode (demo or normal)
  ipcMain.handle('homebot:get-mode', async () => {
    return { demo: !!isDemoMode };
  });

  // GPU VRAM detection and hardware-aware model recommendations
  ipcMain.handle('homebot:detect-gpu-vram', async () => {
    try {
      const gpu = await detectGpuVram();
      const config = gpu.vramGB ? recommendConfig(gpu.vramGB) : null;
      return {
        success: true,
        vramGB: gpu.vramGB,
        gpuName: gpu.gpuName,
        method: gpu.method,
        recommendation: config ? {
          mode: config.mode,
          preset: config.preset ?? null,
          model: config.model ?? null,
          reason: config.reason,
        } : null,
      };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });


  // ── Media Studio ──────────────────────────────────────────────────────────
  // The renderer drives the pipeline through the same state machine the chat
  // tools use, so the approval gate cannot be bypassed by going via the UI.
  ipcMain.handle('homebot:media:list', async () => {
    const { readJobs } = await import('./tools/media');
    return readJobs();
  });

  // List a podcast feed's episodes so the panel can offer "make a recap of
  // this one". Read-only: nothing is created until the user picks an episode,
  // which then goes through the ordinary homebot:media:create path — a
  // feed-sourced video faces the same approval gate as everything else.
  ipcMain.handle('homebot:media:parse-feed', async (_e, url: string) => {
    const { fetchFeedXml, parsePodcastFeed } = await import('./podcast-feed');
    try {
      const xml = await fetchFeedXml(String(url || ''));
      const feed = parsePodcastFeed(xml, 10);
      return { ok: true, feed };
    } catch (e: any) {
      // parse/fetch errors here are already written for a person; pass through.
      const msg = e?.code === 'ECONNABORTED'
        ? 'That feed took too long to answer. Check the link, or try again in a minute.'
        : (e?.message || 'Could not read that feed.');
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('homebot:media:create', async (_e, input: any) => {
    const { readJobs, writeJobs } = await import('./tools/media');
    const { createJob } = await import('./media-studio');
    try {
      const job = createJob({
        title: String(input?.title || ''),
        format: input?.format === 'long' ? 'long' : 'short',
        brief: input?.brief ? String(input.brief) : undefined,
      });
      writeJobs([...readJobs(), job]);
      return { ok: true, job };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  /** Shared by advance/approve/reject so the transition rules live in one place. */
  const applyMediaTransition = async (
    id: string, to: string, opts: { humanDecision?: boolean; note?: string; by: string },
  ) => {
    const { readJobs, writeJobs } = await import('./tools/media');
    const { transition, isValidState } = await import('./media-studio');
    const { getSettings } = await import('./config-manager');
    // Same kill switch as the chat path — the panel must not be a way around it.
    const publishingEnabled = !!(getSettings() as any)?.mediaPublishingEnabled;
    const jobs = readJobs();
    const i = jobs.findIndex(j => j.id === id);
    if (i < 0) return { ok: false, error: 'That video is no longer in the list.' };
    if (!isValidState(to)) return { ok: false, error: `"${to}" is not a pipeline stage.` };
    try {
      jobs[i] = transition(jobs[i], to as any, { ...opts, publishingEnabled });
      writeJobs(jobs);
      return { ok: true, job: jobs[i] };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  };

  // Run a long stage (script, narration) from the panel.
  //
  // These take 30-60s on a local model. Without a way to start them from the
  // UI the panel could only shuffle states, so the user pressed a button, saw
  // a state change, and had no idea whether any work had happened.
  ipcMain.handle('homebot:media:run', async (_e, id: string, action: string, opts?: { voice?: string }) => {
    const { mediaToolHandlers, readJobs } = await import('./tools/media');
    const job = readJobs().find(j => j.id === id);
    if (!job) return { ok: false, error: 'That video is no longer in the list.' };

    // 'render' was missing here, which made rendering chat-only: the panel
    // could write a script and record narration, then had no button for the
    // one step that actually produces the video. A panel-first workflow that
    // dead-ends before the deliverable is not a workflow.
    const tool = action === 'render' ? 'media_render'
      : action === 'narrate' ? 'media_narrate'
      : 'media_write_script';
    try {
      const args: Record<string, unknown> = { job: job.id };
      if (action === 'narrate' && opts?.voice) args.voice = opts.voice;
      const res: any = await mediaToolHandlers[tool](args, { executionId: `panel-${action}` } as any);
      return res?.success
        ? { ok: true, message: String(res.result ?? '') }
        : { ok: false, error: String(res?.error ?? 'That stage failed.') };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('homebot:media:advance', async (_e, id: string, to: string, note?: string) =>
    applyMediaTransition(id, to, { by: 'studio', note }));

  ipcMain.handle('homebot:media:approve', async (_e, id: string, note?: string) =>
    applyMediaTransition(id, 'approved', { by: 'human', humanDecision: true, note }));

  ipcMain.handle('homebot:media:reject', async (_e, id: string, revise: boolean, note?: string) =>
    applyMediaTransition(id, revise ? 'needs_revision' : 'rejected', { by: 'human', humanDecision: true, note }));

  // Is the video engine available, and did HomeBot install it?
  //
  // Reports `ready` from actually running the binary, not from the file being
  // present — the two came apart for sd.cpp when a rename left an exe that
  // existed and could not be used.
  ipcMain.handle('homebot:media:ffmpeg-status', async () => {
    const { findFfmpeg } = await import('./media-render');
    const { findManagedFfmpeg, isFfmpegSetupRunning } = await import('./ffmpeg-setup');
    const managed = findManagedFfmpeg();
    const found = await findFfmpeg(managed);
    return {
      ready: !!found,
      path: found,
      managed: !!found && found === managed,
      running: isFfmpegSetupRunning(),
      supported: process.platform === 'win32',
    };
  });

  // Download and unpack the video engine, streaming progress to the panel.
  //
  // The old copy told a non-technical user to run `winget install Gyan.FFmpeg`.
  // This is the same answer `sd-cpp-setup` gave for local image generation:
  // do it for them, and say what is happening while it runs.
  ipcMain.handle('homebot:media:ffmpeg-setup', async (e) => {
    const { runFfmpegSetup } = await import('./ffmpeg-setup');
    const send = (p: any) => {
      try { e.sender.send('homebot:media:ffmpeg-progress', p); } catch { /* window closed mid-download */ }
    };
    try {
      const bin = await runFfmpegSetup(send);
      return { ok: true, path: bin, message: 'Ready — videos can now be made on this PC.' };
    } catch (err: any) {
      // These messages are already written for a person; pass them through.
      const message = err?.message || 'The video engine could not be set up.';
      send({ phase: 'error', note: message });
      return { ok: false, error: message };
    }
  });

  // Record that a video went out, and where.
  //
  // `markPublished` was exported, unit-tested and called by nothing: the only
  // route a user could reach was `advance(id, 'published')`, a plain transition
  // that set the state and no id. That is the failure the state machine's own
  // comment warns about — "a job that looks published and is not" — because
  // without an id there is nothing to tell the two apart, and the idempotency
  // guard (which keys on `videoId`) could never fire.
  //
  // HomeBot does not upload. There is no uploader in this codebase, and adding
  // one needs Google OAuth client credentials that are not ours to hold. So the
  // honest operation is "record that this went out, and where" — the user
  // uploads, then pastes the link back. The guard then does real work: a second
  // attempt is refused rather than silently overwriting the id of the copy
  // already online.
  ipcMain.handle('homebot:media:mark-published', async (_e, id: string, videoId: string, note?: string) => {
    const { readJobs, writeJobs } = await import('./tools/media');
    const { markPublished } = await import('./media-studio');
    const { getSettings } = await import('./config-manager');
    // Same kill switch as every other route into a publishing state.
    const publishingEnabled = !!(getSettings() as any)?.mediaPublishingEnabled;
    const jobs = readJobs();
    const i = jobs.findIndex(j => j.id === id);
    if (i < 0) return { ok: false, error: 'That video is no longer in the list.' };
    try {
      jobs[i] = markPublished(jobs[i], String(videoId || ''), {
        by: 'human', humanDecision: true, note, publishingEnabled,
      });
      writeJobs(jobs);
      return { ok: true, job: jobs[i] };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // Deleting was chat-only. The panel could fill the disk with renders, scene
  // images and narration and offered no way to remove any of it — so the one
  // surface that shows you the queue was the one that could not shorten it.
  // Goes through the tool handler so the containment check that keeps a bad id
  // from deleting outside the media-assets root applies here too.
  ipcMain.handle('homebot:media:delete', async (_e, id: string, keepFiles?: boolean) => {
    const { mediaToolHandlers } = await import('./tools/media');
    try {
      const res: any = await mediaToolHandlers.media_delete_job(
        { job: id, keepFiles: !!keepFiles },
        { executionId: 'panel-delete' } as any,
      );
      return res?.success
        ? { ok: true, message: String(res.result ?? '') }
        : { ok: false, error: String(res?.error ?? 'Could not delete that video.') };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ---- Ancient Pathways (Animated Documentary Pipeline) ----
  ipcMain.handle('homebot:media:ancient-pathways-episodes', async () => {
    const { ANCIENT_PATHWAYS_EPISODES, resolveAncientPathwaysDir } = await import('./ancient-pathways');
    const dir = resolveAncientPathwaysDir();
    return { ok: true, episodes: ANCIENT_PATHWAYS_EPISODES, available: !!dir, dir };
  });

  ipcMain.handle('homebot:media:ancient-pathways-status', async () => {
    const { resolveAncientPathwaysDir, checkRenderLock } = await import('./ancient-pathways');
    const dir = resolveAncientPathwaysDir();
    if (!dir) return { ok: true, available: false, dir: null, lock: { locked: false } };
    const lock = checkRenderLock(dir);
    return { ok: true, available: true, dir, lock };
  });

  ipcMain.handle('homebot:media:ancient-pathways-doctor', async (_e, episodeId: string) => {
    const { runDoctorChecks } = await import('./ancient-pathways');
    const result = await runDoctorChecks(episodeId);
    return { ok: true, ...result };
  });

  ipcMain.handle('homebot:media:ancient-pathways-run', async (e, episodeId: string) => {
    const {
      ANCIENT_PATHWAYS_EPISODES,
      runEpisodePipeline,
      resolveAncientPathwaysDir,
    } = await import('./ancient-pathways');
    const { readJobs, writeJobs } = await import('./tools/media');
    const { createJob, transition } = await import('./media-studio');

    const ep = ANCIENT_PATHWAYS_EPISODES.find(x => x.id.toLowerCase() === String(episodeId || '').toLowerCase());
    if (!ep) return { ok: false, error: `Unknown episode '${episodeId}'.` };

    const dir = resolveAncientPathwaysDir();
    if (!dir) {
      return {
        ok: false,
        error: 'Ancient Pathways directory not found. Please ensure it is installed at Desktop/Ancient Pathways.',
      };
    }

    const jobs = readJobs();
    let job = jobs.find(j => j.title.toLowerCase().includes(ep.title.toLowerCase()) || j.title.toLowerCase().includes(ep.id));
    if (!job) {
      job = createJob({
        title: `Ancient Pathways: ${ep.title}`,
        format: 'long',
        brief: `${ep.code} · ${ep.era} · ${ep.mainCharacter}`,
      });
      jobs.push(job);
    }

    if (['idea', 'researching', 'script_draft', 'script_qa'].includes(job.state)) {
      job = transition(job, 'media_production', { by: 'studio', note: 'Running Ancient Pathways pipeline' });
    }
    writeJobs(jobs);

    const onProgress = (p: { stage: string; note: string }) => {
      try {
        e.sender.send('homebot:media:ancient-pathways-progress', {
          jobId: job.id,
          episodeId: ep.id,
          ...p,
        });
      } catch {
        /* window closed */
      }
    };

    try {
      const res = await runEpisodePipeline({
        episodeId: ep.id,
        dir,
        onProgress,
      });

      if (!res.ok) {
        return { ok: false, error: res.error || 'Episode render failed.' };
      }

      const updatedJobs = readJobs();
      const idx = updatedJobs.findIndex(j => j.id === job.id);
      if (idx >= 0) {
        updatedJobs[idx].renderPath = res.renderPath;
        if (updatedJobs[idx].state === 'media_production') {
          updatedJobs[idx] = transition(updatedJobs[idx], 'render_qa', {
            by: 'studio',
            note: '1080p master render complete',
          });
        }
        writeJobs(updatedJobs);
        return { ok: true, job: updatedJobs[idx], renderPath: res.renderPath };
      }

      return { ok: true, renderPath: res.renderPath };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Comprehensive first-run diagnostics ───────────────────────────────────
  // Runs disk-space, service-reachability, write-permissions, and GPU checks
  // in parallel. All checks are non-destructive and safe to call at any time.
  /**
   * What HomeBot can actually do right now, and what to do about the rest.
   *
   * Distinct from run-diagnostics, which reports SERVICES. This reports
   * CAPABILITIES in the user's words, and carries the fix for each broken one.
   */
  ipcMain.handle('homebot:capability-report', async () => {
    try {
      const { probeCapabilities } = await import('./capability-probe');
      const { buildCapabilityReport, summarise } = await import('../shared/capability-report');
      const input = await probeCapabilities(getSettings() as any);
      const capabilities = buildCapabilityReport(input);
      return { success: true, capabilities, summary: summarise(capabilities) };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('homebot:run-diagnostics', async () => {
    try {
      const { runDiagnostics } = await import('./diagnostics');
      const settings = getSettings();
      const userDataPath = app.getPath('userData');
      const result = await runDiagnostics(
        {
          ollamaUrl: settings.ollamaUrl || 'http://127.0.0.1:11434',
          n8nUrl: settings.n8nUrl || 'http://localhost:5678',
        },
        userDataPath
      );
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // List installed Ollama models via /api/tags
  ipcMain.handle('homebot:list-ollama-models', async () => {
    const ollamaBase = getConfiguredOllamaBaseUrl();
    try {
      const res = await axios.get(`${ollamaBase}/api/tags`, { timeout: OLLAMA_OP_TIMEOUT });
      const models = (res.data?.models || []).map((m: any) => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
        details: m.details || {},
      }));
      return { success: true, models };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err), models: [] };
    }
  });

  // Delete an Ollama model
  ipcMain.handle('homebot:delete-ollama-model', async (_event, modelName: string) => {
    // Same shape check the pull handler below already applies. Delete only
    // tested for a non-empty string, so the destructive half of the pair was
    // the more permissive one — the wrong way round, and only unnoticed
    // because nothing in the UI called it until now.
    if (!modelName || typeof modelName !== 'string' || !/^[a-z0-9._:/-]+$/i.test(modelName)) {
      return { success: false, error: 'Invalid model name' };
    }
    const ollamaBase = getConfiguredOllamaBaseUrl();
    try {
      await axios.delete(`${ollamaBase}/api/delete`, { data: { name: modelName }, timeout: OLLAMA_OP_TIMEOUT });
      return { success: true, model: modelName };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // Pull an Ollama model with progress reporting
  ipcMain.handle('homebot:pull-model', async (_event, modelName: string) => {
    if (!modelName || typeof modelName !== 'string' || !/^[a-z0-9._:/-]+$/i.test(modelName)) {
      return { success: false, error: 'Invalid model name' };
    }
    const ollamaBase = getConfiguredOllamaBaseUrl();
    try {
      const res = await axios.post(`${ollamaBase}/api/pull`, { name: modelName }, { timeout: OLLAMA_PULL_TIMEOUT });
      return { success: true, model: modelName, status: res?.data?.status || 'done' };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // Start Ollama (`ollama serve`) detached. Best-effort: succeeds if already
  // running, or if `ollama` is on PATH; returns a clear error otherwise so the
  // UI can tell the user to install/run it manually.
  ipcMain.handle('homebot:start-ollama', async () => {
    const ollamaBase = getConfiguredOllamaBaseUrl();

    // Already running? Don't spawn a duplicate.
    try {
      await axios.get(`${ollamaBase}/api/tags`, { timeout: HEALTH_CHECK_TIMEOUT });
      return { success: true, alreadyRunning: true };
    } catch (e) {
      console.error('[OLLAMA HEALTH CHECK ERROR]', e);
    }

    try {
      const launched = await launchOllamaServe();
      if (!launched.started) {
        return { success: false, error: launched.error || 'Failed to start Ollama.' };
      }

      // Poll for readiness (up to ~30s) so the UI can flip from "offline" to "ready"
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
        try {
          await axios.get(`${ollamaBase}/api/tags`, { timeout: OLLAMA_READY_POLL_TIMEOUT });
          return { success: true, alreadyRunning: false };
        } catch { /* keep polling */ }
      }
      return { success: false, error: 'Ollama did not become ready within 30s. Check the terminal for errors.' };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // Read telemetry consent log (JSONL) for UI display
  ipcMain.handle('homebot:read-consent-log', async () => {
    try {
      const userData = app.getPath('userData');
      const logPath = path.join(userData, 'logs', 'telemetry-consent.log');
      if (!fs.existsSync(logPath)) return { success: true, data: '' };
      const data = fs.readFileSync(logPath, 'utf-8');
      return { success: true, data };
    } catch (err: any) {
      console.error('Failed to read consent log:', err);
      return { success: false, error: String(err) };
    }
  });

  // Read telemetry events (JSONL) for the Telemetry dashboard UI
  ipcMain.handle('homebot:read-telemetry-events', async () => {
    try {
      const userData = app.getPath('userData');
      const pathsToCheck = [
        path.join(userData, 'logs', 'telemetry-events.log'),
        path.join(os.homedir(), 'HOMEBOT_DIAG', 'telemetry-events.log')
      ];
      const found = pathsToCheck.find(p => fs.existsSync(p));
      if (!found) return { success: true, events: [] };
      const data = fs.readFileSync(found, 'utf-8').trim();
      if (!data) return { success: true, events: [] };
      const lines = data.split('\n').filter(Boolean);
      const events = lines.map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      return { success: true, events };
    } catch (err: any) {
      console.error('Failed to read telemetry events:', err);
      return { success: false, error: String(err) };
    }
  });

  // Read the permission decision audit log for the Permission History UI
  ipcMain.handle('homebot:read-permission-audit', async () => {
    try {
      const events = readPermissionAudit();
      return { success: true, events };
    } catch (err: any) {
      console.error('Failed to read permission audit log:', err);
      return { success: false, error: String(err) };
    }
  });

  // Clear the permission decision audit log (user-initiated)
  ipcMain.handle('homebot:clear-permission-audit', async () => {
    try {
      clearPermissionAudit();
      return { success: true };
    } catch (err: any) {
      console.error('Failed to clear permission audit log:', err);
      return { success: false, error: String(err) };
    }
  });

  // Export the permission decision audit log to a JSON file (user-initiated)
  ipcMain.handle('homebot:export-permission-audit', async () => {
    try {
      return exportPermissionAudit();
    } catch (err: any) {
      console.error('Failed to export permission audit log:', err);
      return { success: false, error: String(err) };
    }
  });

  // Analytics summary — aggregated conversation stats for the dashboard
  ipcMain.handle('homebot:get-analytics-summary', async () => {
    try {
      const store = MemoryManager.loadConversationStore();
      const conversations = store?.conversations || [];
      let totalMessages = 0;
      let oldest: string | null = null;
      for (const conv of conversations) {
        totalMessages += (conv?.messages?.length || 0);
        const created = conv?.createdAt;
        if (created && (!oldest || created < oldest)) oldest = created;
      }
      const conversationCount = conversations.length;
      const avg = conversationCount > 0 ? Math.round(totalMessages / conversationCount) : 0;
      const toolCallStats = readToolCallAggregates();
      return {
        success: true,
        summary: {
          conversationCount,
          totalMessages,
          avgMessagesPerConversation: avg,
          oldestConversation: oldest,
          toolCallStats,
        },
      };
    } catch (err: any) {
      console.error('Failed to build analytics summary:', err);
      return { success: false, error: String(err) };
    }
  });

  // Dev/E2E debug: return main/renderer in-memory buffers and conversation store snapshot
  ipcMain.handle('homebot:read-debug-logs', async () => {
    try {
      const rendererLogs = (global as any).__HOMEBOT_RENDERER_LOGS || [];
      const mainLogs = (global as any).__HOMEBOT_MAIN_LOG_BUFFER || [];
      const store = MemoryManager.loadConversationStore();
      return { success: true, rendererLogs, mainLogs, conversationStore: store };
    } catch (err: any) {
      console.error('Failed to read debug logs:', err);
      return { success: false, error: String(err) };
    }
  });

  // Append renderer log to in-memory buffer for diagnostics
  ipcMain.on('homebot:append-renderer-log', (_event, line: string) => {
    try {
      if (!(global as any).__HOMEBOT_RENDERER_LOGS) (global as any).__HOMEBOT_RENDERER_LOGS = [];
      (global as any).__HOMEBOT_RENDERER_LOGS.push(line);
      if ((global as any).__HOMEBOT_RENDERER_LOGS.length > 500) {
        (global as any).__HOMEBOT_RENDERER_LOGS.shift();
      }
    } catch (e) { safeCatch(e); }
  });

  // Capture logs: write runtime snapshot to temp file and return path
  ipcMain.handle('homebot:capture-logs', async () => {
    try {
      const rendererLogs = (global as any).__HOMEBOT_RENDERER_LOGS || [];
      const mainLogs = (global as any).__HOMEBOT_MAIN_LOG_BUFFER || [];
      const logContent = [
        '=== HomeBot Log Capture ===',
        `Timestamp: ${new Date().toISOString()}`,
        '',
        '--- Main Process Logs ---',
        ...mainLogs,
        '',
        '--- Renderer Logs ---',
        ...rendererLogs,
      ].join('\n');
      const logPath = path.join(os.tmpdir(), `homebot-logs-${Date.now()}.txt`);
      fs.writeFileSync(logPath, logContent, 'utf-8');
      return { success: true, path: logPath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Restart the application
  ipcMain.handle('homebot:restart-app', async () => {
    app.relaunch();
    app.quit();
  });

  // ============= Memory / Conversation Handlers =============

  /**
   * Load all conversations (list view)
   */
  ipcMain.handle('homebot:load-conversations', async () => {
    try {
      const store = MemoryManager.loadConversationStore();
      return { success: true, data: store };
    } catch (err: any) {
      console.error('Error loading conversations:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get a single conversation by ID
   */
  ipcMain.handle('homebot:get-conversation', async (_event, conversationId: string) => {
    try {
      const conversation = MemoryManager.getConversation(conversationId);
      return { success: true, data: conversation };
    } catch (err: any) {
      console.error('Error getting conversation:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Create a new conversation
   */
  ipcMain.handle('homebot:create-conversation', async (_event, title?: string) => {
    try {
      const conversation = MemoryManager.createNewConversation(title);
      return { success: true, data: conversation };
    } catch (err: any) {
      console.error('Error creating conversation:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Save/update a conversation
   */
  ipcMain.handle('homebot:save-conversation', async (_event, conversation: StoredConversation) => {
    try {
      // The one place this setting is honoured, and until now it was honoured
      // nowhere: `saveConversationHistory` was declared, defaulted to true,
      // shipped to the renderer and written back to disk on every save — and no
      // branch anywhere depended on it. Someone who set it to false still had
      // every message written to conversation-history.json verbatim.
      //
      // Turning it off stops new writes. It deliberately does NOT delete what is
      // already stored: erasing a user's history as a side effect of a
      // preference change is not something a checkbox should do silently.
      if (getSettings().saveConversationHistory === false) {
        return { success: true, skipped: 'history-disabled' };
      }
      const success = MemoryManager.saveConversation(conversation);
      return { success };
    } catch (err: any) {
      console.error('Error saving conversation:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Delete a conversation
   */
  ipcMain.handle('homebot:delete-conversation', async (_event, conversationId: string) => {
    try {
      const success = MemoryManager.deleteConversation(conversationId);
      clearHistory(conversationId);
      return { success };
    } catch (err: any) {
      console.error('Error deleting conversation:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Compact a conversation — archive older messages, replace with summary
   */
  ipcMain.handle('homebot:compact-conversation', async (_event, conversationId: string, keepRecent?: number) => {
    try {
      const result = MemoryManager.compactConversation(conversationId, keepRecent);
      if (result.success) {
        clearHistory(conversationId);
      }
      return result;
    } catch (err: any) {
      console.error('Error compacting conversation:', err.message);
      return { success: false, originalCount: 0, compactedCount: 0, error: err.message };
    }
  });

  /**
   * Set active conversation
   */
  ipcMain.handle('homebot:set-active-conversation', async (_event, conversationId: string | null) => {
    try {
      const success = MemoryManager.setActiveConversation(conversationId);
      // Pre-warm LLM context so first message in this conversation has full history
      if (conversationId) ensureHydrated(conversationId);
      return { success };
    } catch (err: any) {
      console.error('Error setting active conversation:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Add a message to a conversation
   */
  ipcMain.handle('homebot:add-message', async (_event, { conversationId, message }: { conversationId: string; message: Message }) => {
    try {
      console.log(`[IPC] homebot:add-message conv=${conversationId} msgId=${message.id} len=${String(message.content || '').length}`);
      try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER = (global as any).__HOMEBOT_MAIN_LOG_BUFFER || []; (global as any).__HOMEBOT_MAIN_LOG_BUFFER.push(`[IPC] homebot:add-message conv=${conversationId} msgId=${message.id}`); } catch (e) { safeCatch(e); }
      const success = MemoryManager.addMessageToConversation(conversationId, message);
      console.log(`[IPC] addMessage -> success=${success}`);

      // Auto-compact when conversation exceeds threshold
      const AUTO_COMPACT_THRESHOLD = 50;
      try {
        const conv = MemoryManager.getConversation(conversationId);
        if (conv && conv.messages.length >= AUTO_COMPACT_THRESHOLD) {
          const alreadyCompacted = conv.messages.some(m => m.role === 'system' && m.content?.startsWith('[Conversation summary'));
          if (!alreadyCompacted) {
            const result = MemoryManager.compactConversation(conversationId);
            if (result.success && !result.error) {
              clearHistory(conversationId);
              const win = mainWindow ?? getMainWindow();
              win?.webContents.send('homebot:conversation-compacted', {
                conversationId,
                originalCount: result.originalCount,
                compactedCount: result.compactedCount,
              });
              console.log(`[IPC] Auto-compacted ${conversationId}: ${result.originalCount} → ${result.compactedCount} messages`);
            }
          }
        }
      } catch (e) { safeCatch(e); }

      return { success };
    } catch (err: any) {
      console.error('Error adding message:', err.message);
      try { (global as any).__HOMEBOT_MAIN_LOG_BUFFER.push(`[IPC] addMessage error=${String(err)}`); } catch (e) { safeCatch(e); }
      return { success: false, error: err.message };
    }
  });

  /**
   * Update a message in a conversation
   */
  ipcMain.handle('homebot:update-message', async (_event, { conversationId, messageId, updates }: { conversationId: string; messageId: string; updates: Partial<Message> }) => {
    try {
      const success = MemoryManager.updateMessageInConversation(conversationId, messageId, updates);
      if (success) {
        resyncHistoryFromStore(conversationId);
      }
      return { success };
    } catch (err: any) {
      console.error('Error updating message:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Auto-generate a short conversation title from the first exchange.
   * Calls Ollama non-streaming with a minimal prompt, saves to memory,
   * and pushes the result back to the renderer via homebot:title-updated.
   */
  ipcMain.handle('homebot:generate-title', async (_event, {
    conversationId,
    userMessage,
    assistantReply,
  }: { conversationId: string; userMessage: string; assistantReply: string }) => {
    try {
      const settings = getSettings();
      const userSnippet = userMessage.slice(0, 200);
      const assistantSnippet = assistantReply.slice(0, 200);
      const titleInstruction = 'Generate a short conversation title (4-6 words max, no punctuation, no quotes) that captures what this exchange is about.';

      let title = '';
      const titleCloud = resolveCloudLLM(settings);

      if (titleCloud.active && titleCloud.config) {
        // Same hand-rolled HTTP shape as the quiz path had — it produced
        // "Invalid URL" for claude-code, which has no apiUrl because it is a
        // CLI, not an endpoint. Titles are best-effort, so a shorter timeout.
        title = await generateFromCustomLLM(
          titleCloud.config,
          titleInstruction,
          `User: ${userSnippet}\nAssistant: ${assistantSnippet}\nTitle:`,
          { timeoutMs: 15_000 },
        );
      } else {
        const ollamaBase = getConfiguredOllamaBaseUrl();
        const model = settings.chatModel || process.env.OLLAMA_MODEL || 'qwen2.5:7b';
        const prompt = `${titleInstruction}\nUser: ${userSnippet}\nAssistant: ${assistantSnippet}\nTitle:`;
        const resp = await axios.post(
          `${ollamaBase}/api/generate`,
          { model, prompt, stream: false, options: { temperature: 0.3, num_predict: 20 } },
          { timeout: OLLAMA_OP_TIMEOUT }
        );
        title = resp.data?.response ?? '';
      }

      title = title.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\n.*/g, '').trim();
      if (!title || title.length < 2) return { success: false, error: 'Empty title response' };
      if (title.length > 60) title = title.slice(0, 57) + '…';

      const conv = MemoryManager.getConversation(conversationId);
      if (conv) {
        conv.title = title;
        MemoryManager.saveConversation(conv);
      }

      const win = mainWindow ?? getMainWindow();
      win?.webContents.send('homebot:title-updated', { conversationId, title });

      return { success: true, title };
    } catch (err: any) {
      console.warn('[IPC] generate-title failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Open a file in the system default application
   */
  ipcMain.handle('homebot:open-file', async (_event, filePath: string) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }
      // Resolve and restrict to user home directory to prevent path traversal
      const normalizedPath = path.resolve(filePath);
      const homeDir = require('os').homedir();
      const homeWithSep = homeDir.toLowerCase() + path.sep;
      if (normalizedPath.toLowerCase() !== homeDir.toLowerCase() && !normalizedPath.toLowerCase().startsWith(homeWithSep)) {
        return { success: false, error: 'Access denied: path must be within home directory' };
      }
      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'File not found' };
      }
      await shell.openPath(normalizedPath);
      return { success: true };
    } catch (err: any) {
      console.error('Error opening file:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('homebot:open-external-url', async (_event, url: string) => {
    try {
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'No URL provided' };
      }
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Only http/https URLs are allowed' };
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Show a file in the system file explorer (and select it)
   */
  ipcMain.handle('homebot:show-in-folder', async (_event, filePath: string) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }
      // Resolve and restrict to user home directory to prevent path traversal
      const normalizedPath = path.resolve(filePath);
      const homeDir = require('os').homedir();
      const homeWithSep = homeDir.toLowerCase() + path.sep;
      if (normalizedPath.toLowerCase() !== homeDir.toLowerCase() && !normalizedPath.toLowerCase().startsWith(homeWithSep)) {
        return { success: false, error: 'Access denied: path must be within home directory' };
      }
      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'File not found' };
      }
      shell.showItemInFolder(normalizedPath);
      return { success: true };
    } catch (err: any) {
      console.error('Error showing in folder:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Start Windows speech recognition (offline capable)
   * Uses Windows SAPI through PowerShell
   */
  ipcMain.handle('homebot:start-speech-recognition', async () => {

    return new Promise((resolve) => {
      // PowerShell script to use Windows Speech Recognition (SAPI — fully offline)
      const psScript = `
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()

$dictation = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($dictation)

$recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(6)
$recognizer.BabbleTimeout         = [TimeSpan]::FromSeconds(4)
$recognizer.EndSilenceTimeout     = [TimeSpan]::FromSeconds(1.5)

try {
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(15))
    if ($result -and $result.Text) {
        Write-Output $result.Text
    } else {
        Write-Output ""
    }
} catch {
    Write-Output ""
} finally {
    $recognizer.Dispose()
}
`;
      // Write to a unique temp file so concurrent calls don't race
      const tmpFile = path.join(os.tmpdir(), `homebot-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
      try {
        fs.writeFileSync(tmpFile, psScript, 'utf8');
      } catch (writeErr: any) {
        resolve({ success: false, error: 'Could not write temp script: ' + writeErr.message, text: '' });
        return;
      }

      execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', tmpFile],
        { timeout: SPEECH_RECOGNITION_TIMEOUT },
        (error: any, stdout: string, stderr: string) => {
          try { fs.unlinkSync(tmpFile); } catch (_) {}
          if (error) {
            console.error('[Voice] SAPI error:', error.message, stderr);
            resolve({ success: false, error: 'Speech recognition failed: ' + (error.message || ''), text: '' });
          } else {
            const text = stdout.trim();
            resolve({ success: true, text });
          }
        }
      );
    });
  });

  // ── Scheduler (Pro-gated: 'automation') ──────────────────────────────────────
  ipcMain.handle('homebot:scheduler-list', gatedAutomationHandler(
    'homebot:scheduler-list', getCurrentTier, async () => listJobs()
  ));

  ipcMain.handle('homebot:scheduler-add', gatedAutomationHandler(
    'homebot:scheduler-add', getCurrentTier, async (_event, input: any) => {
    const { name, message, intervalMinutes, dailyTime, enabled } = input || {};
    if (!name || !message) return { success: false, error: 'name and message are required' };
    const job = addJob({
      name: String(name).slice(0, 80),
      message: String(message).slice(0, 500),
      intervalMinutes: Math.max(1, Number(intervalMinutes) || 60),
      dailyTime: dailyTime ? String(dailyTime) : undefined,
      enabled: enabled !== false,
    });
    return { success: true, job };
  }));

  ipcMain.handle('homebot:scheduler-remove', gatedAutomationHandler(
    'homebot:scheduler-remove', getCurrentTier, async (_event, id: string) => {
    return { success: removeJob(id) };
  }));

  ipcMain.handle('homebot:scheduler-toggle', gatedAutomationHandler(
    'homebot:scheduler-toggle', getCurrentTier, async (_event, id: string, enabled: boolean) => {
    const job = toggleJob(id, enabled);
    return job ? { success: true, job } : { success: false, error: 'Job not found' };
  }));

  // ── Licensing (Pro entitlement) ───────────────────────────────────────────────
  ipcMain.handle('homebot:license:status', async () => getLicenseStatus());

  ipcMain.handle('homebot:license:activate', async (_event, licenseKey: string) => {
    if (!licenseKey || !String(licenseKey).trim()) {
      return { valid: false, error: 'License key is required' };
    }
    return activateLicense(String(licenseKey));
  });

  ipcMain.handle('homebot:license:validate', async () => validateLicense());

  ipcMain.handle('homebot:license:deactivate', async () => deactivateLicense());

  // ── TTS (text-to-speech) ────────────────────────────────────────────────────
  // Uses Edge TTS neural voices (msedge-tts), falls back to Web Speech API
  ipcMain.handle('homebot:tts-speak', async (_event, text: string, rate?: number) => {
    return speakHandler({ text, rate: rate ?? 0 }, {} as any);
  });

  ipcMain.handle('homebot:tts-stop', async () => {
    return stopSpeakingHandler({}, {} as any);
  });

  // Voice picker: list the neural voices, and render a short sample of one to
  // a file the renderer can play — hear a voice before committing a video to it.
  ipcMain.handle('homebot:tts-list-voices', async () => {
    const { getVoicesHandler } = await import('./tools/voice');
    return getVoicesHandler({}, {} as any);
  });

  ipcMain.handle('homebot:tts-sample-voice', async (_event, voice: string, sampleText?: string, engine?: string) => {
    const { renderNarrationToFile } = await import('./tools/voice');
    const text = (sampleText || 'Hi, this is how I sound. I can narrate your video from start to finish.').slice(0, 300);
    const file = path.join(os.tmpdir(), `homebot-voice-sample-${Date.now()}.mp3`);
    try {
      // The sample must come from the SAME engine that will record the video —
      // approving a voice by ear only means something if it is this voice,
      // rendered by this engine.
      const rendered = await renderNarrationToFile(text, file, {
        voice: voice || undefined,
        engine: engine === 'kokoro' || engine === 'edge' ? engine : undefined,
      });
      return { success: true, path: rendered.path, engine: rendered.engine };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── MCP Server Management ───────────────────────────────────────────────────

  ipcMain.handle('homebot:mcp-get-status', async () => {
    return getMcpStatus();
  });

  ipcMain.handle('homebot:mcp-list-servers', async () => {
    return loadMcpConfig().servers;
  });

  ipcMain.handle('homebot:mcp-add-server', async (_event, config: McpServerConfig) => {
    const current = loadMcpConfig();
    // Replace if same name already exists, otherwise append
    const idx = current.servers.findIndex(s => s.name === config.name);
    if (idx >= 0) {
      current.servers[idx] = config;
    } else {
      current.servers.push(config);
    }
    saveMcpConfig(current);

    // Connect NOW, not at next launch. Store-then-nothing-until-restart made
    // "Connect" read as success while producing no tools — the reachability
    // defect wearing a success badge. The result says what actually happened,
    // so the UI can promise only what is true.
    let live: { connected: boolean; toolCount: number; error?: string } = { connected: false, toolCount: 0 };
    if (config.enabled !== false) {
      try {
        live = await connectSingleServer(config, registerTool);
      } catch (err: any) {
        live = { connected: false, toolCount: 0, error: err?.message || String(err) };
      }
    }

    return {
      success: true,
      connected: live.connected,
      toolCount: live.toolCount,
      error: live.error
    };
  });

  ipcMain.handle('homebot:mcp-remove-server', async (_event, name: string) => {
    const current = loadMcpConfig();
    current.servers = current.servers.filter(s => s.name !== name);
    saveMcpConfig(current);
    return { success: true };
  });

  ipcMain.handle('homebot:mcp-toggle-server', async (_event, name: string, enabled: boolean) => {
    const current = loadMcpConfig();
    const server = current.servers.find(s => s.name === name);
    if (server) server.enabled = enabled;
    saveMcpConfig(current);
    return { success: true };
  });

  // ── Conversation Search ─────────────────────────────────────────────────────

  /**
   * Full-text search across all stored conversations.
   * Returns matching messages with title, role and a surrounding snippet.
   */
  ipcMain.handle('homebot:search-conversations', async (_event, query: string, maxResults?: number) => {
    try {
      const results: ConversationSearchResult[] = MemoryManager.searchConversations(query, maxResults ?? 50);
      return { success: true, data: results };
    } catch (err: any) {
      console.error('[IPC] homebot:search-conversations error:', err.message);
      return { success: false, error: err.message, data: [] };
    }
  });

  /**
   * Export a single conversation as Markdown or JSON.
   * Accepts an optional format: 'markdown' (default) | 'json'.
   */
  ipcMain.handle('homebot:export-conversation', async (_event, conversationId: string, format?: string) => {
    console.log('[IPC] export-conversation called:', { conversationId: conversationId?.slice(0, 12), format });
    try {
      const desktop = app.getPath('desktop');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeId = conversationId.replace(/[^a-z0-9_-]/gi, '').slice(0, 12);
      let filePath: string;

      if (format === 'docx') {
        const buf = await MemoryManager.exportConversationAsDocx(conversationId);
        if (!buf) return { success: false, error: 'Conversation not found' };
        filePath = path.join(desktop, `homebot-export-${safeId}-${ts}.docx`);
        fs.writeFileSync(filePath, buf);
      } else if (format === 'pdf') {
        const buf = await MemoryManager.exportConversationAsPdf(conversationId);
        if (!buf) return { success: false, error: 'Conversation not found' };
        filePath = path.join(desktop, `homebot-export-${safeId}-${ts}.pdf`);
        fs.writeFileSync(filePath, buf);
      } else {
        const isJson = format === 'json';
        const content = isJson
          ? MemoryManager.exportConversationAsJSON(conversationId)
          : MemoryManager.exportConversationAsMarkdown(conversationId);
        if (!content) return { success: false, error: 'Conversation not found' };
        const ext = isJson ? 'json' : 'md';
        filePath = path.join(desktop, `homebot-export-${safeId}-${ts}.${ext}`);
        fs.writeFileSync(filePath, content, 'utf-8');
      }

      console.log('[IPC] Exported to:', filePath);
      shell.openPath(filePath).catch(() => {});
      return { success: true, path: filePath };
    } catch (err: any) {
      console.error('[IPC] homebot:export-conversation error:', err.message, err.stack);
      return { success: false, error: err.message };
    }
  });

  // ── Settings Export/Import ──────────────────────────────────────────────────

  ipcMain.handle('homebot:export-settings', async () => {
    try {
      const settings = getSettings();
      const convStore = MemoryManager.loadConversationStore();
      const prefs = MemoryManager.loadPreferences();
      const toolStats = MemoryManager.loadToolStats();
      const bundle = {
        _homebot_backup: true,
        exportedAt: new Date().toISOString(),
        version: app.getVersion(),
        settings,
        preferences: prefs,
        conversations: convStore,
        toolStats,
      };
      const desktop = path.join(os.homedir(), 'Desktop');
      const filename = `homebot-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const filePath = path.join(desktop, filename);
      fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf-8');
      return { success: true, path: filePath };
    } catch (err: any) {
      console.error('[IPC] homebot:export-settings error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('homebot:import-settings', async (_event, filePath: string) => {
    try {
      // Same home-directory confinement as parse-document / write-document:
      // an arbitrary path here would let a malicious or mistaken restore read
      // any JSON on disk (error messages leak contents) — see path-guard.ts.
      const guard = resolveWithinHome(filePath);
      if ('error' in guard) return { success: false, error: guard.error };
      const resolved = guard.resolved;
      if (!fs.existsSync(resolved)) return { success: false, error: 'File not found' };
      const raw = fs.readFileSync(resolved, 'utf-8');
      const bundle = JSON.parse(raw);
      if (!bundle._homebot_backup) return { success: false, error: 'Not a valid HomeBot backup file' };

      let keptEndpoints: string[] | undefined;
      let skippedEndpoints: string[] | undefined;

      if (bundle.settings) {
        const current = getSettings();
        // Credentials never survive an import. Endpoints (n8nUrl and friends)
        // decide where traffic goes — including who receives X-HOMEBOT-Auth —
        // so a backup that would MOVE one is confirmed with the user first;
        // if nobody can be asked, endpoints are skipped rather than applied.
        const changes = analyzeImportedEndpoints(bundle.settings, current);
        let importedSettings = bundle.settings;
        if (changes.length === 0) {
          const { settings } = stripImportedSettings(bundle.settings);
          importedSettings = settings;
        } else {
          const detail = changes
            .map((c) => `${c.key}: ${c.from || '(not set)'} → ${c.to}`)
            .join('\n');
          let restoreEndpoints: boolean | undefined;
          try {
            const answer = await dialog.showMessageBox({
              type: 'warning',
              buttons: ['Keep my endpoints', 'Restore from backup'],
              defaultId: 0,
              cancelId: 0,
              title: 'Backup changes where HomeBot sends traffic',
              message: 'This backup would change where HomeBot sends your chats and data:',
              detail,
            });
            restoreEndpoints = answer.response === 1;
          } catch {
            restoreEndpoints = undefined; // nobody home to ask — fail closed below
          }
          if (restoreEndpoints === true) {
            const { settings } = stripImportedSettings(bundle.settings);
            // Endpoints were explicitly approved; put them back over the
            // stripped copy. Credentials stay stripped either way.
            for (const c of changes) {
              if (c.key.includes('.')) continue; // customLLM handled as a whole below
              (settings as Record<string, unknown>)[c.key] = (
                bundle.settings as Record<string, unknown>
              )[c.key];
            }
            if (changes.some((c) => c.key === 'customLLM.baseUrl')) {
              const srcLlm = (bundle.settings as Record<string, unknown>).customLLM as
                | Record<string, unknown>
                | undefined;
              const dstLlm = (settings as Record<string, unknown>).customLLM as
                | Record<string, unknown>
                | undefined;
              if (srcLlm && dstLlm && Object.prototype.hasOwnProperty.call(srcLlm, 'baseUrl')) {
                dstLlm.baseUrl = srcLlm.baseUrl;
              }
            }
            importedSettings = settings;
            keptEndpoints = changes.map((c) => c.key);
          } else {
            const { settings, strippedEndpoints: stripped } =
              stripImportedSettings(bundle.settings);
            importedSettings = settings;
            skippedEndpoints = stripped.filter((k) =>
              changes.some((c) => c.key === k)
            );
          }
        }
        saveSettings({ ...current, ...sanitizeImportedSettings(importedSettings) });
      }
      if (bundle.preferences) {
        MemoryManager.savePreferences(bundle.preferences);
      }
      if (bundle.conversations) {
        MemoryManager.saveConversationStore(bundle.conversations);
      }
      return {
        success: true,
        restoredAt: new Date().toISOString(),
        ...(keptEndpoints ? { keptEndpoints } : {}),
        ...(skippedEndpoints ? { skippedEndpoints } : {}),
      };
    } catch (err: any) {
      console.error('[IPC] homebot:import-settings error:', err.message);
      return { success: false, error: err.message };
    }
  });


  // ── Document Viewer ────────────────────────────────────────────────────────

  // resolveWithinHome lives in utils/path-guard.ts so every handler that
  // takes an untrusted filesystem path uses one tested implementation.

  ipcMain.handle('homebot:parse-document', async (_event, filePath: string) => {
    try {
      const guard = resolveWithinHome(filePath);
      if ('error' in guard) return { success: false, error: guard.error };
      const resolved = guard.resolved;
      if (!fs.existsSync(resolved)) return { success: false, error: 'File not found' };

      const stat = fs.statSync(resolved);
      if (stat.size > 50 * 1024 * 1024) {
        return { success: false, error: 'File too large (max 50 MB)' };
      }

      const ext = path.extname(resolved).toLowerCase();
      const buffer = fs.readFileSync(resolved);
      const fileName = path.basename(resolved);

      // DOCX — return both HTML (for rendering) and plain text (for editing/export)
      if (ext === '.docx') {
        const mammoth = await import('mammoth');
        const [htmlResult, textResult] = await Promise.all([
          mammoth.convertToHtml({ buffer }),
          mammoth.extractRawText({ buffer }),
        ]);
        return { success: true, html: htmlResult.value, text: textResult.value, fileName };
      }

      // PDF
      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        const result = await pdfParse(buffer);
        return { success: true, text: result.text, pageCount: result.numpages, fileName };
      }

      // Excel
      if (ext === '.xlsx' || ext === '.xls') {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const lines: string[] = [];
        workbook.eachSheet((sheet: any) => {
          lines.push(`## Sheet: ${sheet.name}`);
          sheet.eachRow((row: any) => {
            const cells = (row.values as any[]) || [];
            const values = cells.slice(1).map((v: any) => {
              if (v === null || v === undefined) return '';
              if (typeof v === 'object' && v.result !== undefined) return String(v.result);
              if (typeof v === 'object' && v.text) return String(v.text);
              return String(v);
            });
            lines.push(values.join('\t'));
          });
          lines.push('');
        });
        return { success: true, text: lines.join('\n'), type: 'spreadsheet', fileName };
      }

      // Plain text / code / CSV / markdown
      return { success: true, text: buffer.toString('utf-8'), fileName };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('homebot:write-document', async (_event, filePath: string, content: string) => {
    try {
      const guard = resolveWithinHome(filePath);
      if ('error' in guard) return { success: false, error: guard.error };
      fs.writeFileSync(guard.resolved, content, 'utf-8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  });

  // ── Ollama installer download ────────────────────────────────────────────
  // Downloads OllamaSetup.exe and runs it silently, then polls until ready.

  ipcMain.handle('homebot:check-ollama-installed', async () => {
    const candidates = process.platform === 'win32'
      ? [
          'ollama.exe',
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe'),
        ]
      : ['ollama'];

    for (const cmd of candidates) {
      if (!cmd) continue;
      try {
        const resolved = await new Promise<string | null>((resolve) => {
          execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeout: 3000 }, (err, stdout) => {
            if (err) resolve(null);
            else resolve(stdout.trim().split('\n')[0] || null);
          });
        });
        if (resolved) return { installed: true, path: resolved };
      } catch { /* try next */ }
      if (path.isAbsolute(cmd) && fs.existsSync(cmd)) {
        return { installed: true, path: cmd };
      }
    }
    return { installed: false, path: null };
  });

  ipcMain.handle('homebot:download-ollama', async () => {
    const win = mainWindow ?? getMainWindow();
    const sendProgress = (data: any) => {
      try { if (win && !win.isDestroyed()) win.webContents.send('homebot:ollama-download-progress', data); } catch { /* */ }
    };

    const installerUrl = 'https://ollama.com/download/OllamaSetup.exe';
    const tmpPath = path.join(os.tmpdir(), `OllamaSetup-${Date.now()}.exe`);

    try {
      sendProgress({ stage: 'downloading', percent: 0 });

      await new Promise<void>((resolve, reject) => {
        const follow = (url: string, redirects = 0) => {
          if (redirects > 5) { reject(new Error('Too many redirects')); return; }
          const req = https.get(url, { headers: { 'User-Agent': 'HomeBot-Installer/1.0' } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              follow(res.headers.location, redirects + 1);
              return;
            }
            if (!res.statusCode || res.statusCode >= 400) {
              reject(new Error(`Download failed: HTTP ${res.statusCode}`));
              return;
            }
            const total = parseInt(res.headers['content-length'] || '0', 10);
            let downloaded = 0;
            const file = fs.createWriteStream(tmpPath);
            res.on('data', (chunk: Buffer) => {
              downloaded += chunk.length;
              file.write(chunk);
              if (total > 0) {
                sendProgress({ stage: 'downloading', percent: Math.round((downloaded / total) * 100), downloadedMB: Math.round(downloaded / 1048576), totalMB: Math.round(total / 1048576) });
              }
            });
            res.on('end', () => { file.end(() => resolve()); });
            res.on('error', (e) => { file.destroy(); reject(e); });
          });
          req.on('error', reject);
          req.setTimeout(120_000, () => { req.destroy(); reject(new Error('Download timed out')); });
        };
        follow(installerUrl);
      });

      sendProgress({ stage: 'installing', percent: 100 });

      await new Promise<void>((resolve, reject) => {
        const child = spawn(tmpPath, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', (e) => reject(new Error('Installer launch failed: ' + e.message)));
        child.once('exit', (code) => {
          if (code === 0 || code === null) resolve();
          else reject(new Error(`Installer exited with code ${code}`));
        });
        child.unref();
        setTimeout(() => resolve(), 60_000);
      });

      try { fs.unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }

      sendProgress({ stage: 'starting', percent: 100 });
      await launchOllamaServe();

      const ollamaBase = getConfiguredOllamaBaseUrl();
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          await axios.get(`${ollamaBase}/api/tags`, { timeout: 2000 });
          sendProgress({ stage: 'ready', percent: 100 });
          return { success: true };
        } catch { /* keep polling */ }
      }
      return { success: false, error: 'Ollama installed but did not start within 30s. Try restarting HomeBot.' };
    } catch (err: any) {
      try { fs.unlinkSync(tmpPath); } catch { /* */ }
      return { success: false, error: String(err?.message || err) };
    }
  });

  // ── Streaming model pull with progress ─────────────────────────────────────

  ipcMain.handle('homebot:pull-model-stream', async (_event, modelName: string) => {
    if (!modelName || typeof modelName !== 'string' || !/^[a-z0-9._:/-]+$/i.test(modelName)) {
      return { success: false, error: 'Invalid model name' };
    }
    const ollamaBase = getConfiguredOllamaBaseUrl();
    const win = mainWindow ?? getMainWindow();

    const sendProgress = (data: any) => {
      try { if (win && !win.isDestroyed()) win.webContents.send('homebot:pull-model-progress', data); } catch { /* */ }
    };

    try {
      const res = await axios.post(`${ollamaBase}/api/pull`, { name: modelName, stream: true }, {
        timeout: OLLAMA_PULL_TIMEOUT,
        responseType: 'stream',
      });

      await new Promise<void>((resolve, reject) => {
        let buf = '';
        const stream = res.data as NodeJS.ReadableStream;
        stream.on('data', (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const j = JSON.parse(line);
              const percent = (j.total && j.completed) ? Math.round((j.completed / j.total) * 100) : null;
              sendProgress({ model: modelName, status: j.status || '', percent, completedMB: j.completed ? Math.round(j.completed / 1048576) : null, totalMB: j.total ? Math.round(j.total / 1048576) : null });
              if (j.status === 'success') resolve();
            } catch { /* skip malformed line */ }
          }
        });
        stream.on('end', () => resolve());
        stream.on('error', (e: Error) => reject(e));
      });

      sendProgress({ model: modelName, status: 'success', percent: 100 });
      return { success: true, model: modelName };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // ── Automation Center ──────────────────────────────────────────────────────

  const AUTOMATIONS_FILE = path.join(app.getPath('userData'), 'automations.json');

  function readAutomations(): any[] {
    try {
      if (!fs.existsSync(AUTOMATIONS_FILE)) return [];
      const parsed = JSON.parse(fs.readFileSync(AUTOMATIONS_FILE, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      // Don't silently return [] — that would make every automation vanish from
      // the UI and let the next write overwrite the (recoverable) file. Back up
      // the corrupt file so it can be inspected/restored, then start clean.
      try {
        const backup = `${AUTOMATIONS_FILE}.corrupt-${Date.now()}`;
        if (fs.existsSync(AUTOMATIONS_FILE)) fs.copyFileSync(AUTOMATIONS_FILE, backup);
        console.error(`[Automation] automations.json unreadable, backed up to ${backup}:`, e);
      } catch (backupErr) {
        console.error('[Automation] failed to back up corrupt automations.json:', backupErr);
      }
      return [];
    }
  }

  function writeAutomations(automations: any[]) {
    // Atomic write: serialize to a temp file then rename, so a crash mid-write
    // can never leave a half-written (corrupt) automations.json behind.
    const tmp = `${AUTOMATIONS_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(automations, null, 2), 'utf8');
    fs.renameSync(tmp, AUTOMATIONS_FILE);
  }

  /**
   * Rewrite a draft request so the assistant can act on it.
   *
   * Routed EXACTLY like conversation titles: resolveCloudLLM decides, and when
   * cloud is off the local model does it. The privacy switch has to govern this
   * the same as everything else — a "helpful" rewrite that quietly posted the
   * user's half-finished thought to a cloud provider would be the worst
   * possible place to make an exception.
   */
  ipcMain.handle('homebot:improve-prompt', async (_ev, payload: { draft?: string }) => {
    const draft = String(payload?.draft ?? '');
    try {
      const {
        checkImprovable, cleanImprovedPrompt, isUsefulImprovement,
        buildImproveUserPrompt, IMPROVE_SYSTEM_PROMPT,
      } = await import('../shared/prompt-improve');

      const check = checkImprovable(draft);
      if (!check.ok) return { success: false, error: check.message };

      const settings = getSettings();
      const cloud = resolveCloudLLM(settings);
      let raw = '';

      if (cloud.active && cloud.config) {
        raw = await generateFromCustomLLM(
          cloud.config,
          IMPROVE_SYSTEM_PROMPT,
          buildImproveUserPrompt(draft),
          { timeoutMs: 25_000 },
        );
      } else {
        const ollamaBase = getConfiguredOllamaBaseUrl();
        const model = settings.chatModel || process.env.OLLAMA_MODEL || 'qwen2.5:7b';
        const resp = await axios.post(
          `${ollamaBase}/api/generate`,
          {
            model,
            prompt: `${IMPROVE_SYSTEM_PROMPT}

${buildImproveUserPrompt(draft)}`,
            stream: false,
            // Low temperature: this is a rewrite, not a brainstorm. Creativity
            // here shows up as invented requirements.
            options: { temperature: 0.2, num_predict: 400 },
          },
          { timeout: OLLAMA_OP_TIMEOUT }
        );
        raw = resp.data?.response ?? '';
      }

      const improved = cleanImprovedPrompt(raw);
      if (!isUsefulImprovement(draft, improved)) {
        // Returning the draft back unchanged would look like a broken button.
        return { success: false, error: 'That already reads clearly — nothing worth changing.' };
      }

      return { success: true, improved, source: cloud.active ? 'cloud' : 'local' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Could not rewrite that just now.' };
    }
  });

  ipcMain.handle('homebot:load-automations', async () => {
    return { automations: readAutomations() };
  });

  /**
   * Fetch a set of RSS/Atom feeds for the Feeds panel.
   *
   * Filtering happens in the renderer against the list it already holds, so
   * typing in the search box costs nothing — this is only for going and getting
   * the feeds.
   */
  ipcMain.handle('homebot:fetch-feeds', async (_ev, payload: { sources?: string[] }) => {
    try {
      const { fetchFeeds, catalogueSources } = await import('./feed-reader');
      const sources = Array.isArray(payload?.sources) && payload.sources.length > 0
        ? payload.sources
        // No choice made yet — show the catalogue rather than an empty screen.
        : catalogueSources().map(s => s.id);
      const result = await fetchFeeds(sources);
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, items: [], failures: [], error: err?.message || 'Could not read feeds.' };
    }
  });

  ipcMain.handle('homebot:list-feed-sources', async () => {
    const { catalogueSources } = await import('./feed-reader');
    return { sources: catalogueSources() };
  });

  ipcMain.handle('homebot:create-automation', gatedAutomationHandler('homebot:create-automation', getCurrentTier, async (_event, data: { name: string; description: string; instructions: string; trigger: string; scheduleMinutes?: number; watchPath?: string; watchPattern?: string; n8nWebhookUrl?: string; deployToN8n?: boolean }) => {
    const automations = readAutomations();
    const automation: any = {
      id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: data.name,
      description: data.description,
      instructions: data.instructions,
      // 'file' must survive this coercion — it used to collapse to 'manual',
      // which made the UI's file trigger save as an automation that nothing
      // would ever fire. The scheduler's file-watch engine owns validation of
      // the folder; a bad path arms nothing and says so on the record.
      trigger: data.trigger === 'schedule' ? 'schedule' : data.trigger === 'file' ? 'file' : 'manual',
      scheduleMinutes: data.trigger === 'schedule' ? (data.scheduleMinutes || 60) : undefined,
      watchPath: data.trigger === 'file' ? (data.watchPath || undefined) : undefined,
      watchPattern: data.trigger === 'file' ? (data.watchPattern || undefined) : undefined,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    let error: string | undefined;

    if (data.n8nWebhookUrl?.trim()) {
      automation.n8nWebhookUrl = data.n8nWebhookUrl.trim();
    } else if (data.deployToN8n) {
      try {
        console.log('[Automation] Deploying n8n workflow for:', data.name);
        const wf = await createAndActivateWorkflow({
          automationName: data.name,
          instructions: data.instructions,
        });
        automation.n8nWebhookUrl = wf.webhookUrl;
        automation.n8nWorkflowId = wf.id;
        console.log('[Automation] n8n workflow deployed:', wf.webhookUrl);
      } catch (err: any) {
        console.error('[Automation] n8n deploy failed:', err);
        error = `n8n deploy failed: ${err?.message || err}. Automation created without n8n — will use local tools.`;
      }
    }

    automations.push(automation);
    writeAutomations(automations);
    return { automation, error };
  }));

  ipcMain.handle('homebot:update-automation', gatedAutomationHandler('homebot:update-automation', getCurrentTier, async (_event, data: { id: string; enabled?: boolean; name?: string; description?: string; instructions?: string; trigger?: string; scheduleMinutes?: number; watchPath?: string; watchPattern?: string; n8nWebhookUrl?: string }) => {
    const automations = readAutomations();
    const idx = automations.findIndex((a: any) => a.id === data.id);
    if (idx === -1) return { success: false, error: 'Automation not found' };
    const auto = automations[idx];
    if (data.enabled !== undefined) auto.enabled = data.enabled;
    if (data.name !== undefined) auto.name = data.name;
    if (data.description !== undefined) auto.description = data.description;
    if (data.instructions !== undefined) auto.instructions = data.instructions;
    // Empty strings clear the fields — the edit form sends them explicitly so
    // unsetting the folder actually unsets it (same contract as n8nWebhookUrl).
    if (data.watchPath !== undefined) auto.watchPath = data.watchPath || undefined;
    if (data.watchPattern !== undefined) auto.watchPattern = data.watchPattern || undefined;
    if (data.trigger !== undefined) auto.trigger = data.trigger;
    if (data.scheduleMinutes !== undefined) auto.scheduleMinutes = data.scheduleMinutes;
    if (data.n8nWebhookUrl !== undefined) auto.n8nWebhookUrl = data.n8nWebhookUrl || undefined;
    writeAutomations(automations);
    return { success: true };
  }));

  /**
   * Delete an automation, and the n8n workflow it deployed.
   *
   * This used to filter the array and write the file. The workflow stayed live
   * in n8n with its own trigger, and nothing in HomeBot pointed at it any more,
   * so it kept firing invisibly and could only be found by opening n8n. The id
   * needed to remove it was already stored on the record.
   *
   * If n8n refuses, the RECORD IS KEPT. Deleting it while the workflow survives
   * is what strands the workflow — the same reasoning as media_delete_job, which
   * keeps a job whose files it could not remove. Better a delete the user has to
   * repeat than an orphan they cannot see.
   */
  ipcMain.handle('homebot:delete-automation', async (_event, data: { id: string; force?: boolean }) => {
    const automations = readAutomations();
    const auto = automations.find((a: any) => a.id === data.id);
    if (!auto) return { success: false, error: 'Automation not found' };

    let workflowWarning: string | undefined;
    if (auto.n8nWorkflowId) {
      try {
        await deleteWorkflow(auto.n8nWorkflowId);
        console.log(`[Automation] Deleted n8n workflow ${auto.n8nWorkflowId} with "${auto.name}"`);
      } catch (err: any) {
        const message = err?.message || String(err);
        if (!data.force) {
          return {
            success: false,
            error:
              `"${auto.name}" still has an n8n workflow (${auto.n8nWorkflowId}) and it could not be removed: ` +
              `${message}. The automation has been kept so the workflow is not left running with nothing ` +
              `pointing at it. Start n8n and try again, or delete it anyway to remove only the HomeBot side.`,
            n8nWorkflowId: auto.n8nWorkflowId,
          };
        }
        workflowWarning =
          `Removed "${auto.name}", but its n8n workflow ${auto.n8nWorkflowId} could not be deleted (${message}). ` +
          `It is still in n8n and will keep running until you remove it there.`;
      }
    }

    writeAutomations(automations.filter((a: any) => a.id !== data.id));
    return { success: true, warning: workflowWarning };
  });

  const MAX_TOOL_ROUNDS = 6;
  const TOOL_ALIASES: Record<string, string> = { nba_scores: 'nba_query' };

  async function executeAutomation(auto: any): Promise<{ success: boolean; result?: string; error?: string }> {
    if (!auto?.instructions) return { success: false, error: 'Automation has no instructions' };

    let resultText = '';
    // Track failure explicitly rather than sniffing the output text — a
    // legitimate LLM response that begins with "Error:" is not a failed run.
    let errored = false;
    /** Set when an intended n8n run silently became a local one. */
    let deployNote: string | undefined;

    // Auto-deploy to n8n if no webhook URL yet and n8n is reachable
    if (!auto.n8nWebhookUrl) {
      try {
        const settings = getSettings();
        const n8nBase = settings.n8nUrl || 'http://localhost:5678';
        const healthRes = await axios.get(`${n8nBase.replace(/\/$/, '')}/healthz`, { timeout: 3000 });
        if (healthRes.status >= 200 && healthRes.status < 300) {
          console.log(`[Automation] n8n online — auto-deploying workflow for "${auto.name}"`);
          const wf = await createAndActivateWorkflow({ automationName: auto.name, instructions: auto.instructions });
          auto.n8nWebhookUrl = wf.webhookUrl;
          auto.n8nWorkflowId = wf.id;
          const automations = readAutomations();
          const idx = automations.findIndex((a: any) => a.id === auto.id);
          if (idx !== -1) { automations[idx] = auto; writeAutomations(automations); }
          console.log(`[Automation] Auto-deployed n8n workflow: ${wf.webhookUrl}`);
        }
      } catch (err: any) {
        // Falling back to local tools is the right behaviour; doing it in
        // silence was not. The card shows an n8n badge and the run reads as a
        // normal success, so without this line the user has no way to learn
        // that the automation they believe is running through n8n is not.
        console.warn('[Automation] n8n auto-deploy failed, running locally:', err?.message || err);
        deployNote =
          `n8n was not reachable, so this ran on HomeBot's local tools instead ` +
          `(${err?.message || err}).`;
      }
    }

    // ── Pre-gather local tool data for automations that need system access ──
    let enrichedMessage = auto.instructions;
    const needsSystemTools = /\b(get_system_info|list_processes|system.*resource|disk.*usage|memory|cpu|running.*process|ollama.*status)\b/i.test(auto.instructions);
    if (needsSystemTools) {
      const preCtx: ToolContext = { executionId: `automation-${auto.id}-pre-${Date.now()}` } as any;
      try {
        const sysInfo = await executeTool({ name: 'get_system_info', arguments: { detailed: true } }, preCtx);
        const sysStr = typeof sysInfo === 'string' ? sysInfo : JSON.stringify(sysInfo, null, 2);
        enrichedMessage += `\n\n--- System Info (pre-gathered) ---\n${sysStr}`;
      } catch (e: any) { console.log('[Automation] pre-gather get_system_info failed:', e?.message); }
      try {
        const procs = await executeTool({ name: 'list_processes', arguments: { sort_by: 'memory', limit: 25 } }, preCtx);
        const procStr = typeof procs === 'string' ? procs : JSON.stringify(procs, null, 2);
        enrichedMessage += `\n\n--- Running Processes (pre-gathered) ---\n${procStr}`;
      } catch (e: any) { console.log('[Automation] pre-gather list_processes failed:', e?.message); }
      try {
        // 127.0.0.1, never localhost: on a machine with Docker Desktop, its
        // model runner binds 0.0.0.0:11434 with an EMPTY model store and wins
        // the IPv6 race for `localhost` — every model reads as "not found"
        // while the real Ollama sits on 127.0.0.1 with them all installed.
        // Found live on Aden's machine; media-generate.ts already dodged it.
        const ollamaBase = process.env.OLLAMA_URL || getSettings().ollamaUrl || 'http://127.0.0.1:11434';
        const tagsRes = await axios.get(`${ollamaBase}/api/tags`, { timeout: 5000 });
        enrichedMessage += `\n\n--- Installed Ollama Models (pre-gathered) ---\n${JSON.stringify(tagsRes.data?.models?.map((m: any) => ({ name: m.name, size: m.size })) || [], null, 2)}`;
      } catch (e: any) { console.log('[Automation] pre-gather ollama tags failed:', e?.message); }
    }

    // ── n8n webhook path: POST to the user's n8n workflow ──
    let useN8n = !!auto.n8nWebhookUrl;
    if (useN8n) {
      console.log(`[Automation] n8n path: POST to ${auto.n8nWebhookUrl}`);
      try {
        const n8nRes = await axios.post(auto.n8nWebhookUrl, {
          message: enrichedMessage,
          automation_id: auto.id,
          automation_name: auto.name,
        }, {
          timeout: 120_000,
          // Every app-deployed workflow carries an Auth Guard that validates
          // this header. Without it the guard rejects HomeBot's own automation
          // runner, and the catch below used to read that as a stale URL and
          // delete the deployment.
          headers: homebotWebhookHeaders({ 'Content-Type': 'application/json' }),
        });

        const data = n8nRes.data;
        resultText = data?.output
          || data?.data?.assistant?.content
          || data?.message?.content
          || data?.result
          || (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
      } catch (err: any) {
        const status = err?.response?.status;

        // Only a 404 means the webhook is genuinely gone. Everything else —
        // a timeout, a container restarting, n8n not up yet, a 500 from a
        // guard rejecting us — is temporary, and this block used to treat all
        // of them the same and DELETE the deployment.
        //
        // That is unrecoverable from the user's side: the ids are erased from
        // disk, so the automation silently stops using n8n forever and there
        // is nothing in the interface explaining why. One scheduled run during
        // a restart was enough. Falling back to local for this run is the right
        // response to a transient failure; forgetting the deployment is not.
        const webhookIsGone = status === 404;

        if (webhookIsGone) {
          console.log(`[Automation] n8n webhook is gone (404), clearing stale URL and falling back to local`);
          auto.n8nWebhookUrl = '';
          auto.n8nWorkflowId = '';
          const automations = readAutomations();
          const idx = automations.findIndex((a: any) => a.id === auto.id);
          if (idx !== -1) { automations[idx] = auto; writeAutomations(automations); }
        } else {
          console.log(`[Automation] n8n webhook failed (${status || err?.code || err?.message}) — falling back to local for this run, keeping the deployment`);
        }

        useN8n = false;
      }
    }

    if (!useN8n && !resultText) {
      // ── LLM execution: prefer cloud API, fall back to Ollama ──
      const settings = getSettings();
      const isCustom = resolveCloudLLM(settings).active;
      const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const systemMsg = `You are HomeBot, a desktop AI assistant. Today is ${today}. Execute the user's automation task. Be concise and well-formatted. Use markdown for the final response.`;

      if (isCustom) {
        // ── Cloud LLM path (Gemini, OpenAI, Anthropic, etc.) ──
        try {
          console.log('[Automation] Calling cloud LLM...');
          const raw = await quizLLMGenerate(enrichedMessage, systemMsg);
          resultText = raw || 'Automation completed but produced no output.';
          console.log('[Automation] Cloud LLM succeeded, result length:', resultText.length);
        } catch (err: any) {
          const errDetail = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err?.message;
          console.error('[Automation] Cloud LLM failed:', errDetail);
          resultText = '';
        }
      }

      if (!resultText) {
        // ── Ollama agentic tool-calling loop ──
        // 127.0.0.1, never localhost — see the note on the sibling above.
        const ollamaBase = process.env.OLLAMA_URL || settings.ollamaUrl || 'http://127.0.0.1:11434';
        const ollamaModel = process.env.OLLAMA_MODEL || settings.chatModel || 'qwen2.5:7b';

        // Quick reachability check before committing to 120s timeout
        try {
          await axios.get(`${ollamaBase}/api/tags`, { timeout: 3000 });
        } catch {
          resultText = 'Error: No AI backend available. Cloud LLM failed and Ollama is not running. Check your API key in Settings or start Ollama.';
          errored = true;
        }

        if (!resultText) {
          const tools = getFocusedOllamaTools();
          const messages: any[] = [
            { role: 'system', content: systemMsg },
            { role: 'user', content: enrichedMessage },
          ];

          try {
            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
              const ollamaRes = await axios.post(`${ollamaBase}/api/chat`, {
                model: ollamaModel,
                messages,
                tools,
                stream: false,
                options: { num_predict: 2048, temperature: 0.7 },
              }, { timeout: 120_000 });

              const msg = ollamaRes.data?.message;
              if (!msg) { resultText = 'No response from model'; break; }

              const toolCalls = msg.tool_calls;
              if (!toolCalls || toolCalls.length === 0) {
                resultText = msg.content || 'Done.';
                break;
              }

              messages.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });
              const toolCtx: ToolContext = { executionId: `automation-${auto.id}-r${round}-${Date.now()}` } as any;

              for (const tc of toolCalls) {
                const toolName = TOOL_ALIASES[tc.function?.name] || tc.function?.name || tc.name;
                let toolArgs = tc.function?.arguments || tc.arguments || {};
                if (typeof toolArgs === 'string') {
                  try { toolArgs = JSON.parse(toolArgs); } catch { toolArgs = {}; }
                }

                console.log(`[Automation] Round ${round + 1}: calling ${toolName}`, toolArgs);
                let toolResult: any;
                try {
                  toolResult = await executeTool({ name: toolName, arguments: toolArgs }, toolCtx);
                } catch (err: any) {
                  toolResult = { success: false, error: err?.message || String(err) };
                }

                const resultStr = typeof toolResult === 'string'
                  ? toolResult
                  : JSON.stringify(toolResult, null, 2).slice(0, 4000);
                messages.push({ role: 'tool', content: resultStr });
              }
            }
          } catch (err: any) {
            resultText = `Error: ${err?.message || err}`;
            errored = true;
          }
        }
      }
    }

    if (!resultText) resultText = 'Automation completed but produced no output.';

    // Prepend rather than append: the reason a run behaved differently belongs
    // above the output, not after a wall of it.
    if (deployNote) resultText = `${deployNote}\n\n${resultText}`;

    // Persist result
    const automations = readAutomations();
    const stored = automations.find((a: any) => a.id === auto.id);
    if (stored) {
      stored.lastRun = new Date().toISOString();
      stored.lastResult = resultText;
      stored.lastStatus = errored ? 'error' : 'success';
      writeAutomations(automations);
    }

    return errored
      ? { success: false, error: resultText }
      : { success: true, result: resultText };
  }

  ipcMain.handle('homebot:run-automation', gatedAutomationHandler('homebot:run-automation', getCurrentTier, async (_event, data: { id: string }) => {
    const automations = readAutomations();
    const auto = automations.find((a: any) => a.id === data.id);
    if (!auto) return { success: false, error: 'Automation not found' };
    return executeAutomation(auto);
  }));

  // Let the chat-facing automation tools (create_automation, run_automation, …)
  // fire automations through the same execution engine as the UI, and share the
  // app's Pro tier so those tools are fenced the same way the IPC channels are.
  registerAutomationRunner(executeAutomation);
  registerAutomationTierProvider(getCurrentTier);

  // Feed the n8n layer the URL + API key from Settings, so workflow
  // management authenticates through HomeBot's own configuration (REST API)
  // instead of requiring docker exec access.
  registerN8nConnectionProvider(() => {
    const s = getSettings();
    return { baseUrl: s.n8nUrl || 'http://localhost:5678', apiKey: (s as any).n8nApiKey };
  });

  // Settings → n8n "Test connection" button. Accepts unsaved values so the
  // user can verify a key before hitting Save.
  ipcMain.handle('homebot:n8n-test-connection', async (_event, data: { baseUrl?: string; apiKey?: string } | undefined) => {
    try {
      return await verifyN8nConnection(data);
    } catch (err: any) {
      return { reachable: false, authenticated: null, error: err?.message || 'Connection test failed' };
    }
  });

  // ── Scheduled automation timer ──
  // Each entry keeps the live interval plus a signature of the config that
  // produced it. The resync below only touches timers whose signature changed
  // — rebuilding every timer on each 60s tick would reset the interval before
  // it could ever elapse, so scheduled automations would never fire.
  const automationTimers = new Map<string, { timer: ReturnType<typeof setInterval>; sig: string }>();

  function scheduleSignature(auto: any): string {
    return `${auto.scheduleMinutes}`;
  }

  function makeAutomationTimer(id: string, ms: number): ReturnType<typeof setInterval> {
    return setInterval(async () => {
      const fresh = readAutomations().find((a: any) => a.id === id);
      if (!fresh || !fresh.enabled) return;
      console.log(`[Automation] Running scheduled: "${fresh.name}"`);
      const result = await executeAutomation(fresh);
      // Notify renderer
      try {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send('homebot:reminder-fired', {
            message: `Automation "${fresh.name}" completed: ${result.result || result.error || 'done'}`,
            label: fresh.name,
          });
        }
      } catch { /* ignore */ }
    }, ms);
  }

  function startAutomationSchedule() {
    const automations = readAutomations();
    const wanted = new Map<string, { ms: number; sig: string }>();
    for (const auto of automations) {
      if (auto.trigger === 'schedule' && auto.enabled && auto.scheduleMinutes > 0) {
        wanted.set(auto.id, { ms: auto.scheduleMinutes * 60_000, sig: scheduleSignature(auto) });
      }
    }

    // Remove timers for automations that are gone, disabled, or rescheduled.
    for (const [id, existing] of automationTimers) {
      const want = wanted.get(id);
      if (!want || want.sig !== existing.sig) {
        clearInterval(existing.timer);
        automationTimers.delete(id);
      }
    }

    // Add timers for newly-scheduled or rescheduled automations.
    for (const [id, { ms, sig }] of wanted) {
      if (!automationTimers.has(id)) {
        automationTimers.set(id, { timer: makeAutomationTimer(id, ms), sig });
      }
    }
  }

  // Start scheduled automations on boot (with a delay to let the app settle).
  // Also unref'd — same reasoning as the resync timer below.
  const scheduleBootTimer = setTimeout(startAutomationSchedule, 5000);
  (scheduleBootTimer as any).unref?.();

  // Re-sync schedules every 60s to pick up CRUD changes.
  //
  // unref'd so it cannot hold the process open on its own. In the real app the
  // Electron event loop keeps us alive, so this changes nothing there — but any
  // test that calls registerIpcHandlers() inherits a live 60s timer with no way
  // to clear it (the clearInterval below hangs off 'before-quit', which never
  // fires under Jest). That kept the whole widget suite from exiting: the tests
  // finished in ~86s and the runner then hung indefinitely.
  const scheduleResyncTimer = setInterval(startAutomationSchedule, 60_000);
  (scheduleResyncTimer as any).unref?.();

  app.on?.('before-quit', () => {
    clearInterval(scheduleResyncTimer);
    for (const t of automationTimers.values()) clearInterval(t.timer);
    automationTimers.clear();
  });

  // ── Quiz Mode ──────────────────────────────────────────────────────────────

  const QUIZ_PROGRESS_FILE = path.join(app.getPath('userData'), 'quiz-progress.json');

  async function quizLLMGenerate(prompt: string, systemPrompt: string): Promise<string> {
    const settings = getSettings();
    const quizCloud = resolveCloudLLM(settings);

    if (quizCloud.active && quizCloud.config) {
      // Was a hand-rolled axios call that assumed an HTTP endpoint — which
      // gave "Invalid URL" for claude-code (a CLI subprocess with no apiUrl).
      return await generateFromCustomLLM(quizCloud.config, systemPrompt, prompt);
    }

    const model = settings.chatModel || 'qwen2.5:7b';
    const resp = await axios.post(`${getConfiguredOllamaBaseUrl()}/api/generate`, {
      model,
      prompt,
      system: systemPrompt,
      stream: false,
      options: { temperature: 0.7, num_predict: 3000 }
    }, { timeout: 120_000 });
    return resp.data?.response ?? '';
  }

  ipcMain.handle('homebot:generate-quiz', async (_event, params: { topic: string; difficulty: string; questionCount: number; questionTypes?: string[]; language?: string }) => {
    try {
      const { topic, difficulty, questionCount } = params;

      // Generate in small batches to avoid timeout on slower GPUs.
      // Validation + dedup live in src/quiz/generate (CI-gated): invalid
      // items are dropped, never padded into filler questions, and dupes /
      // prompt-example echoes are removed across batches. Because rejects
      // can leave a batch short, keep generating (bounded) until the quiz
      // is full instead of silently returning fewer questions.
      const filled = await fillQuiz({
        questionCount,
        generate: async (count, existing) => {
          const prompt = `Generate exactly ${count} ${difficulty} difficulty quiz questions about ${topic}.
RULES:
- Respond with ONLY a JSON array, nothing else
- Every question MUST have exactly 4 options in the "options" array
- "correctIndex" is the index (0-3) of the correct answer in "options"
- The correct answer MUST be one of the 4 options
- Mix question types: multiple-choice, code-output, bug-fix, concept

EXAMPLE (follow this format exactly):
[{"type":"multiple-choice","question":"Which keyword defines a function in Python?","code":"","options":["def","func","function","define"],"correctIndex":0,"explanation":"The def keyword is used to define functions in Python."},{"type":"code-output","question":"What does this code print?","code":"print(2 ** 3)","options":["6","8","9","23"],"correctIndex":1,"explanation":"2 ** 3 means 2 to the power of 3, which is 8."}]${buildAvoidClause(existing)}`;

          return await quizLLMGenerate(prompt, 'You are a quiz generator. Output ONLY a valid JSON array. No markdown, no backticks, no explanation.') || '';
        },
        onBatch: ({ attempt, got, total, raw }) => {
          console.log(`[Quiz] Batch ${attempt}: +${got} valid question(s), ${total} so far, from ${raw.length} chars`);
          if (got === 0) console.warn(`[Quiz] Batch ${attempt}: nothing usable. Raw:`, raw.slice(0, 300));
        },
      });

      if (filled.questions.length === 0) {
        return { success: false, error: 'Could not generate quiz questions. Check that your LLM provider is running and accessible.' };
      }

      const validated = filled.questions.map((q, i) => ({ id: `q-${Date.now()}-${i}`, ...q }));

      // Say when it came up short instead of quietly handing over fewer.
      // Reported live: asked for 5, given 3, told nothing.
      return {
        success: true,
        questions: validated,
        requested: filled.requested,
        shortfall: filled.shortfall,
        ...(filled.shortfall > 0 ? {
          notice: `Only ${validated.length} of the ${filled.requested} questions came out usable this time — the rest were repeats or malformed. Try again, or pick a broader topic.`,
        } : {}),
      };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('homebot:save-quiz-progress', async (_event, progress: any) => {
    try {
      fs.writeFileSync(QUIZ_PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('homebot:load-quiz-progress', async () => {
    try {
      if (!fs.existsSync(QUIZ_PROGRESS_FILE)) {
        return { success: true, data: null };
      }
      const raw = fs.readFileSync(QUIZ_PROGRESS_FILE, 'utf8');
      return { success: true, data: JSON.parse(raw) };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // ── Screen Capture ──────────────────────────────────────────────────────────
  ipcMain.handle('homebot:capture-screen', async () => {
    try {
      const { desktopCapturer } = require('electron');
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      });
      if (!sources || sources.length === 0) {
        return { success: false, error: 'No screen sources found' };
      }
      const thumbnail = sources[0].thumbnail;
      const dataUrl = thumbnail.toDataURL();
      return { success: true, dataUrl };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // ── Quiz from RAG (Study Buddy) ─────────────────────────────────────────
  ipcMain.handle('homebot:generate-quiz-from-rag', async (_event, params: { topic: string; difficulty: string; questionCount: number }) => {
    try {
      const { topic, difficulty, questionCount } = params;

      // Query RAG for relevant chunks
      let ragContext = '';
      try {
        const ragResult = await ragToolHandlers.rag_query({ query: topic, top_k: 5 }, {} as any);
        if (ragResult?.success && ragResult?.result?.results) {
          ragContext = ragResult.result.results.map((r: any) => r.text || r.content || '').join('\n\n');
        }
      } catch (e) { /* RAG not available, will use general knowledge */ }

      if (!ragContext) {
        return { success: false, error: 'No indexed documents found. Drop some study notes into the RAG panel first, then try again.' };
      }

      // Same validated pipeline as the general quiz handler — see
      // src/quiz/generate. Bounded retry because rejects can shorten a batch.
      const filled = await fillQuiz({
        questionCount,
        generate: async (count, existing) => {
          const prompt = `Based on ONLY the following study material, generate exactly ${count} ${difficulty} quiz questions about "${topic}".

STUDY MATERIAL:
${ragContext.slice(0, 3000)}

RULES:
- Respond with ONLY a JSON array, nothing else
- Every question MUST have exactly 4 options
- "correctIndex" is the index (0-3) of the correct answer in "options"
- Base questions strictly on the material above

EXAMPLE FORMAT:
[{"type":"multiple-choice","question":"What is X?","code":"","options":["Answer A","Answer B","Answer C","Answer D"],"correctIndex":0,"explanation":"A is correct because..."}]${buildAvoidClause(existing)}`;

          return await quizLLMGenerate(prompt, 'You output ONLY valid JSON arrays. No markdown fences. No backticks. No explanation. Just raw JSON.') || '';
        },
        onBatch: ({ attempt, got, total, raw }) => {
          console.log(`[Quiz/RAG] Batch ${attempt}: +${got} valid question(s), ${total} so far, from ${raw.length} chars`);
        },
      });

      if (filled.questions.length === 0) {
        return { success: false, error: 'Could not generate questions from your notes. Try a different topic or add more study material.' };
      }

      const validated = filled.questions.map((q, i) => ({ id: `q-${Date.now()}-${i}`, ...q }));

      return {
        success: true,
        questions: validated,
        requested: filled.requested,
        shortfall: filled.shortfall,
        ...(filled.shortfall > 0 ? {
          notice: `Only ${validated.length} of the ${filled.requested} questions came out usable from your notes — the rest were repeats or malformed. Try a broader topic, or add more material.`,
        } : {}),
      };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // ---- Skills ----------------------------------------------------------
  // A skill is a folder with a SKILL.md; these back the Skills page in
  // Settings. Without a visible surface the whole feature is invisible, which
  // is the failure mode that hid several capabilities in this codebase already.

  ipcMain.handle('homebot:skills-list', async () => {
    try {
      // Re-read from disk each time: the user may have edited a file in the
      // folder since launch, and a stale list would make their edit look lost.
      const skills = reloadSkills();
      return {
        success: true,
        dir: skillsDir(),
        skills: skills.map((s: Skill) => ({
          name: s.name,
          description: s.description,
          whenToUse: s.whenToUse ?? null,
          tools: s.tools ?? null,
          path: s.path,
        })),
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Could not read skills.' };
    }
  });

  ipcMain.handle('homebot:skills-open-folder', async () => {
    try {
      const dir = skillsDir();
      fs.mkdirSync(dir, { recursive: true });
      await shell.openPath(dir);
      return { success: true, dir };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Could not open the skills folder.' };
    }
  });

  // ---- Active model (header display) -----------------------------------
  // The header asks the ROUTER who would answer, instead of re-deriving the
  // decision from its own settings copy. Every header-vs-badge disagreement
  // this month came from that second derivation drifting.
  ipcMain.handle('homebot:resolve-active-model', async () => {
    try {
      return { success: true, ...describeActiveModel(getSettings() as any) };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Could not resolve the active model.' };
    }
  });

  // ---- File changes (review what HomeBot did) ---------------------------
  ipcMain.handle('homebot:changes-list', async () => {
    try {
      return { success: true, changes: listChanges() };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Could not read the change log.' };
    }
  });

  ipcMain.handle('homebot:changes-diff', async (_e, id: string) => {
    try {
      const change = getChange(String(id || ''));
      if (!change) return { success: false, error: 'That change is no longer in the log.' };
      const diff = diffText(change.before, change.after);
      return {
        success: true,
        path: change.path,
        tool: change.tool,
        created: change.created,
        at: change.at,
        stats: diff.stats,
        // Hunks, not the whole file: reviewing one changed line should not
        // mean scrolling a thousand identical ones.
        hunks: toHunks(diff, 3),
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Could not build the diff.' };
    }
  });

  // Mark registration complete
  (global as any).__homebot_ipc_registered = true;
  if (isDevelopment) {
    console.log('[IPC] Handlers registered');
  }
}
