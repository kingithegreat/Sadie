import { contextBridge, ipcRenderer, IpcRendererEvent, clipboard } from 'electron';
import { debug as logDebug } from '../shared/logger';

/** Catch handler for fire-and-forget ops — logs instead of silently swallowing */
function safeCatch(e: unknown) { console.error('[HomeBot-CATCH]', e); }

// Renderer diagnostics buffer
(global as any).__HOMEBOT_RENDERER_LOG_BUFFER ??= [];
const MAX_RENDERER_LOG_BUFFER = 500;

function appendRendererBuffer(entry: string) {
  try {
    const buffer = ((global as any).__HOMEBOT_RENDERER_LOG_BUFFER = (global as any).__HOMEBOT_RENDERER_LOG_BUFFER || []);
    buffer.push(entry);
    if (buffer.length > MAX_RENDERER_LOG_BUFFER) {
      buffer.splice(0, buffer.length - MAX_RENDERER_LOG_BUFFER);
    }
  } catch (e) { safeCatch(e); }
}

function pushRendererLog(line: string) {
  appendRendererBuffer(`[RENDERER] ${String(line)}`);
  try { ipcRenderer.send('homebot:append-renderer-log', String(line)); } catch (e) { safeCatch(e); }
}

// Use canonical shared types for the preload API
import {
  HomeBotRequest,
  HomeBotRequestWithImages,
  HomeBotResponse,
  ConnectionStatus,
  ElectronAPI,
  PerfStatSummary,
  Settings,
  StoredConversation,
  ConversationStore,
  MemoryResult,
  Message,
} from '../shared/types';
import { IPC_SEND_MESSAGE } from '../shared/constants';
import { NAV_CHANNEL, type NavRequest } from '../shared/navigation';

// No local duplicate ElectronAPI — we import the canonical type above and ensure our implementation matches it.

// Whitelist of allowed IPC channels
const ALLOWED_CHANNELS = {
  SEND: IPC_SEND_MESSAGE,
  RECEIVE: 'homebot:reply',
  GET_SETTINGS: 'homebot:get-settings',
  GET_MODE: 'homebot:get-mode',
  SAVE_SETTINGS: 'homebot:save-settings',
  HAS_PERMISSION: 'homebot:has-permission',
  RESET_PERMISSIONS: 'homebot:reset-permissions',
  EXPORT_CONSENT: 'homebot:export-consent',
  LIST_CUSTOM_MODELS: 'homebot:list-custom-llm-models',
  READ_CONSENT_LOG: 'homebot:read-consent-log',
  READ_TELEMETRY_EVENTS: 'homebot:read-telemetry-events',
  READ_PERMISSION_AUDIT: 'homebot:read-permission-audit',
  GET_SUPERVISOR_STATUS: 'homebot:get-supervisor-status',
  GET_CRM_ACTIVITY: 'homebot:get-crm-activity',
  SUPERVISOR_STATUS_PUSH: 'homebot:supervisor-status',
  GET_BATCH_SUMMARIES: 'homebot:get-batch-summaries',
  GET_CRM_DASHBOARD: 'homebot:get-crm-dashboard',
  BATCH_SUMMARY_PUSH: 'homebot:batch-summary',
  // Interactive terminal panel
  TERMINAL_CREATE: 'homebot:terminal:create',
  TERMINAL_RUN: 'homebot:terminal:run',
  TERMINAL_KILL: 'homebot:terminal:kill',
  TERMINAL_CLOSE: 'homebot:terminal:close',
  TERMINAL_STATUS: 'homebot:terminal:status',
  TERMINAL_OUTPUT_PUSH: 'homebot:terminal:output',
  TERMINAL_EXIT_PUSH: 'homebot:terminal:exit',
  // Explorer + code editor
  WORKSPACE_ROOT: 'homebot:workspace:root',
  WORKSPACE_LIST: 'homebot:workspace:list',
  WORKSPACE_READ: 'homebot:workspace:read',
  WORKSPACE_SAVE: 'homebot:workspace:save',
  ASSISTANT_TOOL_ACTIVITY: 'homebot:assistant-tool-activity',
  CLEAR_PERMISSION_AUDIT: 'homebot:clear-permission-audit',
  EXPORT_PERMISSION_AUDIT: 'homebot:export-permission-audit',
  SHOW_WINDOW: 'homebot:show-window',
  HIDE_WINDOW: 'homebot:hide-window',
  STREAM_SEND: 'homebot:stream-message',
  AUTOMATION_IMAGE_GENERATE: 'homebot:automation:image:generate',
  STREAM_CHUNK: 'homebot:stream-chunk',
  STREAM_END: 'homebot:stream-end',
  STREAM_ERROR: 'homebot:stream-error',
  CONFIRMATION_REQUEST: 'homebot:confirmation-request',
  CONFIRMATION_RESPONSE: 'homebot:confirmation-response',
  PERMISSION_REQUEST: 'homebot:permission-request',
  PERMISSION_RESPONSE: 'homebot:permission-response',
  GET_ENV: 'homebot:get-env',
  GET_CONFIG_PATH: 'homebot:get-config-path',
  GET_GENERATED_IMAGE: 'homebot:get-generated-image'
};

