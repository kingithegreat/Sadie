// ── Pro licensing / entitlements (renderer-facing mirror of src/entitlements + src/licensing) ──
export type LicenseTier = 'free' | 'pro';

export interface UpgradePrompt {
  reason: 'upgrade_required';
  capability: string;
  requiredTier: LicenseTier;
  title: string;
  message: string;
  upgradeUrl: string;
}

/** Shape returned by a Pro-gated IPC handler when the caller is on Free. */
export interface GateBlockedResponse {
  status: 'upgrade_required';
  upgrade: UpgradePrompt;
}

export interface LicenseStatus {
  tier: LicenseTier;
  hasLicense: boolean;
  lastValidatedAt?: number;
  expiresAt?: number;
  upgradeUrl: string;
}

/** Result of an activate/validate/deactivate call against the license provider. */
export interface LicenseActionResult {
  valid: boolean;
  status?: string;
  instanceId?: string;
  activationUsage?: number;
  activationLimit?: number;
  expiresAt?: string | null;
  error?: string;
}

export interface HomeBotRequest {
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
 * HomeBotRequest supports multiple images via `images`.
 * The single `image` field is kept for backward compatibility but is deprecated.
 */
export interface HomeBotRequestWithImages extends HomeBotRequest {
  /** @deprecated Prefer `images` for multiple attachments */
  image?: ImageAttachment;
  images?: ImageAttachment[];
  documents?: DocumentAttachment[];
  /** Optional per-message local-model override used for task-aware auto-routing. */
  modelOverride?: string;
  /** True when resending an earlier turn so the router should not duplicate history. */
  retry?: boolean;
}

export interface HomeBotResponse {
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
  createdAt?: string;
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
  /** Optional per-conversation model override (e.g. 'qwen2.5:7b' or 'gpt-4o') */
  model?: string;
  pinned?: boolean;
  archived?: boolean;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSearchResult {
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  role: string;
  snippet: string;
  matchIndex: number;
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

/** A tool call the external assistant made through the permission-gated bridge. */
export interface AssistantToolActivity {
  tool: string;
  allowed: boolean;
  error?: string;
}

/** A file or folder in the Explorer tree. */
export interface WorkspaceEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

/** One streamed chunk of output from an interactive terminal session. */
export interface TerminalOutputChunk {
  sessionId: string;
  stream: 'stdout' | 'stderr' | 'system';
  data: string;
}

/** Completion of a terminal command; `cwd` reflects any `cd` that ran. */
export interface TerminalExitEvent {
  sessionId: string;
  code: number | null;
  signal: string | null;
  durationMs: number;
  cwd: string;
}

export interface CustomModelInfo {
  id: string;
  name?: string;
  description?: string;
  provider?: string;
  contextWindow?: number;
  /** Human-readable cost hint shown in the model picker, e.g. "~$0.27/1M" or "Free tier" */
  costHint?: string;
}

export interface CustomLLMConfig {
  name: string;
  apiUrl: string;
  apiKey?: string;
  provider: 'openai' | 'anthropic' | 'claude-code' | 'codex' | 'moonshot' | 'openrouter' | 'tokenrouter' | 'groq' | 'deepseek' | 'google-ai-studio' | 'google-gemini' | 'huggingface' | 'cerebras' | 'sambanova' | 'together' | 'custom';
  model?: string;
  enabled: boolean;
  metadata?: ModelMetadata;
}

export interface Settings {
  alwaysOnTop: boolean;
  n8nUrl: string;
  n8nApiKey?: string;
  // Voice input (speech-to-text)
  voiceEngine?: 'whisper' | 'sapi' | 'webspeech';
  whisperModel?: 'tiny' | 'base' | 'small';
  voiceLanguage?: string;
  voiceSilenceStopSec?: number;
  voiceMicDeviceId?: string;
  widgetHotkey: string;
  globalHotkey?: string;
  theme?: 'light' | 'dark' | 'system';
  uncensoredMode?: boolean;
  modelRoutingMode?: 'off' | 'prompt' | 'auto';
  chatModel?: string;
  uncensoredModel?: string;
  visionModel?: string;
  // Custom LLM API support
  customLLM?: CustomLLMConfig;
  useCustomLLM?: boolean;
  // First-run / telemetry
  firstRun?: boolean;
  telemetryEnabled?: boolean;
  /**
   * Media Studio publishing kill switch. Off by default — a fresh install
   * cannot put a video on a channel until this is deliberately turned on.
   */
  mediaPublishingEnabled?: boolean;
  /**
   * Allow a rendering proxy (Jina Reader) as the LAST fetch fallback when a
   * page cannot be read locally. Off by default: it is the only fetch tier
   * that sends the URL off this machine.
   */
  webReaderFallbackEnabled?: boolean;
  /** Mix background music under video narration. Off unless a folder is set. */
  mediaMusicEnabled?: boolean;
  /**
   * Folder holding the user's own music tracks. A folder rather than a service:
   * no account, no rate limit, no licence question, and it works offline.
   * One track is chosen per video, seeded by the job id so a re-render reuses it.
   */
  mediaMusicFolder?: string;
  /**
   * Cloud chat temperature override (0–2). Unset = provider default.
   * Mirrors the main-process Settings key.
   */
  chatTemperature?: number;
  /**
   * Whether chats are written to conversation-history.json. Defaults to true.
   *
   * It was absent from this interface, which is why no control for it could be
   * written: the renderer literally could not see the key. It existed in the
   * main-process Settings, round-tripped through disk and IPC, and no code read
   * it — so setting it to false saved every message anyway.
   */
  saveConversationHistory?: boolean;
  telemetryConsentTimestamp?: string;
  telemetryConsentVersion?: string;
  // Per-tool permissions (keys are tool names)
  permissions?: Record<string, boolean>;
  permissionPromptTimeoutMs?: number;
  defaultTeam?: string;
  // Web search API keys
  /**
   * A self-hosted SearXNG instance, e.g. http://localhost:8080. The only search
   * backend that is free, unmetered, keyless and accountless at once — and not
   * a scraper, so it does not get challenge-paged like the DuckDuckGo endpoints.
   */
  searxngUrl?: string;
  tavilyApiKey?: string;
  serperApiKey?: string;
  // LLM provider API keys
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  /** Moonshot / Kimi — OpenAI-compatible API at api.moonshot.ai. */
  moonshotApiKey?: string;
  /**
   * One API key per cloud provider, keyed by `CustomLLMConfig['provider']`.
   *
   * The four fields above predate this and only cover anthropic, openai,
   * gemini and moonshot — while the picker offers thirteen providers. groq,
   * deepseek, huggingface, cerebras, sambanova, together and custom had
   * nowhere to persist a key, so they shared the single `customLLM.apiKey`
   * slot and configuring a second one destroyed the first.
   *
   * Read through `apiKeyForProvider`, never directly: the legacy fields are
   * still written for the four they cover, so a downgrade does not lose them.
   * Encrypted at rest per value, like every other secret.
   */
  providerApiKeys?: Record<string, string>;
  // Image generation API keys
  stableHordeApiKey?: string;
  // Code model routing
  codeModel?: string;
  codeApiKey?: string;
  codeApiProvider?: 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'deepseek' | 'google-ai-studio' | 'google-gemini' | 'huggingface' | 'cerebras' | 'sambanova' | 'together' | 'custom';
  codeApiUrl?: string;
  // Custom chat guidelines appended to system prompt
  chatGuidelines?: string;
  // Calendar integration
  calendarIcsUrl?: string;
  // Notification preferences
  notificationsEnabled?: boolean;
  notificationSound?: boolean;
  notificationDuration?: number;
  // Morning briefing (weather + calendar + reminders on first message of the day)
  morningBriefing?: boolean;
  // Display density
  messageDensity?: 'compact' | 'comfortable' | 'spacious';
  // Hardware profile for model recommendations
  hardwareProfile?: '4gb' | '8gb' | '16gb+';
  // Active project/workspace directory for dev tools (terminal, grep, tree)
  projectPath?: string;
  // Mixture of Agents (MoA) settings
  moaEnabled?: boolean;
  moaProposers?: string[];
  moaAggregator?: string;
  // Default location for weather queries
  defaultLocation?: string;
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

export interface PerfStatSummary {
  count: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  min_ms: number;
  max_ms: number;
  last_ms: number | null;
}

/** A single recorded permission decision, surfaced in the Permission History UI. */
export interface PermissionAuditEntry {
  id: string;
  timestamp: string;
  permissions: string[];
  reason: string;
  decision: 'allow_once' | 'always_allow' | 'cancel' | 'expired';
  streamId?: string;
}

/** Bounds for the docked browser view, in CSS pixels relative to the window. */
export interface BrowserPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Live state of the docked browser, pushed from main as the user navigates. */
export interface BrowserPanelState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface ElectronAPI {
  sendMessage: (request: HomeBotRequest) => Promise<HomeBotResponse>;
  getSettings: () => Promise<Settings>;

  /** Skills: markdown recipes in userData/skills, listed in Settings. */
  skillsList: () => Promise<{
    success: boolean;
    dir?: string;
    error?: string;
    skills?: Array<{
      name: string;
      description: string;
      whenToUse: string | null;
      tools: string[] | null;
      path: string;
    }>;
  }>;
  skillsOpenFolder: () => Promise<{ success: boolean; dir?: string; error?: string }>;

  /** App updates — all three listeners return an unsubscribe function. */
  onUpdateAvailable: (cb: (info: { version: string; releaseDate?: string }) => void) => () => void;
  onUpdateProgress: (cb: (p: { percent: number; transferred?: number; total?: number }) => void) => () => void;
  onUpdateDownloaded: (cb: () => void) => () => void;
  downloadUpdate: () => Promise<any>;
  installUpdate: () => Promise<any>;

  /** Review surface: files HomeBot changed, newest first. */
  changesList: () => Promise<{
    success: boolean;
    error?: string;
    changes?: Array<{ id: string; path: string; tool: string; at: number; created: boolean }>;
  }>;
  changesDiff: (id: string) => Promise<{
    success: boolean;
    error?: string;
    path?: string;
    tool?: string;
    created?: boolean;
    stats?: { added: number; removed: number; approximate: boolean };
    hunks?: Array<{
      beforeStart: number;
      afterStart: number;
      lines: Array<{ type: 'equal' | 'add' | 'remove'; before: number | null; after: number | null; text: string }>;
    }>;
  }>;

  /** Router's answer to "which model replies right now?" — drives the header. */
  resolveActiveModel: () => Promise<{
    success: boolean;
    source?: 'cloud' | 'local';
    model?: string;
    provider?: string | null;
    reason?: string | null;
    error?: string;
  }>;

  /** Browser side panel — a BrowserView docked inside the window. */
  browserAttach: (url?: string, bounds?: BrowserPanelBounds) => Promise<{ success: boolean; error?: string; state?: BrowserPanelState }>;
  browserDetach: () => Promise<{ success: boolean; error?: string }>;
  browserBounds: (bounds: BrowserPanelBounds) => Promise<{ success: boolean; error?: string }>;
  browserNavigate: (url: string) => Promise<{ success: boolean; error?: string }>;
  browserBack: () => Promise<{ success: boolean }>;
  browserForward: () => Promise<{ success: boolean }>;
  browserReload: () => Promise<{ success: boolean }>;
  browserCapture: () => Promise<{ success: boolean; base64?: string; mimeType?: string; url?: string; title?: string; error?: string }>;
  /** Returns an unsubscribe function — call it on unmount or the listener leaks. */
  onBrowserState: (cb: (state: BrowserPanelState) => void) => () => void;
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
  maximizeWindow?: () => void;
  closeWindow?: () => void;
  toggleWidgetMode?: () => Promise<boolean>;
  getWidgetMode?: () => Promise<boolean>;
  setAlwaysOnTop?: (value: boolean) => void;
  onWidgetModeChanged?: (callback: (isWidget: boolean) => void) => () => void;
  // SSE/stream helpers
  cancelStream?: (streamId?: string) => void;
  sendStreamMessage?: (request: HomeBotRequestWithImages & { streamId?: string }) => Promise<void>;
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
  compactConversation?: (conversationId: string, keepRecent?: number) => Promise<{ success: boolean; originalCount: number; compactedCount: number; archivePath?: string; error?: string }>;
  setActiveConversation?: (conversationId: string | null) => Promise<MemoryResult>;
  addMessage?: (conversationId: string, message: Message) => Promise<MemoryResult>;
  updateMessage?: (conversationId: string, messageId: string, updates: Partial<Message>) => Promise<MemoryResult>;
  
  // Speech recognition (Windows SAPI - offline capable)
  startSpeechRecognition?: () => Promise<{ success: boolean; text: string; error?: string }>;

  // TTS (text-to-speech)
  ttsSpeak?: (text: string, rate?: number) => Promise<{ success: boolean; error?: string }>;
  ttsStop?: () => Promise<{ success: boolean; error?: string }>;
  // Voice picker: list neural voices; render a short sample of one to a file.
  ttsListVoices?: () => Promise<any>;
  ttsSampleVoice?: (voice: string, sampleText?: string) => Promise<{ success: boolean; path?: string; error?: string }>;

  // Scheduler (Pro-gated — handlers may resolve to GateBlockedResponse for free users)
  schedulerList?: () => Promise<ScheduledJob[] | GateBlockedResponse>;
  schedulerAdd?: (input: Omit<ScheduledJob, 'id' | 'createdAt'>) => Promise<{ success: boolean; job?: ScheduledJob; error?: string } | GateBlockedResponse>;
  schedulerRemove?: (id: string) => Promise<{ success: boolean } | GateBlockedResponse>;
  schedulerToggle?: (id: string, enabled: boolean) => Promise<{ success: boolean; job?: ScheduledJob; error?: string } | GateBlockedResponse>;

  // Licensing (Pro entitlement — Lemon Squeezy backed)
  // ---- Media Studio ----
  // Every mutation returns { ok, job } or { ok: false, error } so the panel can
  // show the state machine's own refusal text rather than inventing one.
  mediaList?: () => Promise<any[]>;
  mediaParseFeed?: (url: string) => Promise<{
    ok: boolean;
    feed?: {
      showTitle: string;
      showDescription: string;
      episodes: Array<{ title: string; summary: string; published: string; duration: string }>;
    };
    error?: string;
  }>;
  mediaCreate?: (input: { title: string; format?: 'short' | 'long'; brief?: string }) =>
    Promise<{ ok: boolean; job?: any; error?: string }>;
  mediaAdvance?: (id: string, to: string, note?: string) =>
    Promise<{ ok: boolean; job?: any; error?: string }>;
  mediaRun?: (id: string, action: 'script' | 'narrate' | 'render', opts?: { voice?: string }) =>
    Promise<{ ok: boolean; message?: string; error?: string }>;
  mediaApprove?: (id: string, note?: string) =>
    Promise<{ ok: boolean; job?: any; error?: string }>;
  mediaReject?: (id: string, revise: boolean, note?: string) =>
    Promise<{ ok: boolean; job?: any; error?: string }>;
  /**
   * Record that a video went out, with the id or link the platform gave it.
   * HomeBot does not upload — this is the user reporting back, which is what
   * makes the "already published" guard able to fire.
   */
  mediaMarkPublished?: (id: string, videoId: string, note?: string) =>
    Promise<{ ok: boolean; job?: any; error?: string }>;
  mediaDelete?: (id: string, keepFiles?: boolean) =>
    Promise<{ ok: boolean; message?: string; error?: string }>;
  licenseStatus?: () => Promise<LicenseStatus>;
  licenseActivate?: (licenseKey: string) => Promise<LicenseActionResult>;
  licenseValidate?: () => Promise<LicenseActionResult>;
  licenseDeactivate?: () => Promise<LicenseActionResult>;

  // Uncensored mode toggle
  setUncensoredMode?: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>;
  getUncensoredMode?: () => Promise<{ enabled: boolean }>;
  
  // Restart app
  restartApp?: () => Promise<void>;
  
  // Confirmation for dangerous operations
  onConfirmationRequest?: (cb: (data: { confirmationId: string; message: string; streamId: string }) => void) => () => void;
  sendConfirmationResponse?: (confirmationId: string, confirmed: boolean) => void;
  // Permission escalation flow
  onPermissionRequest?: (cb: (data: { requestId: string; missingPermissions: string[]; reason: string; streamId?: string; timeoutMs?: number }) => void) => () => void;
  sendPermissionResponse?: (requestId: string, decision: 'allow_once'|'always_allow'|'cancel', missingPermissions?: string[]) => void;
  exportTelemetryConsent?: () => Promise<{ success: boolean; path?: string; error?: string }>;
  resetPermissions?: () => Promise<Settings>;
  // Debug helper exposed for dev/E2E: returns main + renderer log buffers and conversation store snapshot
  readDebugLogs?: () => Promise<{ success: boolean; rendererLogs?: string[]; mainLogs?: string[]; conversationStore?: any; error?: string }>;

  // Diagnostic: baseline perf aggregates (startup + first-token/TTFT) for the Settings Diagnostics section
  getPerfAggregates?: () => Promise<{ startup: PerfStatSummary; firstToken: PerfStatSummary }>;
  // Diagnostic: recent raw perf samples (chronological) for the Diagnostics trend sparklines
  getPerfHistory?: (limit?: number) => Promise<{ startup: number[]; firstToken: number[] }>;
  
  // Diagnostic: get env info
  getEnv?: () => Promise<{ isE2E: boolean; isPackagedBuild: boolean; isReleaseBuild: boolean; userDataPath: string }>;
  
  // Diagnostic: get config file path
  getConfigPath?: () => Promise<string>;
  // Capture logs helper (write runtime snapshot and return path)
  captureScreen?: () => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
  captureLogs?: () => Promise<{ success: boolean; path?: string; error?: string }>;
  // Test-only: invoke arbitrary IPC channels (E2E only)
  invoke?: (channel: string, ...args: any[]) => Promise<any>;

  listCustomLLMModels?: (config: { apiUrl: string; apiKey?: string; provider?: CustomLLMConfig['provider'] }) => Promise<{ success: boolean; models?: CustomModelInfo[]; error?: string }>;

  // Image generation helper
  executeImageGenerate?: (params: { action: string; payload?: any }) => Promise<any>;
  getGeneratedImage?: (filename: string) => Promise<string | null>;
  // Local image-gen backend (stable-diffusion.cpp) status + one-time setup.
  // Neither IPC handler (ipc-handlers.ts) ever returns null on any path, so
  // this is not Optional/nullable — see the fix note where the stray
  // duplicate declaration further down used to claim otherwise.
  sdCppStatus?: () => Promise<{ ready: boolean; hasBinary: boolean; hasModel: boolean; dir: string; modelsDir: string }>;
  sdCppAutoSetup?: () => Promise<{ success: boolean; message?: string; error?: string }>;
  onSdCppSetupProgress?: (cb: (p: { phase: string; note: string; receivedMB?: number; totalMB?: number | null }) => void) => () => void;
  sdCppSetup?: () => Promise<{ success: boolean; message?: string; dir?: string; modelsDir?: string; instructions?: string[] }>;
  // Full system/connectivity diagnostics report
  runDiagnostics?: () => Promise<{ success: boolean; error?: string; [key: string]: any }>;

  // Clipboard helper (uses Electron native clipboard, works with contextIsolation)
  writeClipboard?: (text: string) => void;
  exportChat?: (markdown: string, format?: 'markdown' | 'docx' | 'pdf') => Promise<{ success: boolean; path?: string; error?: string }>;
  listTools?: () => Promise<{ success: boolean; tools?: { name: string; description: string; category: string }[]; error?: string }>;
  onReminderFired?: (cb: (data: { message: string; label: string }) => void) => () => void;
  onHardwareProfileApplied?: (cb: (data: { profile: string; vramGB: number; gpuName: string | null }) => void) => () => void;
  onConfigRecovered?: (cb: (data: { reason: string; backupPath: string | null; timestamp: string }) => void) => () => void;
  onProactiveBriefing?: (cb: (data: { content: string }) => void) => () => void;
  /** Fetch RSS/Atom feeds for the Feeds panel. */
  fetchFeeds?: (sources?: string[]) => Promise<{
    success: boolean;
    items: import('./feed-search').FeedItem[];
    failures: Array<{ source: string; reason: string }>;
    error?: string;
  }>;
  /** The named feed sources HomeBot knows about. */
  listFeedSources?: () => Promise<{ sources: Array<{ id: string; description: string }> }>;
  /** The assistant moving the user to another panel, carrying context with them. */
  onNavigate?: (cb: (request: import('./navigation').NavRequest) => void) => () => void;

  // Fetch a web page and extract its text content
  fetchPageContent?: (url: string) => Promise<{ success: boolean; result?: { url: string; content: string; length: number; truncated: boolean }; error?: string }>;
  // Summarize web page content via n8n/Ollama
  summarizeWebContent?: (url: string, content: string) => Promise<{ success: boolean; result?: { summary: string }; error?: string }>;
  // RAG: index a local file path (or web content when content is provided)
  ragIndex?: (filePath: string, content?: string) => Promise<{ success: boolean; result?: { doc_id: string; filename: string; chunks_indexed: number; message: string }; error?: string }>;
  // RAG: list all indexed documents
  ragList?: () => Promise<{ success: boolean; result?: { total_documents: number; total_chunks: number; documents: Array<{ doc_id: string; filename: string; chunk_count: number }> }; error?: string }>;
  // RAG: remove a document from the index by doc_id
  ragClear?: (docId: string) => Promise<{ success: boolean; result?: { removed_chunks: number; message: string }; error?: string }>;
  // Full-text search across all stored conversations
  searchConversations?: (query: string, maxResults?: number) => Promise<{ success: boolean; data: ConversationSearchResult[]; error?: string }>;
  // Auto-generate a short title for a conversation from the first exchange
  generateTitle?: (args: { conversationId: string; userMessage: string; assistantReply: string }) => Promise<{ success: boolean; title?: string; error?: string }>;
  // Push event: fires when main process updates a conversation title
  onTitleUpdated?: (cb: (data: { conversationId: string; title: string }) => void) => () => void;
  // Telemetry event log
  readTelemetryEvents?: () => Promise<{ success: boolean; events?: any[]; error?: string }>;
  // Permission decision audit log (transparency history for the PermissionModal)
  readPermissionAudit?: () => Promise<{ success: boolean; events?: PermissionAuditEntry[]; error?: string }>;
  // Trust panel (Phase 2): read-only health + activity
  getSupervisorStatus?: () => Promise<{ success: boolean; status?: unknown; error?: string }>;
  getCrmActivity?: (limit?: number) => Promise<{ success: boolean; items?: unknown[]; error?: string }>;
  onSupervisorStatus?: (callback: (change: unknown) => void) => () => void;
  getBatchSummaries?: () => Promise<{ success: boolean; summaries?: unknown[]; error?: string }>;
  // Interactive terminal panel
  terminalCreate?: (cwd?: string) => Promise<{ success: boolean; id?: string; cwd?: string; error?: string }>;
  terminalRun?: (id: string, command: string) => Promise<{ success: boolean; error?: string }>;
  terminalKill?: (id: string) => Promise<{ success: boolean; error?: string }>;
  terminalClose?: (id: string) => Promise<{ success: boolean; error?: string }>;
  onTerminalOutput?: (callback: (chunk: TerminalOutputChunk) => void) => () => void;
  onTerminalExit?: (callback: (exit: TerminalExitEvent) => void) => () => void;
  // Workspace (Explorer + editor)
  workspaceRoot?: () => Promise<{ success: boolean; path: string }>;
  workspaceList?: (dirPath: string) => Promise<{ success: boolean; path?: string; entries?: WorkspaceEntry[]; error?: string }>;
  workspaceRead?: (filePath: string) => Promise<{ success: boolean; path?: string; content?: string; language?: string; error?: string }>;
  workspaceSave?: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  onAssistantToolActivity?: (callback: (info: AssistantToolActivity) => void) => () => void;
  getCrmDashboard?: () => Promise<{ success: boolean; summary?: {
    openDealCount: number;
    openPipelineValueCents: number;
    pipelineValueFormatted: string;
    staleDealCount: number;
    tasksDueTodayCount: number;
    tasksOverdueCount: number;
    isEmpty: boolean;
  } | null; error?: string }>;
  onBatchSummary?: (callback: (summary: unknown) => void) => () => void;
  clearPermissionAudit?: () => Promise<{ success: boolean; error?: string }>;
  exportPermissionAudit?: () => Promise<{ success: boolean; path?: string; error?: string }>;
  // Analytics summary (aggregated conversation + event stats)
  getAnalyticsSummary?: () => Promise<{ success: boolean; summary?: any; error?: string }>;
  // Shell file helpers
  showInFolder?: (filePath: string) => void;
  openFile?: (filePath: string) => void;
  openExternalUrl?: (url: string) => Promise<{ success: boolean; error?: string }>;
  // MCP server management
  mcpListServers?: () => Promise<any>;
  mcpGetStatus?: () => Promise<any>;
  mcpAddServer?: (config: any) => Promise<any>;
  mcpRemoveServer?: (name: string) => Promise<any>;
  mcpToggleServer?: (name: string, enabled: boolean) => Promise<any>;

  exportSettings?: () => Promise<{ success: boolean; path?: string; error?: string }>;
  importSettings?: (filePath: string) => Promise<{ success: boolean; restoredAt?: string; error?: string }>;

  parseDocument?: (filePath: string) => Promise<{
    success: boolean;
    text?: string;
    html?: string;
    fileName?: string;
    pageCount?: number;
    type?: string;
    error?: string;
  }>;
  writeDocument?: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;

  // GPU VRAM detection and hardware-aware model recommendations
  detectGpuVram?: () => Promise<{
    success: boolean;
    vramGB?: number | null;
    gpuName?: string | null;
    method?: string;
    recommendation?: {
      mode: 'moa' | 'single';
      preset?: string | null;
      model?: string | null;
      reason: string;
    } | null;
    error?: string;
  }>;

  // Pull an Ollama model by name
  pullModel?: (modelName: string) => Promise<{
    success: boolean;
    model?: string;
    status?: string;
    error?: string;
  }>;

  // Pull an Ollama model with streaming progress events
  pullModelStream?: (modelName: string) => Promise<{
    success: boolean;
    model?: string;
    error?: string;
  }>;

  // Subscribe to model pull progress events (fired during pullModelStream)
  onPullModelProgress?: (cb: (data: {
    model: string;
    status: string;
    percent: number | null;
    completedMB: number | null;
    totalMB: number | null;
  }) => void) => () => void;

  // Check if Ollama is installed on the system (checks PATH and common locations)
  checkOllamaInstalled?: () => Promise<{ installed: boolean; path: string | null }>;

  // Download and silently install Ollama, then start the server
  downloadOllama?: () => Promise<{ success: boolean; error?: string }>;

  // Subscribe to Ollama download/install progress events
  onOllamaDownloadProgress?: (cb: (data: {
    stage: 'downloading' | 'installing' | 'starting' | 'ready';
    percent: number;
    downloadedMB?: number;
    totalMB?: number;
  }) => void) => () => void;

  // Attempt to start Ollama (`ollama serve`) detached. Resolves once the
  // server responds on /api/tags, or with an error if it can't be launched.
  startOllama?: () => Promise<{
    success: boolean;
    alreadyRunning?: boolean;
    error?: string;
  }>;

  // List installed Ollama models
  listOllamaModels?: () => Promise<{
    success: boolean;
    models: Array<{ name: string; size: number; modifiedAt: string; details: any }>;
    error?: string;
  }>;

  // Delete an Ollama model
  deleteOllamaModel?: (modelName: string) => Promise<{
    success: boolean;
    model?: string;
    error?: string;
  }>;

  // Push event: fires when main process determines Ollama reachability on startup
  onOllamaStatus?: (cb: (data: { online: boolean; url: string }) => void) => () => void;
  onModelFallback?: (cb: (data: { from: string; to: string }) => void) => () => void;
  onConversationCompacted?: (cb: (data: { conversationId: string; originalCount: number; compactedCount: number }) => void) => () => void;

  // Export a single conversation to disk as Markdown or JSON
  exportConversation?: (conversationId: string, format?: 'markdown' | 'json' | 'docx' | 'pdf') => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;

  // Quiz mode: generate quiz questions via LLM
  generateQuiz?: (params: QuizRequest) => Promise<QuizResponse>;
  // Quiz mode: generate quiz from RAG-indexed documents (Study Buddy)
  generateQuizFromRag?: (params: { topic: string; difficulty: string; questionCount: number }) => Promise<QuizResponse>;
  // Quiz mode: save progress to disk
  saveQuizProgress?: (progress: QuizProgress) => Promise<{ success: boolean; error?: string }>;
  // Quiz mode: load saved progress
  loadQuizProgress?: () => Promise<{ success: boolean; data?: QuizProgress; error?: string }>;

  // Automation Center
  loadAutomations?: () => Promise<{ automations: SavedAutomation[] }>;
  createAutomation?: (data: { name: string; description: string; instructions: string; trigger: string; scheduleMinutes?: number; n8nWebhookUrl?: string; deployToN8n?: boolean }) => Promise<{ automation: SavedAutomation; error?: string }>;
  updateAutomation?: (data: { id: string; enabled?: boolean; name?: string; description?: string; instructions?: string; trigger?: string; scheduleMinutes?: number; n8nWebhookUrl?: string }) => Promise<{ success: boolean }>;
  /**
   * Removes the automation and the n8n workflow it deployed. Without `force`
   * this refuses when the workflow cannot be deleted, keeping the automation so
   * the workflow is never left running with nothing pointing at it; `warning`
   * reports a workflow that outlived a forced delete.
   */
  deleteAutomation?: (data: { id: string; force?: boolean }) => Promise<{
    success: boolean;
    error?: string;
    warning?: string;
    n8nWorkflowId?: string;
  }>;
  runAutomation?: (data: { id: string }) => Promise<{ success: boolean; result?: string; error?: string }>;
  testN8nConnection?: (data: { baseUrl?: string; apiKey?: string }) => Promise<{ reachable: boolean; authenticated: boolean | null; error?: string }>;
}

// ── Quiz Types ──────────────────────────────────────────────────────────────

export type QuizDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type QuizQuestionType = 'multiple-choice' | 'code-output' | 'bug-fix' | 'fill-blank' | 'concept';

export interface QuizRequest {
  topic: string;
  difficulty: QuizDifficulty;
  questionCount: number;
  questionTypes?: QuizQuestionType[];
  language?: string;
}

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  question: string;
  code?: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface QuizResponse {
  success: boolean;
  questions?: QuizQuestion[];
  error?: string;
}

export interface QuizProgress {
  totalQuizzes: number;
  totalCorrect: number;
  totalAnswered: number;
  topicScores: Record<string, { correct: number; total: number }>;
  streak: number;
  bestStreak: number;
  lastQuizDate?: string;
}

// ── Automation Types ────────────────────────────────────────────────────────

export interface SavedAutomation {
  id: string;
  name: string;
  description: string;
  instructions: string;
  trigger: 'manual' | 'schedule';
  scheduleMinutes?: number;
  n8nWebhookUrl?: string;
  enabled: boolean;
  lastRun?: string;
  lastResult?: string;
  lastStatus?: 'success' | 'error';
  createdAt: string;
}
