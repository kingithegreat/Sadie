export interface SadieRequest {
  user_id: string;
  conversation_id: string;
  message: string;
  timestamp?: string;
  /** Per-conversation system prompt supplied by the renderer (avoids disk read race) */
  conversationPrompt?: string;
}

export interface ImageAttachment {
  filename?: string;
  path?: string;
  mimeType?: string;
  size?: number;
  // Payload fields
  data?: string;   // base64 without data URL prefix
  base64?: string; // legacy alias
  dataUrl?: string; // data:<mime>;base64,...
  // Renderer-only preview URL (objectURL or data URL). Main will ignore this field.
  url?: string;
}

export interface DocumentAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  data: string; // base64-encoded content
}

/**
 * SadieRequest supports multiple images via `images`.
 * The single `image` field is kept for backward compatibility but is deprecated.
 */
export interface SadieRequestWithImages extends SadieRequest {
  /** @deprecated Prefer `images` for multiple attachments */
  image?: ImageAttachment;
  images?: ImageAttachment[];
  documents?: DocumentAttachment[];
}

export interface SadieResponse {
  success: boolean;
  data?: any;
  error?: boolean;
  message?: string;
  details?: string;
  response?: string;
}

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  error?: boolean;
  streamingState?: 'pending' | 'streaming' | 'finished' | 'cancelled' | 'error';
  image?: ImageAttachment | null;
}

// Memory/Conversation types
export interface StoredConversation {
  id: string;
  title: string;
  messages: Message[];
  /** Optional per-conversation system prompt / guidelines */
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationStore {
  conversations: StoredConversation[];
  activeConversationId: string | null;
}

export interface MemoryResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ModelMetadata {
  contextWindow: number;
  maxTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
}

export interface CustomModelInfo {
  id: string;
  name?: string;
  description?: string;
  provider?: string;
  contextWindow?: number;
}

export interface CustomLLMConfig {
  name: string;
  apiUrl: string;
  apiKey?: string;
  provider: 'openai' | 'anthropic' | 'openrouter' | 'custom';
  model?: string;
  enabled: boolean;
  metadata?: ModelMetadata;
}

export interface Settings {
  alwaysOnTop: boolean;
  n8nUrl: string;
  widgetHotkey: string;
  uncensoredMode?: boolean;
  chatModel?: string;
  uncensoredModel?: string;
  visionModel?: string;
  // Custom LLM API support
  customLLM?: CustomLLMConfig;
  useCustomLLM?: boolean;
  // First-run / telemetry
  firstRun?: boolean;
  telemetryEnabled?: boolean;
  telemetryConsentTimestamp?: string;
  telemetryConsentVersion?: string;
  // Per-tool permissions (keys are tool names)
  permissions?: Record<string, boolean>;
  defaultTeam?: string;
  // Web search API keys
  tavilyApiKey?: string;
  serperApiKey?: string;
  // LLM provider API keys
  anthropicApiKey?: string;
  openaiApiKey?: string;
  // Image generation API keys
  stableHordeApiKey?: string;
  // Code model routing
  codeModel?: string;
  codeApiKey?: string;
  codeApiProvider?: 'openai' | 'anthropic' | 'openrouter' | 'custom';
  codeApiUrl?: string;
  // Custom chat guidelines appended to system prompt
  chatGuidelines?: string;
}

export interface ConnectionStatus {
  n8n: 'online' | 'offline' | 'checking';
  ollama: 'online' | 'offline' | 'checking';
  lastChecked?: string;
}

export interface ScheduledJob {
  id: string;
  name: string;
  message: string;
  intervalMinutes: number;
  dailyTime?: string;
  enabled: boolean;
  lastFiredAt?: number;
  createdAt: number;
}

export interface ElectronAPI {
  sendMessage: (request: SadieRequest) => Promise<SadieResponse>;
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Partial<Settings>) => Promise<Settings>;
  getMode?: () => Promise<{ demo: boolean }>;
  readConsentLog?: () => Promise<{ success: boolean; data?: string; error?: string }>;
  hasPermission?: (toolName: string) => Promise<{ success: boolean; allowed?: boolean; error?: string }>;
  checkConnection: () => Promise<ConnectionStatus>;
  onShowWindow: (callback: () => void) => void;
  onHideWindow: (callback: () => void) => void;
  removeShowWindowListener: () => void;
  removeHideWindowListener: () => void;
  minimizeWindow?: () => void;
  closeWindow?: () => void;
  // SSE/stream helpers
  cancelStream?: (streamId?: string) => void;
  sendStreamMessage?: (request: SadieRequestWithImages & { streamId?: string }) => Promise<void>;
  onStreamChunk?: (callback: (data: { streamId?: string; chunk: string }) => void) => (() => void) | void;
  onStreamEnd?: (callback: (data: { streamId?: string; cancelled?: boolean }) => void) => (() => void) | void;
  onStreamError?: (callback: (err: { streamId?: string; error?: string }) => void) => (() => void) | void;
  /**
   * Convenience helper: subscribe to a specific streamId and receive
   * chunk/end/error callbacks grouped together. Returns an unsubscribe function.
   */
  subscribeToStream?: (streamId: string, handlers: {
    onStreamChunk?: (data: { streamId?: string; chunk: string }) => void;
    onStreamEnd?: (data: { streamId?: string; cancelled?: boolean }) => void;
    onStreamError?: (err: { streamId?: string; error?: string }) => void;
  }) => (() => void) | void;
  onMessage?: (callback: (data: any) => void) => (() => void) | void;
  