// Listen for router logs forwarded from main so tests and Playwright traces
// can capture them in renderer console output. This is intentionally lightweight
// and will not affect production behaviour.
try {
  ipcRenderer.on('homebot:router-log', (_ev, line) => {
    try {
      console.log('[ROUTER-LOG]', line);
      appendRendererBuffer(`[ROUTER] ${String(line)}`);
    } catch (e) { safeCatch(e); }
  });
} catch (e) { safeCatch(e); }

// Create the API object
const electronAPI: ElectronAPI = {
  /**
   * Send a message to HomeBot backend
   */
  sendMessage: async (request: HomeBotRequest): Promise<HomeBotResponse> => {
    logDebug('[Preload] IPC invoke', ALLOWED_CHANNELS.SEND, { messagePreview: String(request?.message).substring(0, 120) });
    try { pushRendererLog(`IPC invoke ${ALLOWED_CHANNELS.SEND} preview=${String(request?.message).substring(0,120)}`); } catch (e) { safeCatch(e); }
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.SEND, request);
  },

  // Start a streaming request. Non-blocking; return a Promise<void> to match shared types
  sendStreamMessage: async (request: HomeBotRequestWithImages): Promise<void> => {
    logDebug('[Preload] IPC send', ALLOWED_CHANNELS.STREAM_SEND, { streamId: (request as any)?.streamId, messagePreview: String(request?.message).substring(0,120) });
    try { pushRendererLog(`IPC send ${ALLOWED_CHANNELS.STREAM_SEND} streamId=${(request as any)?.streamId}`); } catch (e) { safeCatch(e); }
    ipcRenderer.send(ALLOWED_CHANNELS.STREAM_SEND, request);
    // Fire-and-forget; return a resolved promise so callers can await
    return Promise.resolve();
  },

  /**
   * Listen for messages from HomeBot backend
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
      if (typeof onStreamError === 'function') onStreamError(data as { streamId?: string; error?: string; message?: string; recoveryHint?: any });
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

  onPermissionRequest: (cb: (data: { requestId: string; missingPermissions: string[]; reason: string; streamId?: string; timeoutMs?: number }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on(ALLOWED_CHANNELS.PERMISSION_REQUEST, listener);
    // E2E diagnostic: expose the last permission request to the renderer global for tests
    const debugListener = (_ev: IpcRendererEvent, data: any) => {
      try { (global as any).__lastPermissionRequest = data; } catch (e) { safeCatch(e); }
    };
    ipcRenderer.on(ALLOWED_CHANNELS.PERMISSION_REQUEST, debugListener);
    return () => {
      ipcRenderer.removeListener(ALLOWED_CHANNELS.PERMISSION_REQUEST, listener);
      ipcRenderer.removeListener(ALLOWED_CHANNELS.PERMISSION_REQUEST, debugListener);
    };
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
    logDebug('[Preload] IPC send', 'homebot:stream-cancel', { streamId });
    try { pushRendererLog(`IPC send homebot:stream-cancel streamId=${streamId}`); } catch (e) { safeCatch(e); }
    ipcRenderer.send('homebot:stream-cancel', { streamId });
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
    ipcRenderer.on('homebot:reminder-fired', listener);
    return () => ipcRenderer.removeListener('homebot:reminder-fired', listener);
  },

  onHardwareProfileApplied: (cb: (data: { profile: string; vramGB: number; gpuName: string | null }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on('homebot:hardware-profile-applied', listener);
    return () => ipcRenderer.removeListener('homebot:hardware-profile-applied', listener);
  },

  onConfigRecovered: (cb: (data: { reason: string; backupPath: string | null; timestamp: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on('homebot:config-recovered', listener);
    return () => ipcRenderer.removeListener('homebot:config-recovered', listener);
  },

  // The assistant taking the user to another part of the app, with whatever
  // they were just discussing carried along in `payload`.
  onNavigate: (cb: (request: NavRequest) => void) => {
    const listener = (_ev: IpcRendererEvent, request: NavRequest) => cb(request);
    ipcRenderer.on(NAV_CHANNEL, listener);
    return () => ipcRenderer.removeListener(NAV_CHANNEL, listener);
  },

  onProactiveBriefing: (cb: (data: { content: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: { content: string }) => cb(data);
    ipcRenderer.on('homebot:proactive-briefing', listener);
    return () => ipcRenderer.removeListener('homebot:proactive-briefing', listener);
  },

  onOllamaStatus: (cb: (data: { online: boolean; url: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on('homebot:ollama-status', listener);
    return () => ipcRenderer.removeListener('homebot:ollama-status', listener);
  },

  onModelFallback: (cb: (data: { from: string; to: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on('homebot:model-fallback', listener);
    return () => ipcRenderer.removeListener('homebot:model-fallback', listener);
  },

  onConversationCompacted: (cb: (data: { conversationId: string; originalCount: number; compactedCount: number }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on('homebot:conversation-compacted', listener);
    return () => ipcRenderer.removeListener('homebot:conversation-compacted', listener);
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
  /**
   * Skills: list the SKILL.md folders, and open that folder in Explorer.
   * Exposed here AND consumed by SettingsPanel — an IPC channel with no
   * renderer caller is dead code that reads as a working feature.
   */
  /**
   * Browser side panel. The renderer owns layout — it measures where the panel
   * sits and sends those bounds, because a BrowserView floats above the page
   * and main has no idea what the CSS did.
   */
  browserAttach: async (url?: string, bounds?: any): Promise<any> =>
    await ipcRenderer.invoke('homebot:browser:attach', url, bounds),
  browserDetach: async (): Promise<any> =>
    await ipcRenderer.invoke('homebot:browser:detach'),
  browserBounds: async (bounds: any): Promise<any> =>
    await ipcRenderer.invoke('homebot:browser:bounds', bounds),
  browserNavigate: async (url: string): Promise<any> =>
    await ipcRenderer.invoke('homebot:browser:navigate', url),
  browserBack: async (): Promise<any> => await ipcRenderer.invoke('homebot:browser:back'),
  browserForward: async (): Promise<any> => await ipcRenderer.invoke('homebot:browser:forward'),
  browserReload: async (): Promise<any> => await ipcRenderer.invoke('homebot:browser:reload'),
  /** PNG of the live page — the "let HomeBot look at this" path. */
  browserCapture: async (): Promise<any> => await ipcRenderer.invoke('homebot:browser:capture'),
  /** Push updates: url/title/loading/canGoBack change as the user browses. */
  onBrowserState: (cb: (state: any) => void): (() => void) => {
    const listener = (_e: any, state: any) => cb(state);
    ipcRenderer.on('homebot:browser:state', listener);
    return () => ipcRenderer.removeListener('homebot:browser:state', listener);
  },

  /**
   * Ask the ROUTER which model answers a message sent right now. The header
   * displays this instead of re-deriving the decision from its own settings
   * copy — the second derivation is where every lying-header bug came from.
   */
  resolveActiveModel: async (): Promise<any> =>
    await ipcRenderer.invoke('homebot:resolve-active-model'),

  /** What HomeBot changed this session, and the diff for one change. */
  changesList: async (): Promise<any> => await ipcRenderer.invoke('homebot:changes-list'),
  changesDiff: async (id: string): Promise<any> => await ipcRenderer.invoke('homebot:changes-diff', id),

  /**
   * App updates. main has checked, downloaded and installed updates since the
   * updater shipped — but no preload method or renderer listener existed, so a
   * user was never told an update was available and had no way to install one.
   */
  onUpdateAvailable: (cb: (info: { version: string; releaseDate?: string }) => void): (() => void) => {
    const l = (_e: any, info: any) => cb(info);
    ipcRenderer.on('homebot:update-available', l);
    return () => ipcRenderer.removeListener('homebot:update-available', l);
  },
  onUpdateProgress: (cb: (p: { percent: number; transferred?: number; total?: number }) => void): (() => void) => {
    const l = (_e: any, p: any) => cb(p);
    ipcRenderer.on('homebot:update-progress', l);
    return () => ipcRenderer.removeListener('homebot:update-progress', l);
  },
  onUpdateDownloaded: (cb: () => void): (() => void) => {
    const l = () => cb();
    ipcRenderer.on('homebot:update-downloaded', l);
    return () => ipcRenderer.removeListener('homebot:update-downloaded', l);
  },
  downloadUpdate: async (): Promise<any> => await ipcRenderer.invoke('homebot:download-update'),
  installUpdate: async (): Promise<any> => await ipcRenderer.invoke('homebot:install-update'),

  skillsList: async (): Promise<any> => {
    return await ipcRenderer.invoke('homebot:skills-list');
  },

  skillsOpenFolder: async (): Promise<any> => {
    return await ipcRenderer.invoke('homebot:skills-open-folder');
  },

  getSettings: async (): Promise<Settings> => {
    logDebug('[Preload] IPC invoke', ALLOWED_CHANNELS.GET_SETTINGS);
    try { pushRendererLog(`IPC invoke ${ALLOWED_CHANNELS.GET_SETTINGS}`); } catch (e) { safeCatch(e); }
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_SETTINGS) as Settings;
  },

  /**
   * Save user settings to main process
   */
  saveSettings: async (settings: Partial<Settings>): Promise<Settings> => {
    // saveSettings returns the updated settings (wrapped in { success:true, data })
    logDebug('[Preload] IPC invoke', ALLOWED_CHANNELS.SAVE_SETTINGS, { keys: Object.keys(settings || {}) });
    try { pushRendererLog(`IPC invoke ${ALLOWED_CHANNELS.SAVE_SETTINGS} keys=${Object.keys(settings || {}).join(',')}`); } catch (e) { safeCatch(e); }
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
    return await ipcRenderer.invoke('homebot:read-debug-logs');
  },

  getPerfAggregates: async (): Promise<{ startup: PerfStatSummary; firstToken: PerfStatSummary }> => {
    return await ipcRenderer.invoke('homebot:get-perf-aggregates');
  },

  getPerfHistory: async (limit?: number): Promise<{ startup: number[]; firstToken: number[] }> => {
    return await ipcRenderer.invoke('homebot:get-perf-history', typeof limit === 'number' ? limit : 20);
  },

  getMode: async (): Promise<{ demo: boolean }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_MODE);
  },

  executeImageGenerate: async ({ action, payload }: { action: string; payload?: any }) => {
    logDebug('[Preload] IPC invoke', ALLOWED_CHANNELS.AUTOMATION_IMAGE_GENERATE);
    try { pushRendererLog(`IPC invoke ${ALLOWED_CHANNELS.AUTOMATION_IMAGE_GENERATE}`); } catch (e) { safeCatch(e); }
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.AUTOMATION_IMAGE_GENERATE, { action, payload });
  },

  sdCppStatus: async () => {
    return await ipcRenderer.invoke('homebot:sd-cpp:status');
  },

  sdCppSetup: async () => {
    return await ipcRenderer.invoke('homebot:sd-cpp:setup');
  },

  sdCppAutoSetup: async () => {
    return await ipcRenderer.invoke('homebot:sd-cpp:auto-setup');
  },

  onSdCppSetupProgress: (cb: (p: { phase: string; note: string; receivedMB?: number; totalMB?: number | null }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on('homebot:sd-cpp:setup-progress', listener);
    return () => ipcRenderer.removeListener('homebot:sd-cpp:setup-progress', listener);
  },

  getEnv: async (): Promise<{ isE2E: boolean; isPackagedBuild: boolean; isReleaseBuild: boolean; userDataPath: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_ENV);
  },

  getConfigPath: async (): Promise<string> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_CONFIG_PATH);
  },

  getGeneratedImage: async (filename: string): Promise<string | null> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_GENERATED_IMAGE, filename);
  },

  // Test-only: allow invoking arbitrary channels from the renderer (only in E2E)
  // SECURITY: gated to E2E mode only — in production this throws to prevent
  // the renderer from invoking arbitrary IPC channels.
  invoke: async (channel: string, ...args: any[]) => {
    const e2e = process.env.HOMEBOT_E2E === '1' || process.env.HOMEBOT_E2E === 'true';
    if (!e2e) {
      throw new Error('invoke() is only available in E2E test mode');
    }
    return await ipcRenderer.invoke(channel, ...args);
  },

  captureScreen: async () => {
    return await ipcRenderer.invoke('homebot:capture-screen');
  },

  captureLogs: async (): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const r = await ipcRenderer.invoke('homebot:capture-logs');
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

  readPermissionAudit: async (): Promise<{ success: boolean; events?: any[]; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.READ_PERMISSION_AUDIT);
  },

  // ── Trust panel (Phase 2): read-only health + activity ────────────────────
  getSupervisorStatus: async (): Promise<{ success: boolean; status?: any; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_SUPERVISOR_STATUS);
  },

  getCrmActivity: async (limit?: number): Promise<{ success: boolean; items?: any[]; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_CRM_ACTIVITY, limit);
  },

  /** Live supervisor state-change pushes. Returns an unsubscribe function. */
  onSupervisorStatus: (callback: (change: any) => void): (() => void) => {
    const listener = (_event: unknown, change: any) => callback(change);
    ipcRenderer.on(ALLOWED_CHANNELS.SUPERVISOR_STATUS_PUSH, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.SUPERVISOR_STATUS_PUSH, listener);
  },

  getBatchSummaries: async (): Promise<{ success: boolean; summaries?: any[]; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_BATCH_SUMMARIES);
  },

  /** Read-only CRM numbers for the Dashboard landing page. */
  getCrmDashboard: async (): Promise<{ success: boolean; summary?: any; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_CRM_DASHBOARD);
  },

  // ── Interactive terminal ──────────────────────────────────────────────
  terminalCreate: async (cwd?: string): Promise<{ success: boolean; id?: string; cwd?: string; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.TERMINAL_CREATE, cwd);
  },
  terminalRun: async (id: string, command: string): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.TERMINAL_RUN, id, command);
  },
  terminalKill: async (id: string): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.TERMINAL_KILL, id);
  },
  terminalClose: async (id: string): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.TERMINAL_CLOSE, id);
  },
  // ── Workspace (Explorer + editor) ─────────────────────────────────────
  workspaceRoot: async (): Promise<{ success: boolean; path: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.WORKSPACE_ROOT);
  },
  workspaceList: async (dirPath: string): Promise<any> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.WORKSPACE_LIST, dirPath);
  },
  workspaceRead: async (filePath: string): Promise<any> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.WORKSPACE_READ, filePath);
  },
  workspaceSave: async (filePath: string, content: string): Promise<any> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.WORKSPACE_SAVE, filePath, content);
  },

  /** Tool calls made by the external assistant (Claude Code) via the bridge.
   *  Returns an unsubscribe function. */
  onAssistantToolActivity: (callback: (info: { tool: string; allowed: boolean; error?: string }) => void): (() => void) => {
    const listener = (_event: unknown, info: any) => callback(info);
    ipcRenderer.on(ALLOWED_CHANNELS.ASSISTANT_TOOL_ACTIVITY, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.ASSISTANT_TOOL_ACTIVITY, listener);
  },

  /** Streaming stdout/stderr for a running command. Returns an unsubscribe function. */
  onTerminalOutput: (callback: (chunk: any) => void): (() => void) => {
    const listener = (_event: unknown, chunk: any) => callback(chunk);
    ipcRenderer.on(ALLOWED_CHANNELS.TERMINAL_OUTPUT_PUSH, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.TERMINAL_OUTPUT_PUSH, listener);
  },
  /** Command completion (exit code, duration, resulting cwd). Returns an unsubscribe function. */
  onTerminalExit: (callback: (exit: any) => void): (() => void) => {
    const listener = (_event: unknown, exit: any) => callback(exit);
    ipcRenderer.on(ALLOWED_CHANNELS.TERMINAL_EXIT_PUSH, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.TERMINAL_EXIT_PUSH, listener);
  },

  /** Live batch-execution summary pushes. Returns an unsubscribe function. */
  onBatchSummary: (callback: (summary: any) => void): (() => void) => {
    const listener = (_event: unknown, summary: any) => callback(summary);
    ipcRenderer.on(ALLOWED_CHANNELS.BATCH_SUMMARY_PUSH, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.BATCH_SUMMARY_PUSH, listener);
  },

  clearPermissionAudit: async (): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.CLEAR_PERMISSION_AUDIT);
  },

  exportPermissionAudit: async (): Promise<{ success: boolean; path?: string; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.EXPORT_PERMISSION_AUDIT);
  },

  getAnalyticsSummary: async (): Promise<{ success: boolean; summary?: any; error?: string }> => {
    return await ipcRenderer.invoke('homebot:get-analytics-summary');
  },

  detectGpuVram: async () => {
    return await ipcRenderer.invoke('homebot:detect-gpu-vram');
  },

  runDiagnostics: async () => {
    return await ipcRenderer.invoke('homebot:run-diagnostics');
  },

  exportSettings: async () => {
    return await ipcRenderer.invoke('homebot:export-settings');
  },

  importSettings: async (filePath: string) => {
    return await ipcRenderer.invoke('homebot:import-settings', filePath);
  },

  parseDocument: async (filePath: string) => {
    return await ipcRenderer.invoke('homebot:parse-document', filePath);
  },

  writeDocument: async (filePath: string, content: string) => {
    return await ipcRenderer.invoke('homebot:write-document', filePath, content);
  },

  pullModel: async (modelName: string) => {
    return await ipcRenderer.invoke('homebot:pull-model', modelName);
  },

  pullModelStream: async (modelName: string) => {
    return await ipcRenderer.invoke('homebot:pull-model-stream', modelName);
  },

  onPullModelProgress: (cb: (data: { model: string; status: string; percent: number | null; completedMB: number | null; totalMB: number | null }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on('homebot:pull-model-progress', listener);
    return () => ipcRenderer.removeListener('homebot:pull-model-progress', listener);
  },

  checkOllamaInstalled: async () => {
    return await ipcRenderer.invoke('homebot:check-ollama-installed');
  },

  downloadOllama: async () => {
    return await ipcRenderer.invoke('homebot:download-ollama');
  },

  onOllamaDownloadProgress: (cb: (data: { stage: 'downloading' | 'installing' | 'starting' | 'ready'; percent: number; downloadedMB?: number; totalMB?: number }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on('homebot:ollama-download-progress', listener);
    return () => { ipcRenderer.removeListener('homebot:ollama-download-progress', listener); };
  },

  startOllama: async () => {
    return await ipcRenderer.invoke('homebot:start-ollama');
  },

  listOllamaModels: async () => {
    return await ipcRenderer.invoke('homebot:list-ollama-models');
  },

  deleteOllamaModel: async (modelName: string) => {
    return await ipcRenderer.invoke('homebot:delete-ollama-model', modelName);
  },

  hasPermission: async (toolName: string): Promise<{ success: boolean; allowed?: boolean; error?: string }> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.HAS_PERMISSION, toolName);
  },

  checkConnection: async (): Promise<ConnectionStatus> => {
    logDebug('[Preload] IPC invoke', 'homebot:check-connection');
    try { pushRendererLog('IPC invoke homebot:check-connection'); } catch (e) { safeCatch(e); }
    return await ipcRenderer.invoke('homebot:check-connection');
  },

  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  toggleWidgetMode: () => ipcRenderer.invoke('homebot:toggle-widget-mode') as Promise<boolean>,
  getWidgetMode: () => ipcRenderer.invoke('homebot:get-widget-mode') as Promise<boolean>,
  setAlwaysOnTop: (value: boolean) => ipcRenderer.send('homebot:set-always-on-top', value),
  onWidgetModeChanged: (callback: (isWidget: boolean) => void) => {
    const handler = (_event: any, isWidget: boolean) => callback(isWidget);
    ipcRenderer.on('homebot:widget-mode-changed', handler);
    return () => ipcRenderer.removeListener('homebot:widget-mode-changed', handler);
  },

  // ============= Memory/Conversation APIs =============

  loadConversations: async (): Promise<MemoryResult<ConversationStore>> => {
    return await ipcRenderer.invoke('homebot:load-conversations');
  },

  getConversation: async (conversationId: string): Promise<MemoryResult<StoredConversation | null>> => {
    return await ipcRenderer.invoke('homebot:get-conversation', conversationId);
  },

  createConversation: async (title?: string): Promise<MemoryResult<StoredConversation>> => {
    return await ipcRenderer.invoke('homebot:create-conversation', title);
  },

  saveConversation: async (conversation: StoredConversation): Promise<MemoryResult> => {
    return await ipcRenderer.invoke('homebot:save-conversation', conversation);
  },

  deleteConversation: async (conversationId: string): Promise<MemoryResult> => {
    return await ipcRenderer.invoke('homebot:delete-conversation', conversationId);
  },

  compactConversation: async (conversationId: string, keepRecent?: number) => {
    return await ipcRenderer.invoke('homebot:compact-conversation', conversationId, keepRecent);
  },

  setActiveConversation: async (conversationId: string | null): Promise<MemoryResult> => {
    return await ipcRenderer.invoke('homebot:set-active-conversation', conversationId);
  },

  addMessage: async (conversationId: string, message: Message): Promise<MemoryResult> => {
    return await ipcRenderer.invoke('homebot:add-message', { conversationId, message });
  },

  updateMessage: async (conversationId: string, messageId: string, updates: Partial<Message>): Promise<MemoryResult> => {
    return await ipcRenderer.invoke('homebot:update-message', { conversationId, messageId, updates });
  },

  // Speech recognition using Windows SAPI (offline capable)
  startSpeechRecognition: async (): Promise<{ success: boolean; text: string; error?: string }> => {
    return await ipcRenderer.invoke('homebot:start-speech-recognition');
  },

  // TTS (text-to-speech) — uses Web Speech API in renderer via main process
  ttsSpeak: async (text: string, rate?: number): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('homebot:tts-speak', text, rate);
  },
  ttsStop: async (): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('homebot:tts-stop');
  },
  // Voice picker: list neural voices and render a sample of one to a file.
  ttsListVoices: async (): Promise<any> => ipcRenderer.invoke('homebot:tts-list-voices'),
  ttsSampleVoice: async (voice: string, sampleText?: string, engine?: 'edge' | 'kokoro'): Promise<{ success: boolean; path?: string; error?: string; engine?: string }> =>
    ipcRenderer.invoke('homebot:tts-sample-voice', voice, sampleText, engine),

  // Scheduler — recurring / daily jobs
  schedulerList: async () => ipcRenderer.invoke('homebot:scheduler-list'),
  schedulerAdd: async (input: any) => ipcRenderer.invoke('homebot:scheduler-add', input),
  schedulerRemove: async (id: string) => ipcRenderer.invoke('homebot:scheduler-remove', id),
  schedulerToggle: async (id: string, enabled: boolean) => ipcRenderer.invoke('homebot:scheduler-toggle', id, enabled),

  // Licensing (Pro entitlement)
  // ---- Media Studio (video pipeline) ----
  mediaList: async () => ipcRenderer.invoke('homebot:media:list'),
  mediaParseFeed: async (url: string) => ipcRenderer.invoke('homebot:media:parse-feed', url),
  mediaCreate: async (input: { title: string; format?: 'short' | 'long'; brief?: string }) =>
    ipcRenderer.invoke('homebot:media:create', input),
  mediaAdvance: async (id: string, to: string, note?: string) =>
    ipcRenderer.invoke('homebot:media:advance', id, to, note),
  mediaRun: async (id: string, action: 'script' | 'narrate' | 'render', opts?: { voice?: string }) =>
    ipcRenderer.invoke('homebot:media:run', id, action, opts),
  mediaApprove: async (id: string, note?: string) =>
    ipcRenderer.invoke('homebot:media:approve', id, note),
  mediaReject: async (id: string, revise: boolean, note?: string) =>
    ipcRenderer.invoke('homebot:media:reject', id, revise, note),
  mediaFfmpegStatus: async () => ipcRenderer.invoke('homebot:media:ffmpeg-status'),
  mediaFfmpegSetup: async () => ipcRenderer.invoke('homebot:media:ffmpeg-setup'),
  onMediaFfmpegProgress: (cb: (p: any) => void) => {
    const listener = (_ev: IpcRendererEvent, p: any) => cb(p);
    ipcRenderer.on('homebot:media:ffmpeg-progress', listener);
    return () => ipcRenderer.removeListener('homebot:media:ffmpeg-progress', listener);
  },
  mediaMarkPublished: async (id: string, videoId: string, note?: string) =>
    ipcRenderer.invoke('homebot:media:mark-published', id, videoId, note),
  mediaDelete: async (id: string, keepFiles?: boolean) =>
    ipcRenderer.invoke('homebot:media:delete', id, keepFiles),
  mediaAncientPathwaysEpisodes: async () => ipcRenderer.invoke('homebot:media:ancient-pathways-episodes'),
  mediaAncientPathwaysStatus: async () => ipcRenderer.invoke('homebot:media:ancient-pathways-status'),
  mediaAncientPathwaysRun: async (episodeId: string) =>
    ipcRenderer.invoke('homebot:media:ancient-pathways-run', episodeId),
  onMediaAncientPathwaysProgress: (cb: (p: any) => void) => {
    const listener = (_ev: IpcRendererEvent, p: any) => cb(p);
    ipcRenderer.on('homebot:media:ancient-pathways-progress', listener);
    return () => ipcRenderer.removeListener('homebot:media:ancient-pathways-progress', listener);
  },
  licenseStatus: async () => ipcRenderer.invoke('homebot:license:status'),
  licenseActivate: async (licenseKey: string) => ipcRenderer.invoke('homebot:license:activate', licenseKey),
  licenseValidate: async () => ipcRenderer.invoke('homebot:license:validate'),
  licenseDeactivate: async () => ipcRenderer.invoke('homebot:license:deactivate'),

  // Uncensored mode toggle
  setUncensoredMode: async (enabled: boolean): Promise<{ success: boolean; enabled: boolean }> => {
    return await ipcRenderer.invoke('homebot:set-uncensored-mode', enabled);
  },

  getUncensoredMode: async (): Promise<{ enabled: boolean }> => {
    return await ipcRenderer.invoke('homebot:get-uncensored-mode');
  },

  // Restart the app (for settings that require restart)
  restartApp: async (): Promise<void> => {
    return await ipcRenderer.invoke('homebot:restart-app');
  },

  // Clipboard helper — uses Electron native clipboard (works with contextIsolation)
  writeClipboard: (text: string) => {
    clipboard.writeText(text);
  },

  // Open a file or folder in the system default application
  openFile: async (filePath: string): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('homebot:open-file', filePath);
  },

  // Open a folder in the system file explorer and select the file
  showInFolder: async (filePath: string): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('homebot:show-in-folder', filePath);
  },

  openExternalUrl: async (url: string): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke('homebot:open-external-url', url);
  },

  // Export chat history to the Desktop (markdown, docx, or pdf)
  exportChat: async (markdown: string, format?: string): Promise<{ success: boolean; path?: string; error?: string }> => {
    return await ipcRenderer.invoke('homebot:export-chat', markdown, format);
  },

  // List all registered tool definitions
  listTools: async (): Promise<{ success: boolean; tools?: { name: string; description: string; category: string }[]; error?: string }> => {
    return await ipcRenderer.invoke('homebot:list-tools');
  },

  // Fetch a web page and extract its text content
  fetchPageContent: async (url: string) => {
    return await ipcRenderer.invoke('homebot:fetch-page-content', url);
  },

  // RAG: index a local file (or web content when content is provided)
  ragIndex: async (filePath: string, content?: string) => {
    return await ipcRenderer.invoke('homebot:rag-index', filePath, content);
  },

  // RAG: list all indexed documents
  ragList: async () => {
    return await ipcRenderer.invoke('homebot:rag-list');
  },

  // RAG: remove a document from the index by doc_id
  ragClear: async (docId: string) => {
    return await ipcRenderer.invoke('homebot:rag-clear', docId);
  },

  // ── MCP Server Management ──────────────────────────────────────────────────
  mcpListServers: async () => ipcRenderer.invoke('homebot:mcp-list-servers'),
  mcpGetStatus: async () => ipcRenderer.invoke('homebot:mcp-get-status'),
  mcpAddServer: async (config: any) => ipcRenderer.invoke('homebot:mcp-add-server', config),
  mcpRemoveServer: async (name: string) => ipcRenderer.invoke('homebot:mcp-remove-server', name),
  mcpToggleServer: async (name: string, enabled: boolean) => ipcRenderer.invoke('homebot:mcp-toggle-server', name, enabled),

  // Full-text search across all stored conversations
  searchConversations: async (query: string, maxResults?: number) =>
    ipcRenderer.invoke('homebot:search-conversations', query, maxResults),

  // Export a single conversation as Markdown or JSON to Desktop
  exportConversation: async (conversationId: string, format?: string) =>
    ipcRenderer.invoke('homebot:export-conversation', conversationId, format),

  // Auto-generate a conversation title from the first user+assistant exchange
  generateTitle: async (args: { conversationId: string; userMessage: string; assistantReply: string }) =>
    ipcRenderer.invoke('homebot:generate-title', args),

  // Subscribe to title-updated push events from main process
  onTitleUpdated: (cb: (data: { conversationId: string; title: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { conversationId: string; title: string }) => cb(data);
    ipcRenderer.on('homebot:title-updated', handler);
    return () => ipcRenderer.removeListener('homebot:title-updated', handler);
  },

  // Feeds panel — reading RSS/Atom sources
  fetchFeeds: async (sources?: string[]) =>
    ipcRenderer.invoke('homebot:fetch-feeds', { sources }),
  listFeedSources: async () =>
    ipcRenderer.invoke('homebot:list-feed-sources'),
  // Home screen — what works right now and how to fix what does not
  getCapabilityReport: async () =>
    ipcRenderer.invoke('homebot:capability-report'),

  // Sharpen a draft request before sending it
  improvePrompt: async (draft: string) =>
    ipcRenderer.invoke('homebot:improve-prompt', { draft }),

  // Automation Center
  loadAutomations: async () =>
    ipcRenderer.invoke('homebot:load-automations'),
  createAutomation: async (data: any) =>
    ipcRenderer.invoke('homebot:create-automation', data),
  updateAutomation: async (data: any) =>
    ipcRenderer.invoke('homebot:update-automation', data),
  deleteAutomation: async (data: any) =>
    ipcRenderer.invoke('homebot:delete-automation', data),
  runAutomation: async (data: any) =>
    ipcRenderer.invoke('homebot:run-automation', data),
  // Test n8n reachability + API-key auth (values may be unsaved Settings input)
  testN8nConnection: async (data: { baseUrl?: string; apiKey?: string }) =>
    ipcRenderer.invoke('homebot:n8n-test-connection', data),

  // Quiz mode
  generateQuiz: async (params: any) =>
    ipcRenderer.invoke('homebot:generate-quiz', params),
  generateQuizFromRag: async (params: any) =>
    ipcRenderer.invoke('homebot:generate-quiz-from-rag', params),
  saveQuizProgress: async (progress: any) =>
    ipcRenderer.invoke('homebot:save-quiz-progress', progress),
  loadQuizProgress: async () =>
    ipcRenderer.invoke('homebot:load-quiz-progress'),
};

// Expose the API to the renderer process. Cast to the canonical ElectronAPI to ensure type alignment.
contextBridge.exposeInMainWorld('electron', electronAPI as unknown as ElectronAPI);
// Expose a simple capture API for renderer to forward logs into the main global buffer
contextBridge.exposeInMainWorld('homebotCapture', {
  log: (msg: string) => { try { pushRendererLog(msg); } catch (e) { safeCatch(e); } }
});
// The _webServices bridge and its _webviewPreload stub were removed with the
// Web Services panel — they had exactly one consumer. The main-process
// handlers (homebot:open-web-service etc.) stay: the ChatGPT/Claude/Gemini
// login windows are still reachable, and the docked browser panel is the
// in-app way to browse now.

// Export types for TypeScript consumers
// Re-export the type (forwarded from shared/types)
export type { ElectronAPI };
