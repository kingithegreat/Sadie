import { ipcMain, BrowserWindow, app, shell } from 'electron';
import { getMainWindow, toggleWidgetMode, getWidgetMode } from './window-manager';

/** Catch handler for fire-and-forget ops — logs instead of silently swallowing */
function safeCatch(e: unknown) { console.error('[SADIE-CATCH]', e); }

import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, execFile } from 'child_process';

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
  exportTelemetryConsent 
} from './config-manager';
import { fetchAvailableCustomModels, PROVIDER_API_URLS } from './custom-llm-client';
import { setTavilyApiKey, setSerperApiKey, setStableHordeApiKey, webToolHandlers } from './tools/web';
import { ragToolHandlers } from './tools/rag';
import { setUncensoredMode, getUncensoredMode as routerGetUncensoredMode, ensureHydrated, clearHistory, resyncHistoryFromStore } from './message-router';
import { getAllToolDefinitions } from './tools/index';
import { detectGpuVram, recommendConfig } from './moa';
import { speakHandler, stopSpeakingHandler } from './tools/voice';
import { listJobs, addJob, removeJob, toggleJob } from './scheduler';
import {
  loadMcpConfig,
  saveMcpConfig,
  getMcpStatus,
  type McpServerConfig
} from './mcp-client';
import {
  MemoryManager,
  StoredConversation,
  ConversationSearchResult,
} from './memory-manager';
import { Message } from '../shared/types';
import { DEFAULT_OLLAMA_URL } from '../shared/constants';
import { isDevelopment, isDemoMode } from './env';
import { sadieWebhookHeaders } from './webhook-auth';
import { logTelemetryEvent, readToolCallAggregates } from './utils/logger';


/**
 * Register all IPC handlers for communication between renderer and main process
 */