  // Memory/Conversation APIs
  loadConversations?: () => Promise<MemoryResult<ConversationStore>>;
  getConversation?: (conversationId: string) => Promise<MemoryResult<StoredConversation | null>>;
  createConversation?: (title?: string) => Promise<MemoryResult<StoredConversation>>;
  saveConversation?: (conversation: StoredConversation) => Promise<MemoryResult>;
  deleteConversation?: (conversationId: string) => Promise<MemoryResult>;
  setActiveConversation?: (conversationId: string | null) => Promise<MemoryResult>;
  addMessage?: (conversationId: string, message: Message) => Promise<MemoryResult>;
  updateMessage?: (conversationId: string, messageId: string, updates: Partial<Message>) => Promise<MemoryResult>;
  
  // Speech recognition (Windows SAPI - offline capable)
  startSpeechRecognition?: () => Promise<{ success: boolean; text: string; error?: string }>;

  // TTS (text-to-speech)
  ttsSpeak?: (text: string, rate?: number) => Promise<{ success: boolean; error?: string }>;
  ttsStop?: () => Promise<{ success: boolean; error?: string }>;

  // Scheduler
  schedulerList?: () => Promise<ScheduledJob[]>;
  schedulerAdd?: (input: Omit<ScheduledJob, 'id' | 'createdAt'>) => Promise<{ success: boolean; job?: ScheduledJob; error?: string }>;
  schedulerRemove?: (id: string) => Promise<{ success: boolean }>;
  schedulerToggle?: (id: string, enabled: boolean) => Promise<{ success: boolean; job?: ScheduledJob; error?: string }>;
  
  // Uncensored mode toggle
  setUncensoredMode?: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;
  getUncensoredMode?: () => Promise<{ enabled: boolean }>;
  
  // Restart app
  restartApp?: () => Promise<void>;
  
  // Confirmation for dangerous operations
  onConfirmationRequest?: (cb: (data: { confirmationId: string; message: string; streamId: string }) => void) => () => void;
  sendConfirmationResponse?: (confirmationId: string, confirmed: boolean) => void;
  // Permission escalation flow
  onPermissionRequest?: (cb: (data: { requestId: string; missingPermissions: string[]; reason: string; streamId?: string }) => void) => () => void;
  sendPermissionResponse?: (requestId: string, decision: 'allow_once'|'always_allow'|'cancel', missingPermissions?: string[]) => void;
  exportTelemetryConsent?: () => Promise<{ success: boolean; path?: string; error?: string }>;
  resetPermissions?: () => Promise<Settings>;
  // Debug helper exposed for dev/E2E: returns main + renderer log buffers and conversation store snapshot
  readDebugLogs?: () => Promise<{ success: boolean; rendererLogs?: string[]; mainLogs?: string[]; conversationStore?: any; error?: string }>;
  
  // Diagnostic: get env info
  getEnv?: () => Promise<{ isE2E: boolean; isPackagedBuild: boolean; isReleaseBuild: boolean; userDataPath: string }>;
  
  // Diagnostic: get config file path
  getConfigPath?: () => Promise<string>;
  // Capture logs helper (write runtime snapshot and return path)
  captureLogs?: () => Promise<{ success: boolean; path?: string; error?: string }>;
  // Test-only: invoke arbitrary IPC channels (E2E only)
  invoke?: (channel: string, ...args: any[]) => Promise<any>;

  listCustomLLMModels?: (config: { apiUrl: string; apiKey?: string; provider?: CustomLLMConfig['provider'] }) => Promise<{ success: boolean; models?: CustomModelInfo[]; error?: string }>;

  // Image generation helper
  executeImageGenerate?: (params: { action: string; payload?: any }) => Promise<any>;

  // Clipboard helper (uses Electron native clipboard, works with contextIsolation)
  writeClipboard?: (text: string) => void;
  exportChat?: (markdown: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  listTools?: () => Promise<{ success: boolean; tools?: { name: string; description: string; category: string }[]; error?: string }>;
  onReminderFired?: (cb: (data: { message: string; label: string }) => void) => () => void;
}
