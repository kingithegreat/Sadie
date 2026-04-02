import { contextBridge, ipcRenderer, IpcRendererEvent, clipboard } from 'electron';
import * as path from 'path';
import { debug as logDebug } from '../shared/logger';

// Renderer diagnostics buffer
(global as any).__SADIE_RENDERER_LOG_BUFFER ??= [];
const MAX_RENDERER_LOG_BUFFER = 500;

function appendRendererBuffer(entry: string) {
  try {
    const buffer = ((global as any).__SADIE_RENDERER_LOG_BUFFER = (global as any).__SADIE_RENDERER_LOG_BUFFER || []);
    buffer.push(entry);
    if (buffer.length > MAX_RENDERER_LOG_BUFFER) {
      buffer.splice(0, buffer.length - MAX_RENDERER_LOG_BUFFER);
    }
  } catch (e) {}
}

function pushRendererLog(line: string) {
  appendRendererBuffer(`[RENDERER] ${String(line)}`);
  try { ipcRenderer.send('sadie:append-renderer-log', String(line)); } catch (e) {}
}

// Use canonical shared types for the preload API
import {
  SadieRequest,
  SadieRequestWithImages,
  SadieResponse,
  ConnectionStatus,
  ElectronAPI,
  Settings,
  StoredConversation,
  ConversationStore,
  MemoryResult,
  Message,
} from '../shared/types';
import { IPC_SEND_MESSAGE } from '../shared/constants';

// No local duplicate ElectronAPI — we import the canonical type above and ensure our implementation matches it.

// Whitelist of allowed IPC channels
const ALLOWED_CHANNELS = {
  SEND: IPC_SEND_MESSAGE,
  RECEIVE: 'sadie:reply',
  GET_SETTINGS: 'sadie:get-settings',
  GET_MODE: 'sadie:get-mode',
  SAVE_SETTINGS: 'sadie:save-settings',
  HAS_PERMISSION: 'sadie:has-permission',
  RESET_PERMISSIONS: 'sadie:reset-permissions',
  EXPORT_CONSENT: 'sadie:export-consent',
  LIST_CUSTOM_MODELS: 'sadie:list-custom-llm-models',
  READ_CONSENT_LOG: 'sadie:read-consent-log',
  READ_TELEMETRY_EVENTS: 'sadie:read-telemetry-events',
  SHOW_WINDOW: 'sadie:show-window',
  HIDE_WINDOW: 'sadie:hide-window',
  STREAM_SEND: 'sadie:stream-message',
  AUTOMATION_IMAGE_GENERATE: 'sadie:automation:image:generate',
  STREAM_CHUNK: 'sadie:stream-chunk',
  STREAM_END: 'sadie:stream-end',
  STREAM_ERROR: 'sadie:stream-error',
  CONFIRMATION_REQUEST: 'sadie:confirmation-request',
  CONFIRMATION_RESPONSE: 'sadie:confirmation-response',
  PERMISSION_REQUEST: 'sadie:permission-request',
  PERMISSION_RESPONSE: 'sadie:permission-response',
  GET_ENV: 'sadie:get-env',
  GET_CONFIG_PATH: 'sadie:get-config-path'
};

// Listen for router logs forwarded from main so tests and Playwright traces
// can capture them in renderer console output. This is intentionally lightweight
// and will not affect production behaviour.
try {
  ipcRenderer.on('sadie:router-log', (_ev, line) => {
    try {
      console.log('[ROUTER-LOG]', line);
      appendRendererBuffer(`[ROUTER] ${String(line)}`);
    } catch (e) {}
  });
} catch (e) {}