export function registerIpcHandlers(mainWindow?: BrowserWindow): void {
    // Idempotency guard: prevent duplicate registrations which Electron disallows.
    // Handlers should be registered before any BrowserWindow exists to satisfy
    // early renderer invokes during startup without races.
    // Note: we store a flag on the global to persist across reloads in dev.
    const g = global as any;
    if (g.__sadie_ipc_registered) {
      // Only log idempotent registration warnings in development
      if (isDevelopment) {
        console.log('[IPC] registerIpcHandlers already executed — skipping');
        try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] registerIpcHandlers already executed — skipping'); } catch (e) { safeCatch(e); }
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
    ipcMain.handle('sadie:check-connection', async () => {
      const settings = getSettings();
      const n8nBase = settings.n8nUrl || 'http://localhost:5678';
      const n8nHealth = `${n8nBase.replace(/\/$/, '')}/healthz`;
      const result = { n8n: 'checking', ollama: 'checking', lastChecked: new Date().toISOString() } as any;
      try {
        const r = await axios.get(n8nHealth, { timeout: HEALTH_CHECK_TIMEOUT });
        if (r && r.status && r.status >= 200 && r.status < 300) result.n8n = 'online';
        else result.n8n = 'offline';
      } catch (e) {
        result.n8n = 'offline';
      }

      try {
        // Ollama may not expose /healthz; a simple GET on base URL will suffice for a quick check
        const settings = getSettings();
        const ollamaBase = (process.env.OLLAMA_URL || settings.ollamaUrl || DEFAULT_OLLAMA_URL).trim();
        const r2 = await axios.get(ollamaBase, { timeout: HEALTH_CHECK_TIMEOUT });
        result.ollama = (r2 && r2.status && r2.status >= 200 && r2.status < 500) ? 'online' : 'offline';
      } catch (e) {
        result.ollama = 'offline';
      }

      result.lastChecked = new Date().toISOString();
      return result as { n8n: 'online'|'offline'|'checking'; ollama: 'online'|'offline'|'checking'; lastChecked: string };
    });

    // Uncensored Mode Handlers
    ipcMain.handle('sadie:get-uncensored-mode', async () => {
      try {
        return { enabled: routerGetUncensoredMode() };
      } catch (e) {
        const settings = getSettings();
        return { enabled: !!settings.uncensoredMode };
      }
    });

    ipcMain.handle('sadie:set-uncensored-mode', async (_event, enabled: boolean) => {
      const settings = getSettings();
      settings.uncensoredMode = enabled;
      saveSettings(settings); // This function is already imported from config-manager
      try { setUncensoredMode(enabled); } catch (e) { console.error('[IPC] Failed to set uncensored mode runtime flag:', (e as any)?.message || e); }
      return { success: true, enabled: settings.uncensoredMode };
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

    ipcMain.handle('sadie:toggle-widget-mode', () => {
      return toggleWidgetMode();
    });

    ipcMain.handle('sadie:get-widget-mode', () => {
      return getWidgetMode();
    });

    ipcMain.on('sadie:set-always-on-top', (_event, value: boolean) => {
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(value);
      }
    });
  
  /**
   * Handle message from renderer → forward to n8n orchestrator
   */
  ipcMain.on('sadie:message', async (_event, { message, conversationId }) => {
    try {
      console.log('[Main] Received sendMessage', { conversationId, preview: String(message).substring(0,120) });
      try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push(`[MAIN] Received sendMessage conv=${conversationId} preview=${String(message).substring(0,120)}`); } catch (e) { safeCatch(e); }
          // Load settings to get n8n URL
          const settings = getSettings();
      console.log('[Main] Calling messageRouter.sendStreamRequest (via axios post)');
      try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] Calling messageRouter.sendStreamRequest (via axios post)'); } catch (e) { safeCatch(e); }

      // Send message to n8n orchestrator
      const response = await axios.post(`${settings.n8nUrl}/webhook/sadie/chat`, {
        user_id: 'desktop-user',
        conversation_id: conversationId || 'default',
        message: message,
        timestamp: new Date().toISOString()
      }, {
        timeout: OLLAMA_OP_TIMEOUT,
        headers: sadieWebhookHeaders()
      });

      // Send response back to renderer
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('sadie:reply', {
        success: true,
        data: response.data
        });
      }
      console.log('[Main] sendStreamRequest returned', { status: response.status });
      try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push(`[MAIN] sendStreamRequest returned status=${response.status}`); } catch (e) { safeCatch(e); }

    } catch (err: any) {
      console.error('Error communicating with n8n orchestrator:', err.message);
      
      // Send error response back to renderer
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('sadie:reply', {
          success: false,
          error: true,
          message: 'Sadie could not reach the orchestrator.',
          details: err.message,
          response: 'I\'m having trouble connecting to my backend. Please make sure n8n is running.'
        });
      }
    }
  });

  // Image generation panel: delegates to the same tool handler used in chat
  ipcMain.handle('sadie:automation:image:generate', async (_event, { payload }) => {
    const prompt = String(payload?.prompt || '').trim();
    const width = Number(payload?.width) || 512;
    const height = Number(payload?.height) || 512;
    const steps = Number(payload?.steps) || 20;
    const backend = payload?.backend || 'hybrid';

    if (!prompt) {
      return { status: 'failure', timestamp: new Date().toISOString(), operation: 'image_generate', source: null, image: null, metadata: { prompt }, validation: { validated: false }, error: { message: 'Prompt is required', code: 'INVALID_INPUT' } };
    }

    try {
      const toolResult = await webToolHandlers['image_generate'](
        { prompt, width, height, steps, backend },
        { executionId: `img-panel-${Date.now()}` } as any
      );

      if (toolResult.success && toolResult.result?.image_base64) {
        return {
          status: 'success',
          timestamp: new Date().toISOString(),
          operation: 'image_generate',
          source: toolResult.result.source || 'unknown',
          image: toolResult.result.image_base64,
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
  });

  /**
   * Get user settings from file
   */
  ipcMain.handle('sadie:get-settings', async () => {
    try {
      return getSettings();
    } catch (err: any) {
      console.error('Error loading settings:', err.message);
      return getSettings();
    }
  });

  ipcMain.handle('sadie:list-custom-llm-models', async (_event, payload) => {
    try {
      console.log('[IPC] Fetching custom LLM models with config:', {
        apiUrl: payload?.apiUrl,
        provider: payload?.provider,
        hasApiKey: !!payload?.apiKey
      });
      
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
      
      const models = await fetchAvailableCustomModels(payload || {});
      console.log('[IPC] Successfully fetched', models.length, 'models');
      return { success: true, models };
    } catch (err: any) {
      console.error('[IPC] Failed to fetch custom LLM models:', err?.message || err);
      return { success: false, error: err?.message || 'Unable to fetch models' };
    }
  });

  // Check a single permission for a given tool (used by renderer to hide/disable UI)
  ipcMain.handle('sadie:has-permission', async (_event, toolName: string) => {
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
  ipcMain.handle('sadie:save-settings', async (_event, settings) => {
    try {
      const prev = getSettings();
      const merged = { ...prev, ...settings };
      saveSettings(merged);

      // Track model changes
      if (merged.chatModel && merged.chatModel !== prev.chatModel) {
        try { logTelemetryEvent('model_switch', { from: prev.chatModel, to: merged.chatModel }); } catch (_e) {}
      }

      // Refresh search API keys in memory
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
  ipcMain.handle('sadie:get-config-path', async () => {
    return getSettingsPath();
  });

  ipcMain.handle('sadie:get-env', async () => {
    return {
      isE2E: !!process.env.SADIE_E2E,
      isPackagedBuild: app.isPackaged,
      isReleaseBuild: app.isPackaged,
      userDataPath: app.getPath('userData')
    };
  });

  ipcMain.handle('sadie:reset-permissions', async () => {
    try {
      const updated = resetPermissions();
      return { success: true, data: updated };
    } catch (err: any) {
      console.error('Error resetting permissions:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sadie:export-consent', async () => {
    try {
      const result = exportTelemetryConsent();
      return result;
    } catch (err: any) {
      console.error('Error exporting telemetry consent:', err.message);
      return { success: false, error: err.message };
    }
  });

  // List all registered tools
  // ── RAG: index a local file (called from the renderer drag-and-drop UI) ──
  ipcMain.handle('sadie:rag-index', async (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'filePath is required' };
      }
      const result = await ragToolHandlers.rag_index({ path: filePath }, {} as any);
      return result;
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // ── RAG: list all indexed documents ──
  ipcMain.handle('sadie:rag-list', async () => {
    try {
      return await ragToolHandlers.rag_list({}, {} as any);
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // ── RAG: remove a document from the index ──
  ipcMain.handle('sadie:rag-clear', async (_event, docId: string) => {
    try {
      if (!docId || typeof docId !== 'string') {
        return { success: false, error: 'doc_id is required' };
      }
      return await ragToolHandlers.rag_clear({ doc_id: docId }, {} as any);
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('sadie:list-tools', async () => {
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

  // Export chat history as markdown
  ipcMain.handle('sadie:export-chat', async (_event, markdown: string) => {
    try {
      const desktop = app.getPath('desktop');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filePath = path.join(desktop, `sadie-chat-${ts}.md`);
      fs.writeFileSync(filePath, markdown, 'utf-8');
      return { success: true, path: filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // E2E ping helper - used by tests to ensure main is responsive
  ipcMain.handle('sadie:__e2e_ping', async () => {
    try { (global as any).__SADIE_ROUTER_LOG_BUFFER = (global as any).__SADIE_ROUTER_LOG_BUFFER || []; (global as any).__SADIE_ROUTER_LOG_BUFFER.push('[E2E] ping'); } catch (e) { safeCatch(e); }
    return { ok: true };
  });

  // Expose current app mode (demo or normal)
  ipcMain.handle('sadie:get-mode', async () => {
    return { demo: !!isDemoMode };
  });

  // GPU VRAM detection and hardware-aware model recommendations
  ipcMain.handle('sadie:detect-gpu-vram', async () => {
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

  // List installed Ollama models via /api/tags
  ipcMain.handle('sadie:list-ollama-models', async () => {
    const settings = getSettings();
    const ollamaBase = (process.env.OLLAMA_URL || settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
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
  ipcMain.handle('sadie:delete-ollama-model', async (_event, modelName: string) => {
    if (!modelName || typeof modelName !== 'string') {
      return { success: false, error: 'Invalid model name' };
    }
    const settings = getSettings();
    const ollamaBase = (process.env.OLLAMA_URL || settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    try {
      await axios.delete(`${ollamaBase}/api/delete`, { data: { name: modelName }, timeout: OLLAMA_OP_TIMEOUT });
      return { success: true, model: modelName };
    } catch (err: any) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  // Pull an Ollama model with progress reporting
  ipcMain.handle('sadie:pull-model', async (_event, modelName: string) => {
    if (!modelName || typeof modelName !== 'string' || !/^[a-z0-9._:/-]+$/i.test(modelName)) {
      return { success: false, error: 'Invalid model name' };
    }
    const settings = getSettings();
    const ollamaBase = (process.env.OLLAMA_URL || settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
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
  ipcMain.handle('sadie:start-ollama', async () => {
    const settings = getSettings();
    const ollamaBase = (process.env.OLLAMA_URL || settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');

    // Already running? Don't spawn a duplicate.
    try {
      await axios.get(`${ollamaBase}/api/tags`, { timeout: HEALTH_CHECK_TIMEOUT });
      return { success: true, alreadyRunning: true };
    } catch { /* not running — proceed */ }

    try {
      const cmd = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
      const child = spawn(cmd, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', safeCatch);
      child.unref();

      // Poll for readiness (up to ~8s) so the UI can flip from "offline" to "ready"
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
        try {
          await axios.get(`${ollamaBase}/api/tags`, { timeout: OLLAMA_READY_POLL_TIMEOUT });
          return { success: true, alreadyRunning: false };
        } catch { /* keep polling */ }
      }
      return { success: false, error: 'Ollama did not become ready within 8s. Check the terminal for errors.' };
    } catch (err: any) {
      return {
        success: false,
        error: err?.code === 'ENOENT'
          ? 'Ollama is not installed or not on PATH. Install it from https://ollama.com/download.'
          : String(err?.message || err),
      };
    }
  });

  // Read telemetry consent log (JSONL) for UI display
  ipcMain.handle('sadie:read-consent-log', async () => {
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
  ipcMain.handle('sadie:read-telemetry-events', async () => {
    try {
      const userData = app.getPath('userData');
      const pathsToCheck = [
        path.join(userData, 'logs', 'telemetry-events.log'),
        path.join(os.homedir(), 'SADIE_DIAG', 'telemetry-events.log')
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

  // Analytics summary — aggregated conversation stats for the dashboard
  ipcMain.handle('sadie:get-analytics-summary', async () => {
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
  ipcMain.handle('sadie:read-debug-logs', async () => {
    try {
      const rendererLogs = (global as any).__SADIE_RENDERER_LOGS || [];
      const mainLogs = (global as any).__SADIE_MAIN_LOG_BUFFER || [];
      const store = MemoryManager.loadConversationStore();
      return { success: true, rendererLogs, mainLogs, conversationStore: store };
    } catch (err: any) {
      console.error('Failed to read debug logs:', err);
      return { success: false, error: String(err) };
    }
  });

  // Append renderer log to in-memory buffer for diagnostics
  ipcMain.on('sadie:append-renderer-log', (_event, line: string) => {
    try {
      if (!(global as any).__SADIE_RENDERER_LOGS) (global as any).__SADIE_RENDERER_LOGS = [];
      (global as any).__SADIE_RENDERER_LOGS.push(line);
      if ((global as any).__SADIE_RENDERER_LOGS.length > 500) {
        (global as any).__SADIE_RENDERER_LOGS.shift();
      }
    } catch (e) { safeCatch(e); }
  });

  // Capture logs: write runtime snapshot to temp file and return path
  ipcMain.handle('sadie:capture-logs', async () => {
    try {
      const rendererLogs = (global as any).__SADIE_RENDERER_LOGS || [];
      const mainLogs = (global as any).__SADIE_MAIN_LOG_BUFFER || [];
      const logContent = [
        '=== SADIE Log Capture ===',
        `Timestamp: ${new Date().toISOString()}`,
        '',
        '--- Main Process Logs ---',
        ...mainLogs,
        '',
        '--- Renderer Logs ---',
        ...rendererLogs,
      ].join('\n');
      const logPath = path.join(os.tmpdir(), `sadie-logs-${Date.now()}.txt`);
      fs.writeFileSync(logPath, logContent, 'utf-8');
      return { success: true, path: logPath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Restart the application
  ipcMain.handle('sadie:restart-app', async () => {
    app.relaunch();
    app.quit();
  });

  // ============= Memory / Conversation Handlers =============

  /**
   * Load all conversations (list view)
   */
  ipcMain.handle('sadie:load-conversations', async () => {
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
  ipcMain.handle('sadie:get-conversation', async (_event, conversationId: string) => {
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
  ipcMain.handle('sadie:create-conversation', async (_event, title?: string) => {
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
  ipcMain.handle('sadie:save-conversation', async (_event, conversation: StoredConversation) => {
    try {
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
  ipcMain.handle('sadie:delete-conversation', async (_event, conversationId: string) => {
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
  ipcMain.handle('sadie:compact-conversation', async (_event, conversationId: string, keepRecent?: number) => {
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
  ipcMain.handle('sadie:set-active-conversation', async (_event, conversationId: string | null) => {
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
  ipcMain.handle('sadie:add-message', async (_event, { conversationId, message }: { conversationId: string; message: Message }) => {
    try {
      console.log(`[IPC] sadie:add-message conv=${conversationId} msgId=${message.id} len=${String(message.content || '').length}`);
      try { (global as any).__SADIE_MAIN_LOG_BUFFER = (global as any).__SADIE_MAIN_LOG_BUFFER || []; (global as any).__SADIE_MAIN_LOG_BUFFER.push(`[IPC] sadie:add-message conv=${conversationId} msgId=${message.id}`); } catch (e) { safeCatch(e); }
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
              win?.webContents.send('sadie:conversation-compacted', {
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
      try { (global as any).__SADIE_MAIN_LOG_BUFFER.push(`[IPC] addMessage error=${String(err)}`); } catch (e) { safeCatch(e); }
      return { success: false, error: err.message };
    }
  });

  /**
   * Update a message in a conversation
   */
  ipcMain.handle('sadie:update-message', async (_event, { conversationId, messageId, updates }: { conversationId: string; messageId: string; updates: Partial<Message> }) => {
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
   * and pushes the result back to the renderer via sadie:title-updated.
   */
  ipcMain.handle('sadie:generate-title', async (_event, {
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
      const isCustomLLMActive = !!settings.useCustomLLM && !!settings.customLLM?.apiKey && !!settings.customLLM?.model;

      if (isCustomLLMActive) {
        const cfg = settings.customLLM!;
        const apiUrl = cfg.apiUrl || PROVIDER_API_URLS[cfg.provider] || '';

        if (cfg.provider === 'anthropic') {
          const resp = await axios.post(`${apiUrl}/messages`, {
            model: cfg.model,
            max_tokens: 30,
            temperature: 0.3,
            messages: [{ role: 'user', content: `${titleInstruction}\nUser: ${userSnippet}\nAssistant: ${assistantSnippet}\nTitle:` }],
          }, {
            headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
            timeout: 15000,
          });
          title = resp.data?.content?.[0]?.text ?? '';
        } else {
          const resp = await axios.post(`${apiUrl}/chat/completions`, {
            model: cfg.model,
            messages: [
              { role: 'system', content: titleInstruction },
              { role: 'user', content: `User: ${userSnippet}\nAssistant: ${assistantSnippet}\nTitle:` },
            ],
            max_tokens: 30,
            temperature: 0.3,
          }, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
            timeout: 15000,
          });
          title = resp.data?.choices?.[0]?.message?.content ?? '';
        }
      } else {
        const ollamaBase = (process.env.OLLAMA_URL || (settings as any).ollamaUrl || DEFAULT_OLLAMA_URL).trim();
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
      win?.webContents.send('sadie:title-updated', { conversationId, title });

      return { success: true, title };
    } catch (err: any) {
      console.warn('[IPC] generate-title failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Open a file in the system default application
   */
  ipcMain.handle('sadie:open-file', async (_event, filePath: string) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }
      // Resolve and restrict to user home directory to prevent path traversal
      const normalizedPath = path.resolve(filePath);
      const homeDir = require('os').homedir();
      if (!normalizedPath.toLowerCase().startsWith(homeDir.toLowerCase())) {
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

  /**
   * Show a file in the system file explorer (and select it)
   */
  ipcMain.handle('sadie:show-in-folder', async (_event, filePath: string) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }
      // Resolve and restrict to user home directory to prevent path traversal
      const normalizedPath = path.resolve(filePath);
      const homeDir = require('os').homedir();
      if (!normalizedPath.toLowerCase().startsWith(homeDir.toLowerCase())) {
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
  ipcMain.handle('sadie:start-speech-recognition', async () => {

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
      const tmpFile = path.join(os.tmpdir(), `sadie-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
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

  // ── Scheduler ──────────────────────────────────────────────────────────────────
  ipcMain.handle('sadie:scheduler-list', () => listJobs());

  ipcMain.handle('sadie:scheduler-add', (_event, input: any) => {
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
  });

  ipcMain.handle('sadie:scheduler-remove', (_event, id: string) => {
    return { success: removeJob(id) };
  });

  ipcMain.handle('sadie:scheduler-toggle', (_event, id: string, enabled: boolean) => {
    const job = toggleJob(id, enabled);
    return job ? { success: true, job } : { success: false, error: 'Job not found' };
  });

  // ── TTS (text-to-speech) ────────────────────────────────────────────────────
  // Uses Edge TTS neural voices (msedge-tts), falls back to Web Speech API
  ipcMain.handle('sadie:tts-speak', async (_event, text: string, rate?: number) => {
    return speakHandler({ text, rate: rate ?? 0 }, {} as any);
  });

  ipcMain.handle('sadie:tts-stop', async () => {
    return stopSpeakingHandler({}, {} as any);
  });

  // ── MCP Server Management ───────────────────────────────────────────────────

  ipcMain.handle('sadie:mcp-get-status', async () => {
    return getMcpStatus();
  });

  ipcMain.handle('sadie:mcp-list-servers', async () => {
    return loadMcpConfig().servers;
  });

  ipcMain.handle('sadie:mcp-add-server', async (_event, config: McpServerConfig) => {
    const current = loadMcpConfig();
    // Replace if same name already exists, otherwise append
    const idx = current.servers.findIndex(s => s.name === config.name);
    if (idx >= 0) {
      current.servers[idx] = config;
    } else {
      current.servers.push(config);
    }
    saveMcpConfig(current);
    return { success: true };
  });

  ipcMain.handle('sadie:mcp-remove-server', async (_event, name: string) => {
    const current = loadMcpConfig();
    current.servers = current.servers.filter(s => s.name !== name);
    saveMcpConfig(current);
    return { success: true };
  });

  ipcMain.handle('sadie:mcp-toggle-server', async (_event, name: string, enabled: boolean) => {
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
  ipcMain.handle('sadie:search-conversations', async (_event, query: string, maxResults?: number) => {
    try {
      const results: ConversationSearchResult[] = MemoryManager.searchConversations(query, maxResults ?? 50);
      return { success: true, data: results };
    } catch (err: any) {
      console.error('[IPC] sadie:search-conversations error:', err.message);
      return { success: false, error: err.message, data: [] };
    }
  });

  /**
   * Export a single conversation as Markdown or JSON.
   * Accepts an optional format: 'markdown' (default) | 'json'.
   */
  ipcMain.handle('sadie:export-conversation', async (_event, conversationId: string, format?: string) => {
    try {
      const isJson = format === 'json';
      const content = isJson
        ? MemoryManager.exportConversationAsJSON(conversationId)
        : MemoryManager.exportConversationAsMarkdown(conversationId);
      if (!content) return { success: false, error: 'Conversation not found' };
      const desktop = app.getPath('desktop');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeId = conversationId.replace(/[^a-z0-9_-]/gi, '').slice(0, 12);
      const ext = isJson ? 'json' : 'md';
      const filePath = path.join(desktop, `sadie-export-${safeId}-${ts}.${ext}`);
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true, content, path: filePath };
    } catch (err: any) {
      console.error('[IPC] sadie:export-conversation error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── Settings Export/Import ──────────────────────────────────────────────────

  ipcMain.handle('sadie:export-settings', async () => {
    try {
      const settings = getSettings();
      const convStore = MemoryManager.loadConversationStore();
      const prefs = MemoryManager.loadPreferences();
      const toolStats = MemoryManager.loadToolStats();
      const bundle = {
        _sadie_backup: true,
        exportedAt: new Date().toISOString(),
        version: app.getVersion(),
        settings,
        preferences: prefs,
        conversations: convStore,
        toolStats,
      };
      const desktop = path.join(os.homedir(), 'Desktop');
      const filename = `sadie-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const filePath = path.join(desktop, filename);
      fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf-8');
      return { success: true, path: filePath };
    } catch (err: any) {
      console.error('[IPC] sadie:export-settings error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sadie:import-settings', async (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath.replace(/^~/, os.homedir()));
      if (!fs.existsSync(resolved)) return { success: false, error: 'File not found' };
      const raw = fs.readFileSync(resolved, 'utf-8');
      const bundle = JSON.parse(raw);
      if (!bundle._sadie_backup) return { success: false, error: 'Not a valid SADIE backup file' };

      if (bundle.settings) {
        const current = getSettings();
        saveSettings({ ...current, ...bundle.settings });
      }
      if (bundle.preferences) {
        MemoryManager.savePreferences(bundle.preferences);
      }
      if (bundle.conversations) {
        MemoryManager.saveConversationStore(bundle.conversations);
      }
      return { success: true, restoredAt: new Date().toISOString() };
    } catch (err: any) {
      console.error('[IPC] sadie:import-settings error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── Document Viewer ────────────────────────────────────────────────────────
  ipcMain.handle('sadie:parse-document', async (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath.replace(/^~/, os.homedir()));
      if (!fs.existsSync(resolved)) return { success: false, error: 'File not found' };

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

  ipcMain.handle('sadie:write-document', async (_event, filePath: string, content: string) => {
    try {
      const resolved = path.resolve(filePath.replace(/^~/, os.homedir()));
      const homeDir = os.homedir();
      if (!resolved.toLowerCase().startsWith(homeDir.toLowerCase())) {
        return { success: false, error: 'Access denied: path must be within home directory' };
      }
      fs.writeFileSync(resolved, content, 'utf-8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  });

  // Mark registration complete
  (global as any).__sadie_ipc_registered = true;
  if (isDevelopment) {
    console.log('[IPC] Handlers registered');
  }
}
