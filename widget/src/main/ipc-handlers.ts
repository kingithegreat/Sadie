import { ipcMain, BrowserWindow, app, shell } from 'electron';
import { getMainWindow } from './window-manager';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import {
  getSettings, 
  saveSettings, 
  assertPermission, 
  getSettingsPath, 
  resetPermissions, 
  exportTelemetryConsent 
} from './config-manager';
import { fetchAvailableCustomModels } from './custom-llm-client';
import { setTavilyApiKey, setSerperApiKey, setStableHordeApiKey } from './tools/web';
import { ragToolHandlers } from './tools/rag';
import { setUncensoredMode, getUncensoredMode as routerGetUncensoredMode, ensureHydrated } from './message-router';
import { getAllToolDefinitions } from './tools/index';
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
} from './memory-manager';
import { Message } from '../shared/types';
import { DEFAULT_OLLAMA_URL } from '../shared/constants';
import { isDevelopment, isDemoMode } from './env';


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
        try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] registerIpcHandlers already executed — skipping'); } catch (e) {}
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
        const r = await axios.get(n8nHealth, { timeout: 2000 });
        if (r && r.status && r.status >= 200 && r.status < 300) result.n8n = 'online';
        else result.n8n = 'offline';
      } catch (e) {
        result.n8n = 'offline';
      }

      try {
        // Ollama may not expose /healthz; a simple GET on base URL will suffice for a quick check
        const settings = getSettings();
        const ollamaBase = (process.env.OLLAMA_URL || settings.ollamaUrl || DEFAULT_OLLAMA_URL).trim();
        const r2 = await axios.get(ollamaBase, { timeout: 2000 });
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

    ipcMain.on('window-close', () => {
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.close();
      }
    });
  
  /**
   * Handle message from renderer → forward to n8n orchestrator
   */
  ipcMain.on('sadie:message', async (_event, { message, conversationId }) => {
    try {
      console.log('[Main] Received sendMessage', { conversationId, preview: String(message).substring(0,120) });
      try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push(`[MAIN] Received sendMessage conv=${conversationId} preview=${String(message).substring(0,120)}`); } catch (e) {}
          // Load settings to get n8n URL
          const settings = getSettings();
      console.log('[Main] Calling messageRouter.sendStreamRequest (via axios post)');
      try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push('[MAIN] Calling messageRouter.sendStreamRequest (via axios post)'); } catch (e) {}

      // Send message to n8n orchestrator
      const response = await axios.post(`${settings.n8nUrl}/webhook/sadie/chat`, {
        user_id: 'desktop-user',
        conversation_id: conversationId || 'default',
        message: message,
        timestamp: new Date().toISOString()
      }, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
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
      try { (global as any).__SADIE_MAIN_LOG_BUFFER?.push(`[MAIN] sendStreamRequest returned status=${response.status}`); } catch (e) {}

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

  // Image generation: forward to n8n image webhook
  ipcMain.handle('sadie:automation:image:generate', async (_event, { action, payload }) => {
    try {
      const settings = getSettings();
      const url = `${settings.n8nUrl}/webhook/sadie/image-generate`;
      console.log('[Main] Image generate request ->', { url, action });

      const response = await axios.post(url, { action, payload }, { timeout: 600000, headers: { 'Content-Type': 'application/json' } });

      return response.data;
    } catch (err: any) {
      console.error('[Main] Image generate failed:', err.message);
      return {
        status: 'failure',
        timestamp: new Date().toISOString(),
        operation: 'image_generate',
        source: null,
        image: null,
        metadata: {},
        validation: { validated: false },
        error: { message: err.message, code: 'N8N_CALL_FAILED' }
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
      const merged = { ...getSettings(), ...settings };
      saveSettings(merged);

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
    try { (global as any).__SADIE_ROUTER_LOG_BUFFER = (global as any).__SADIE_ROUTER_LOG_BUFFER || []; (global as any).__SADIE_ROUTER_LOG_BUFFER.push('[E2E] ping'); } catch (e) {}
    return { ok: true };
  });

  // Expose current app mode (demo or normal)
  ipcMain.handle('sadie:get-mode', async () => {
    return { demo: !!isDemoMode };
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
      return { success };
    } catch (err: any) {
      console.error('Error deleting conversation:', err.message);
      return { success: false, error: err.message };
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
      try { (global as any).__SADIE_MAIN_LOG_BUFFER = (global as any).__SADIE_MAIN_LOG_BUFFER || []; (global as any).__SADIE_MAIN_LOG_BUFFER.push(`[IPC] sadie:add-message conv=${conversationId} msgId=${message.id}`); } catch (e) {}
      const success = MemoryManager.addMessageToConversation(conversationId, message);
      console.log(`[IPC] addMessage -> success=${success}`);
      return { success };
    } catch (err: any) {
      console.error('Error adding message:', err.message);
      try { (global as any).__SADIE_MAIN_LOG_BUFFER.push(`[IPC] addMessage error=${String(err)}`); } catch (e) {}
      return { success: false, error: err.message };
    }
  });

  /**
   * Update a message in a conversation
   */
  ipcMain.handle('sadie:update-message', async (_event, { conversationId, messageId, updates }: { conversationId: string; messageId: string; updates: Partial<Message> }) => {
    try {
      const success = MemoryManager.updateMessageInConversation(conversationId, messageId, updates);
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
      const ollamaBase = (process.env.OLLAMA_URL || (settings as any).ollamaUrl || DEFAULT_OLLAMA_URL).trim();
      const model = settings.chatModel || 'llama3.2:3b';

      // Trim inputs so the title prompt stays tiny
      const userSnippet = userMessage.slice(0, 200);
      const assistantSnippet = assistantReply.slice(0, 200);

      const prompt =
        `Generate a short conversation title (4-6 words max, no punctuation, no quotes) that captures what this exchange is about.\n` +
        `User: ${userSnippet}\nAssistant: ${assistantSnippet}\nTitle:`;

      const resp = await axios.post(
        `${ollamaBase}/api/generate`,
        { model, prompt, stream: false, options: { temperature: 0.3, num_predict: 20 } },
        { timeout: 8000 }
      );

      let title: string = resp.data?.response ?? '';
      // Sanitise: strip surrounding quotes, newlines, leading/trailing whitespace, cap length
      title = title.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\n.*/g, '').trim();
      if (!title || title.length < 2) return { success: false, error: 'Empty title response' };
      if (title.length > 60) title = title.slice(0, 57) + '…';

      // Persist to conversation store
      const conv = MemoryManager.getConversation(conversationId);
      if (conv) {
        conv.title = title;
        MemoryManager.saveConversation(conv);
      }

      // Push to renderer so sidebar updates live
      const win = mainWindow ?? getMainWindow();
      win?.webContents.send('sadie:title-updated', { conversationId, title });

      return { success: true, title };
    } catch (err: any) {
      // Non-fatal: title generation is best-effort
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
      // Normalize path and check it exists
      const normalizedPath = path.normalize(filePath);
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
      // Normalize path and check it exists
      const normalizedPath = path.normalize(filePath);
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
    const { exec } = require('child_process');
    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    return new Promise((resolve) => {
      // PowerShell script to use Windows Speech Recognition (SAPI — fully offline)
      const psScript = `
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()

$dictation = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($dictation)

$recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(5)
$recognizer.BabbleTimeout         = [TimeSpan]::FromSeconds(3)
$recognizer.EndSilenceTimeout     = [TimeSpan]::FromSeconds(1)

try {
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(10))
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
      // Write to a temp file so no inline escaping is needed
      const tmpFile = path.join(os.tmpdir(), 'sadie-voice.ps1');
      try {
        fs.writeFileSync(tmpFile, psScript, 'utf8');
      } catch (writeErr: any) {
        resolve({ success: false, error: 'Could not write temp script: ' + writeErr.message, text: '' });
        return;
      }

      exec(`powershell -ExecutionPolicy Bypass -NonInteractive -File "${tmpFile}"`,
        { timeout: 15000 },
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
  // Uses Web Speech API in the renderer via executeJavaScript (no extra deps, works offline)
  ipcMain.handle('sadie:tts-speak', async (_event, text: string, rate?: number) => {
    return speakHandler({ text, rate: rate ?? 1.0 }, {} as any);
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

  // Mark registration complete
  (global as any).__sadie_ipc_registered = true;
  if (isDevelopment) {
    console.log('[IPC] Handlers registered');
  }
}