// Create the API object
const electronAPI: ElectronAPI = {
  /**
   * Send a message to SADIE backend
   */
  sendMessage: async (request: SadieRequest): Promise<SadieResponse> => {
    logDebug('[Preload] IPC invoke', ALLOWED_CHANNELS.SEND, { messagePreview: String(request?.message).substring(0, 120) });
    try { pushRendererLog(`IPC invoke ${ALLOWED_CHANNELS.SEND} preview=${String(request?.message).substring(0,120)}`); } catch (e) {}
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.SEND, request);
  },

  // Start a streaming request. Non-blocking; return a Promise<void> to match shared types
  sendStreamMessage: async (request: SadieRequestWithImages): Promise<void> => {
    logDebug('[Preload] IPC send', ALLOWED_CHANNELS.STREAM_SEND, { streamId: (request as any)?.streamId, messagePreview: String(request?.message).substring(0,120) });
    try { pushRendererLog(`IPC send ${ALLOWED_CHANNELS.STREAM_SEND} streamId=${(request as any)?.streamId}`); } catch (e) {}
    ipcRenderer.send(ALLOWED_CHANNELS.STREAM_SEND, request);
    // Fire-and-forget; return a resolved promise so callers can await
    return Promise.resolve();
  },

  /**
   * Listen for messages from SADIE backend
   * Returns an unsubscribe function
   */
  onMessage: (callback: (data: any) => void) => {
    const listener = (_event: IpcRendererEvent, data: any) => {
      callback(data);
    };

    ipcRenderer.on(ALLOWED_CHANNELS.RECEIVE, listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(ALLOWED_CHANNELS.RECEIVE, listener);
    };
  },

  onStreamChunk: (cb: (data: { streamId?: string; chunk: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => {
      // Expecting data = { streamId?: string, chunk: string }
      cb(data as { streamId?: string; chunk: string });
    };
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_CHUNK, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_CHUNK, listener);
  },

  // Convenience grouped subscription: subscribe by streamId and receive
  // chunk/end/error callbacks that are filtered for that stream only.
  subscribeToStream: (streamId: string, handlers: {
    onStreamChunk?: (data: { streamId?: string; chunk: string }) => void;
    onStreamEnd?: (data: { streamId?: string; cancelled?: boolean }) => void;
    onStreamError?: (err: { streamId?: string; error?: string }) => void;
  }) => {
    const { onStreamChunk, onStreamEnd, onStreamError } = handlers || {};

    const chunkListener = (_ev: IpcRendererEvent, data: any) => {
      if (!data || data.streamId !== streamId) return;
      if (typeof onStreamChunk === 'function') onStreamChunk(data as { streamId?: string; chunk: string });
    };

    const endListener = (_ev: IpcRendererEvent, data: any) => {
      if (!data || data.streamId !== streamId) return;
      if (typeof onStreamEnd === 'function') onStreamEnd(data as { streamId?: string; cancelled?: boolean });
    };

    const errorListener = (_ev: IpcRendererEvent, data: any) => {
      if (!data || data.streamId !== streamId) return;
      if (typeof onStreamError === 'function') onStreamError(data as { streamId?: string; error?: string });
    };

    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_CHUNK, chunkListener);
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_END, endListener);
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_ERROR, errorListener);

    return () => {
      ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_CHUNK, chunkListener);
      ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_END, endListener);
      ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_ERROR, errorListener);
    };
  },

  onStreamEnd: (cb: (data: { streamId?: string; cancelled?: boolean }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data as { streamId?: string; cancelled?: boolean });
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_END, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_END, listener);
  },

  onStreamError: (cb: (data: { streamId?: string; error?: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, err: any) => cb(err as { streamId?: string; error?: string });
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_ERROR, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_ERROR, listener);
  },

  // Confirmation request/response for dangerous operations
  onConfirmationRequest: (cb: (data: { confirmationId: string; message: string; streamId: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on(ALLOWED_CHANNELS.CONFIRMATION_REQUEST, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.CONFIRMATION_REQUEST, listener);
  },

  onPermissionRequest: (cb: (data: { requestId: string; missingPermissions: string[]; reason: string; streamId?: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on(ALLOWED_CHANNELS.PERMISSION_REQUEST, listener);
    // E2E diagnostic: expose the last permission request to the renderer global for tests
    const debugListener = (_ev: IpcRendererEvent, data: any) => {
      try { (global as any).__lastPermissionRequest = data; } catch (e) {}
    };
    ipcRenderer.on(ALLOWED_CHANNELS.PERMISSION_REQUEST, debugListener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.PERMISSION_REQUEST, listener);
  },

  sendPermissionResponse: (requestId: string, decision: 'allow_once'|'always_allow'|'cancel', missingPermissions?: string[]) => {
    ipcRenderer.send(ALLOWED_CHANNELS.PERMISSION_RESPONSE, { requestId, decision, missingPermissions });
  },

  sendConfirmationResponse: (confirmationId: string, confirmed: boolean) => {
    ipcRenderer.send(ALLOWED_CHANNELS.CONFIRMATION_RESPONSE, { confirmationId, confirmed });
  },

  // removeStreamListeners is intentionally not exposed in the canonical API; use returned unsubscribes instead.

  // Cancel a running stream by id. If no id is provided, cancels all.
  cancelStream: (streamId?: string) => {
    logDebug('[Preload] IPC send', 'sadie:stream-cancel', { streamId });
    try { pushRendererLog(`IPC send sadie:stream-cancel streamId=${streamId}`); } catch (e) {}
    ipcRenderer.send('sadie:stream-cancel', { streamId });
  },

  // Window show/hide event helpers
  onShowWindow: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(ALLOWED_CHANNELS.SHOW_WINDOW, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.SHOW_WINDOW, listener);
  },

  onHideWindow: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(ALLOWED_CHANNELS.HIDE_WINDOW, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.HIDE_WINDOW, listener);
  },

  onReminderFired: (cb: (data: { message: string; label: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: { message: string; label: string }) => cb(data);
    ipcRenderer.on('sadie:reminder-fired', listener);
    return () => ipcRenderer.removeListener('sadie:reminder-fired', listener);
  },

  removeShowWindowListener: () => {
    ipcRenderer.removeAllListeners(ALLOWED_CHANNELS.SHOW_WINDOW);
  },

  removeHideWindowListener: () => {
    ipcRenderer.removeAllListeners(ALLOWED_CHANNELS.HIDE_WINDOW);
  },

  /**
   * Get user settings from main process
   */
  getSettings: async (): Promise<Settings> => {
    logDebug('[Preload] IPC invoke', ALLOWED_CHANNELS.GET_SETTINGS);
    try { pushRendererLog(`IPC invoke ${ALLOWED_CHANNELS.GET_SETTINGS}`); } catch (e) {}
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_SETTINGS) as Settings;
  },

  /**
   * Save user settings to main process
   */
  saveSettings: async (settings: Partial<Settings>): Promise<Settings> => {
    // saveSettings returns the updated settings (wrapped in { success:true, data })
    logDebug('[Preload] IPC invoke', ALLOWED_CHANNELS.SAVE_SETTINGS, { keys: Object.keys(settings || {}) });
    try { pushRendererLog(`IPC invoke ${ALLOWED_CHANNELS.SAVE_SETTINGS} keys=${Object.keys(settings || {}).join(',')}`); } catch (e) {}
    const result: any = await ipcRenderer.invoke(ALLOWED_CHANNELS.SAVE_SETTINGS, settings);
    if (result && result.success && result.data) {
      return result.data as Settings;
    }
    // If something went wrong, fallback to current Settings
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_SETTINGS) as Settings;
  },

  listCustomLLMModels: async (config: { apiUrl: string; apiKey?: string; provider?: string }) => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.LIST_CUSTOM_MODELS, config);
  },

  resetPermissions: async (): Promise<Settings> => {
    const r = await ipcRenderer.invoke(ALLOWED_CHANNELS.RESET_PERMISSIONS);
    if (r && r.success && r.data) return r.data as Settings;
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_SETTINGS) as Settings;
  },

  exportTelemetryConsent: async (): Promise<{ success: boolean; path?: string; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.EXPORT_CONSENT);
  },

  readDebugLogs: async (): Promise<{ success: boolean; rendererLogs?: string[]; mainLogs?: string[]; conversationStore?: any; error?: string }> => {
    return await ipcRenderer.invoke('sadie:read-debug-logs');
  },

  getMode: async (): Promise<{ demo: boolean }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_MODE);
  },

  executeImageGenerate: async ({ action, payload }: { action: string; payload?: any }) => {
    logDebug('[Preload] IPC invoke', ALLOWED_CHANNELS.AUTOMATION_IMAGE_GENERATE);
    try { pushRendererLog(`IPC invoke ${ALLOWED_CHANNELS.AUTOMATION_IMAGE_GENERATE}`); } catch (e) {}
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.AUTOMATION_IMAGE_GENERATE, { action, payload });
  },

  getEnv: async (): Promise<{ isE2E: boolean; isPackagedBuild: boolean; isReleaseBuild: boolean; userDataPath: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_ENV);
  },

  getConfigPath: async (): Promise<string> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_CONFIG_PATH);
  },

  // Test-only: allow invoking arbitrary channels from the renderer (only in E2E)
  // SECURITY: gated to E2E mode only — in production this throws to prevent
  // the renderer from invoking arbitrary IPC channels.
  invoke: async (channel: string, ...args: any[]) => {
    const e2e = process.env.SADIE_E2E === '1' || process.env.SADIE_E2E === 'true';
    if (!e2e) {
      throw new Error('invoke() is only available in E2E test mode');
    }
    return await ipcRenderer.invoke(channel, ...args);
  },

  captureLogs: async (): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const r = await ipcRenderer.invoke('sadie:capture-logs');
      return r;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  readConsentLog: async (): Promise<{ success: boolean; data?: string; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.READ_CONSENT_LOG);
  },

  readTelemetryEvents: async (): Promise<{ success: boolean; events?: any[]; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.READ_TELEMETRY_EVENTS);
  },

  hasPermission: async (toolName: string): Promise<{ success: boolean; allowed?: boolean; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.HAS_PERMISSION, toolName);
  },

  checkConnection: async (): Promise<ConnectionStatus> => {
    logDebug('[Preload] IPC invoke', 'sadie:check-connection');
    try { pushRendererLog('IPC invoke sadie:check-connection'); } catch (e) {}
    return await ipcRenderer.invoke('sadie:check-connection');
  },

  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // ============= Memory/Conversation APIs =============

  loadConversations: async (): Promise<MemoryResult<ConversationStore>> => {
    return await ipcRenderer.invoke('sadie:load-conversations');
  },

  getConversation: async (conversationId: string): Promise<MemoryResult<StoredConversation | null>> => {
    return await ipcRenderer.invoke('sadie:get-conversation', conversationId);
  },

  createConversation: async (title?: string): Promise<MemoryResult<StoredConversation>> => {
    return await ipcRenderer.invoke('sadie:create-conversation', title);
  },

  saveConversation: async (conversation: StoredConversation): Promise<MemoryResult> => {
    return await ipcRenderer.invoke('sadie:save-conversation', conversation);
  },

  deleteConversation: async (conversationId: string): Promise<MemoryResult> => {
    return await ipcRenderer.invoke('sadie:delete-conversation', conversationId);
  },

  setActiveConversation: async (conversationId: string | null): Promise<MemoryResult> => {
    return await ipcRenderer.invoke('sadie:set-active-conversation', conversationId);
  },

  addMessage: async (conversationId: string, message: Message): Promise<MemoryResult> => {
    return await ipcRenderer.invoke('sadie:add-message', { conversationId, message });
  },

  updateMessage: async (conversationId: string, messageId: string, updates: Partial<Message>): Promise<MemoryResult> => {
    return await ipcRenderer.invoke('sadie:update-message', { conversationId, messageId, updates });
  },

  // Speech recognition using Windows SAPI (offline capable)
  startSpeechRecognition: async (): Promise<{ success: boolean; text: string; error?: string }> => {
    return await ipcRenderer.invoke('sadie:start-speech-recognition');
  },

  // TTS (text-to-speech) — uses Web Speech API in renderer via main process
  ttsSpeak: async (text: string, rate?: number): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('sadie:tts-speak', text, rate);
  },
  ttsStop: async (): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('sadie:tts-stop');
  },

  // Scheduler — recurring / daily jobs
  schedulerList: async () => ipcRenderer.invoke('sadie:scheduler-list'),
  schedulerAdd: async (input: any) => ipcRenderer.invoke('sadie:scheduler-add', input),
  schedulerRemove: async (id: string) => ipcRenderer.invoke('sadie:scheduler-remove', id),
  schedulerToggle: async (id: string, enabled: boolean) => ipcRenderer.invoke('sadie:scheduler-toggle', id, enabled),

  // Uncensored mode toggle
  setUncensoredMode: async (enabled: boolean): Promise<{ success: boolean; enabled: boolean }> => {
    return await ipcRenderer.invoke('sadie:set-uncensored-mode', enabled);
  },

  getUncensoredMode: async (): Promise<{ enabled: boolean }> => {
    return await ipcRenderer.invoke('sadie:get-uncensored-mode');
  },

  // Restart the app (for settings that require restart)
  restartApp: async (): Promise<void> => {
    return await ipcRenderer.invoke('sadie:restart-app');
  },

  // Clipboard helper — uses Electron native clipboard (works with contextIsolation)
  writeClipboard: (text: string) => {
    clipboard.writeText(text);
  },

  // Open a file or folder in the system default application
  openFile: async (filePath: string): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('sadie:open-file', filePath);
  },

  // Open a folder in the system file explorer and select the file
  showInFolder: async (filePath: string): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('sadie:show-in-folder', filePath);
  },

  // Export chat history as a markdown file to the Desktop
  exportChat: async (markdown: string): Promise<{ success: boolean; path?: string; error?: string }> => {
    return await ipcRenderer.invoke('sadie:export-chat', markdown);
  },

  // List all registered tool definitions
  listTools: async (): Promise<{ success: boolean; tools?: { name: string; description: string; category: string }[]; error?: string }> => {
    return await ipcRenderer.invoke('sadie:list-tools');
  },

  // RAG: index a local file by its OS path
  ragIndex: async (filePath: string) => {
    return await ipcRenderer.invoke('sadie:rag-index', filePath);
  },

  // RAG: list all indexed documents
  ragList: async () => {
    return await ipcRenderer.invoke('sadie:rag-list');
  },

  // RAG: remove a document from the index by doc_id
  ragClear: async (docId: string) => {
    return await ipcRenderer.invoke('sadie:rag-clear', docId);
  },

  // ── MCP Server Management ──────────────────────────────────────────────────
  mcpListServers: async () => ipcRenderer.invoke('sadie:mcp-list-servers'),
  mcpGetStatus: async () => ipcRenderer.invoke('sadie:mcp-get-status'),
  mcpAddServer: async (config: any) => ipcRenderer.invoke('sadie:mcp-add-server', config),
  mcpRemoveServer: async (name: string) => ipcRenderer.invoke('sadie:mcp-remove-server', name),
  mcpToggleServer: async (name: string, enabled: boolean) => ipcRenderer.invoke('sadie:mcp-toggle-server', name, enabled),

  // Full-text search across all stored conversations
  searchConversations: async (query: string, maxResults?: number) =>
    ipcRenderer.invoke('sadie:search-conversations', query, maxResults),

  // Export a single conversation as Markdown to Desktop
  exportConversation: async (conversationId: string) =>
    ipcRenderer.invoke('sadie:export-conversation', conversationId),

  // Auto-generate a conversation title from the first user+assistant exchange
  generateTitle: async (args: { conversationId: string; userMessage: string; assistantReply: string }) =>
    ipcRenderer.invoke('sadie:generate-title', args),

  // Subscribe to title-updated push events from main process
  onTitleUpdated: (cb: (data: { conversationId: string; title: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { conversationId: string; title: string }) => cb(data);
    ipcRenderer.on('sadie:title-updated', handler);
    return () => ipcRenderer.removeListener('sadie:title-updated', handler);
  },
};

// Expose the API to the renderer process. Cast to the canonical ElectronAPI to ensure type alignment.
contextBridge.exposeInMainWorld('electron', electronAPI as unknown as ElectronAPI);
// Expose a simple capture API for renderer to forward logs into the main global buffer
contextBridge.exposeInMainWorld('sadieCapture', {
  log: (msg: string) => { try { pushRendererLog(msg); } catch (e) {} }
});
// Expose the built path to the webview preload script so WebServicesPanel can
// set it as the <webview preload="..."> attribute — must run before page scripts.
contextBridge.exposeInMainWorld('_webviewPreload', path.join(__dirname, 'webview.js'));
// Expose web service controls for the launcher panel
contextBridge.exposeInMainWorld('_webServices', {
  open:   (id: string) => ipcRenderer.invoke('sadie:open-web-service', id),
  status: ()           => ipcRenderer.invoke('sadie:web-service-status'),
});

// Export types for TypeScript consumers
// Re-export the type (forwarded from shared/types)
export type { ElectronAPI };
