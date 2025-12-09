export interface SadieRequest {
  user_id: string;
  conversation_id: string;
  message: string;
  timestamp?: string;
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

export interface Settings {
  alwaysOnTop: boolean;
  n8nUrl: string;
  widgetHotkey: string;
  uncensoredMode?: boolean;
  // First-run / telemetry
  firstRun?: boolean;
  telemetryEnabled?: boolean;
  telemetryConsentTimestamp?: string;
  telemetryConsentVersion?: string;
  // Per-tool permissions (keys are tool names)
  permissions?: Record<string, boolean>;
  defaultTeam?: string;
}

export interface ConnectionStatus {
  n8n: 'online' | 'offline' | 'checking';
  ollama: 'online' | 'offline' | 'checking';
  lastChecked?: string;
}

export interface ElectronAPI {
  sendMessage: (request: SadieRequest) => Promise<SadieResponse>;
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Partial<Settings>) => Promise<Settings>;
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
  
  // Uncensored mode toggle
  setUncensoredMode?: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;
  getUncensoredMode?: () => Promise<{ enabled: boolean }>;
  
  // Restart app
  restartApp?: () => Promise<void>;
  
  // Confirmation for dangerous operations
  onConfirmationRequest?: (cb: (data: { confirmationId: string; message: string; streamId: string }) => void) => () => void;
  sendConfirmationResponse?: (confirmationId: string, confirmed: boolean) => void;
  exportTelemetryConsent?: () => Promise<{ success: boolean; path?: string; error?: string }>;
  resetPermissions?: () => Promise<Settings>;
}
