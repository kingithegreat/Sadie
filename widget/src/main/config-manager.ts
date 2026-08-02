import { app, safeStorage } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { logTelemetryConsent } from './utils/logger';

// Keys that contain secrets and should be encrypted at rest
const SECRET_KEYS: (keyof Settings)[] = [
  'tavilyApiKey', 'serperApiKey', 'anthropicApiKey', 'openaiApiKey', 'geminiApiKey', 'codeApiKey', 'stableHordeApiKey', 'calendarIcsUrl', 'n8nApiKey'
];

/**
 * Encrypt a plaintext string via the OS keychain (DPAPI on Windows, Keychain on macOS).
 * Returns a base64-encoded ciphertext, or the original string if safeStorage is unavailable.
 */
function encryptSecret(value: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(value).toString('base64');
    }
  } catch { /* safeStorage may not be ready yet during app startup */ }
  return value;
}

/**
 * Decrypt a base64-encoded ciphertext via the OS keychain.
 * Falls back to returning the raw value for un-encrypted legacy settings.
 */
function decryptSecret(value: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(value, 'base64');
      return safeStorage.decryptString(buf);
    }
  } catch {
    // Value was stored as plaintext (legacy) — return as-is
  }
  return value;
}

interface WindowPosition {
  x: number;
  y: number;
}

export interface Settings {
  n8nUrl: string;
  // n8n public API key (Settings → n8n) — unlocks authenticated REST
  // workflow management instead of the docker-exec fallback
  n8nApiKey?: string;
  ollamaUrl: string;
  // Model selection
  modelRoutingMode?: 'off' | 'prompt' | 'auto';
  chatModel?: string;
  uncensoredModel?: string;
  visionModel?: string;
  codeModel?: string;
  theme: 'light' | 'dark' | 'system';
  alwaysOnTop: boolean;
  globalHotkey: string;
  widgetHotkey?: string;
  confirmDangerousActions: boolean;
  saveConversationHistory: boolean;
  hideOnBlur: boolean;
  windowPosition?: WindowPosition;

  // First-run and telemetry
  firstRun?: boolean;
  telemetryEnabled?: boolean;
  telemetryConsentTimestamp?: string;
  telemetryConsentVersion?: string;

  // Permissions for tools (granular by tool name)
  permissions?: Record<string, boolean>;
  // How long (ms) a permission prompt waits before auto-declining. Clamped to
  // [5s, 10min] at read time; defaults to 60s.
  permissionPromptTimeoutMs?: number;

  // Misc / developer defaults
  defaultTeam?: string;
  uncensoredMode?: boolean;
  // Web search API keys
  tavilyApiKey?: string;
  serperApiKey?: string;
  // LLM provider API keys
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  // Code model API (optional — routes coding queries to a cloud API instead of Ollama)
  codeApiKey?: string;
  codeApiProvider?: 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'deepseek' | 'google-ai-studio' | 'google-gemini' | 'huggingface' | 'cerebras' | 'sambanova' | 'together' | 'custom';
  codeApiUrl?: string;
  // Hardware profile — drives model defaults and VRAM recommendations
  hardwareProfile?: '4gb' | '8gb' | '16gb+';
  // Custom chat guidelines appended to system prompt
  chatGuidelines?: string;
  // Google Calendar private ICS URL (Settings → Secret address in iCal format)
  calendarIcsUrl?: string;
  // Mixture-of-Agents settings
  moaEnabled?: boolean;
  moaProposers?: string[];
  moaAggregator?: string;
  // Notification settings
  notificationsEnabled?: boolean;
  notificationSound?: boolean;
  notificationDuration?: number;
  // Morning briefing (weather + calendar + reminders on first message of the day)
  morningBriefing?: boolean;
  // UI settings
  messageDensity?: string;
  stableHordeApiKey?: string;
  useCustomLLM?: boolean;
  customLLM?: import('../shared/types').CustomLLMConfig;
  // Active project/workspace directory for dev tools (terminal, grep, tree)
  projectPath?: string;
  // Default location for weather queries when user doesn't specify one
  defaultLocation?: string;
  // Voice input (speech-to-text)
  // 'whisper' = local Whisper model (accurate, any accent, default)
  // 'sapi' = legacy Windows dictation; 'webspeech' = Chromium online service
  voiceEngine?: 'whisper' | 'sapi' | 'webspeech';
  whisperModel?: 'tiny' | 'base' | 'small';
  voiceLanguage?: string;
  voiceSilenceStopSec?: number;
  voiceMicDeviceId?: string;
  // Reflection validation: after a tool batch runs, ask the model to verify
  // the result actually answers the request before surfacing it. Off by
  // default — additive safety layer, opt-in while it proves itself out.
  reflectionValidationEnabled?: boolean;
}

// Exported for the permission-copy drift gate (permission-copy-registry.test.ts):
// every default permission name must have human copy in src/trust/permission-copy.ts.
export const DEFAULT_SETTINGS: Settings = {
  n8nUrl: 'http://localhost:5678',
  voiceEngine: 'whisper',
  whisperModel: 'base',
  voiceLanguage: 'en',
  voiceSilenceStopSec: 2,
  // Prefer IPv4 to avoid ::1 resolution issues on Windows
  ollamaUrl: 'http://127.0.0.1:11434',
  modelRoutingMode: 'prompt',
  reflectionValidationEnabled: false,
  chatModel: 'qwen2.5:7b',               // best IQ + tool-calling at 7B
  uncensoredModel: 'dolphin:7b',
  visionModel: 'moondream',            // 1.7 GB — replaces llava (4.7 GB)
  codeModel: '',
  theme: 'system',
  alwaysOnTop: true,
  uncensoredMode: true,
  globalHotkey: 'Ctrl+Shift+Space',
  confirmDangerousActions: true,
  saveConversationHistory: true,
  hideOnBlur: false,
  permissionPromptTimeoutMs: 60000,

  // onboarding defaults
  firstRun: true,
  telemetryEnabled: true, // REQUIRED: telemetry is anonymous and always enabled

  // sensible safe defaults: most dangerous tools are disabled until user enables
  permissions: {
    // File system — read-only safe by default
    read_file: true,
    list_directory: true,
    create_directory: true,
    get_file_info: true,
    copy_file: true,
    search_files: true,
    find_files: true,
    parse_document_from_path: true,
    // File system — dangerous: disabled by default
    write_file: false,
    edit_file: false,
    delete_file: false,
    move_file: false,
    create_docx: false,
    create_spreadsheet: false,
    create_pdf: false,
    // System — read-only safe
    get_system_info: true,
    get_current_time: true,
    calculate: true,
    open_url: true,
    open_in_browser: true,
    browser_search: true,
    show_notification: true,
    // System — dangerous
    launch_app: false,
    screenshot: false,
    // Read-only network or info operations
    web_search: true,
    fetch_url: true,
    fetch_page_content: true,
    nba_query: true,
    get_news: true,
    list_news_feeds: true,
    get_weather: true,
    image_generate: true,
    // Documents — read-only safe
    parse_document: true,
    get_document_content: true,
    list_documents: true,
    search_document: true,
    // Vision — read-only safe
    vision_describe: true,
    vision_query: true,
    // Voice — safe
    speak: true,
    stop_speaking: true,
    get_voices: true,
    // Memory — read safe, clear dangerous
    remember: true,
    recall: true,
    list_memories: true,
    forget: false,
    save_conversation: true,
    get_conversation_history: true,
    clear_conversation_history: false,
    // RAG — read safe, clear dangerous
    rag_query: true,
    rag_list: true,
    rag_index: false,
    rag_clear: false,
    // Diff — pure computation, safe
    diff_text: true,
    diff_files: true,
    // Automations — create/list/run/update safe (user-authored instructions), delete opt-in
    create_automation: true,
    list_automations: true,
    run_automation: true,
    update_automation: true,
    delete_automation: false,
    // Reminders & calendar — read-only safe
    list_reminders: true,
    set_reminder: true,
    cancel_reminder: false,
    list_calendar_events: true,
    add_calendar_event: false,
    delete_calendar_event: false,
    // Clipboard — read safe, write requires confirmation
    clipboard_read: true,
    clipboard_write: false,
    get_clipboard: true,
    set_clipboard: false,
    // Planning & contacts — read-only safe
    plan_task: true,
    get_plans: true,
    search_contacts: true,
    add_contact: false,
    // Git — read-only operations safe
    git_status: true,
    git_log: true,
    git_diff: true,
    git_branches: true,
    git_commit: false,
    // Process management — read safe, kill dangerous
    list_processes: true,
    get_process_info: true,
    kill_process: false,
    // Code execution — dangerous
    run_code: false,
    // Terminal — confirmation dialog gates every command; permission allows reaching that dialog
    run_terminal_command: true,
    get_terminal_history: true,
    // Codebase — all read-only, safe
    grep_code: true,
    project_tree: true,
    analyze_file: true,
    // Email — send/draft require confirmation
    email_send: false,
    email_draft: false,
    email_list: true,
    // API — network calls, dangerous
    api_request: false,
    // Video download: served via the ytdlp MCP server (see mcp-client.ts
    // default servers), not a native tool — mcp_ytdlp_* below.
    mcp_ytdlp_get_video_info: true,
    mcp_ytdlp_download_video: false,
  },

  // Default NBA team for new users
  defaultTeam: 'GSW'
};

// A convenience function for asserting permissions on a tool.
// `defaultValue` is only used when the tool has no explicit entry in
// settings.permissions — today that's exclusively dynamically-discovered
// MCP tools (native tools always have an explicit entry in DEFAULT_SETTINGS
// above). Callers should derive it from the tool's own definition, e.g.
// `!tool.definition.requiresConfirmation`, so a server-annotated read-only
// tool works out of the box while anything else still defaults to denied.
export function assertPermission(toolName: string, defaultValue: boolean = false): boolean {
  const settings = getSettings();
  if (!settings.permissions) return defaultValue;
  // If the toolName is not present, default to deny (safe approach)
  if (typeof settings.permissions[toolName] === 'boolean') {
    return !!settings.permissions[toolName];
  }
  // Allow if explicitly present in defaults or read-only type
  // Fallback to the caller-supplied default (false unless the caller knows
  // the tool is safe, e.g. a read-only MCP tool with no confirmation gate).
  return defaultValue;
}

export function getSettingsPath(): string {
  const userDataPath = app.getPath('userData');
  const path = join(userDataPath, 'config', 'user-settings.json');
  if (process.env.NODE_ENV !== 'production') console.log('[DIAG] Config path resolved:', path);
  return path;
}

function ensureConfigDirectory(): void {
  const settingsPath = getSettingsPath();
  const configDir = join(settingsPath, '..');
  
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

// In-memory settings cache — avoids ~20 disk reads per message
let _settingsCache: Settings | null = null;
let _settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 5000; // 5s safety net

export function invalidateSettingsCache(): void {
  _settingsCache = null;
}

/** Describes a one-time "settings file was corrupt and got reset" event. */
export interface ConfigRecoveryEvent {
  reason: string;
  backupPath: string | null;
  timestamp: string;
}

// Set when getSettings() finds an existing-but-unreadable settings file.
// Consumed exactly once via getAndClearConfigRecovery() so index.ts can
// notify the renderer a single time per occurrence (mirrors the one-shot
// hardware-profile-applied notice below).
let _lastConfigRecovery: ConfigRecoveryEvent | null = null;

/**
 * Returns the most recent config-recovery event (if any) and clears it.
 * Call this once at startup, after the first getSettings() call, to decide
 * whether to show the user a "settings were reset" notice.
 */
export function getAndClearConfigRecovery(): ConfigRecoveryEvent | null {
  const event = _lastConfigRecovery;
  _lastConfigRecovery = null;
  return event;
}

/**
 * Copies a corrupt settings file to a timestamped `<path>.corrupt-<ts>.json`
 * sibling before we overwrite the user's config with defaults, so the
 * original bytes aren't lost if they're partially recoverable by hand.
 * Never throws — a failed backup must not block the app from starting.
 */
function backupCorruptSettings(settingsPath: string): string | null {
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const backupPath = `${settingsPath}.corrupt-${Date.now()}.json`;
    writeFileSync(backupPath, raw, 'utf-8');
    return backupPath;
  } catch {
    return null;
  }
}

export function getSettings(): Settings {
  const now = Date.now();
  if (_settingsCache && (now - _settingsCacheTime) < SETTINGS_CACHE_TTL) {
    return { ..._settingsCache };
  }

  const settingsPath = getSettingsPath();

  if (!existsSync(settingsPath)) {
    _settingsCache = { ...DEFAULT_SETTINGS };
    _settingsCacheTime = now;
    return { ..._settingsCache };
  }

  // Read + parse are isolated from the merge/decrypt logic below so a
  // corrupt/invalid file (bad JSON, wrong shape) is clearly distinguished
  // from "no file yet" and gets its own recovery path (backup + one-time
  // notice) instead of silently vanishing into DEFAULT_SETTINGS.
  let savedSettings: any;
  try {
    const data = readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings.json did not contain a JSON object');
    }
    savedSettings = parsed;
  } catch (parseError: any) {
    const backupPath = backupCorruptSettings(settingsPath);
    _lastConfigRecovery = {
      reason: `Settings file was invalid (${parseError?.message || parseError}) and has been reset to defaults.`,
      backupPath,
      timestamp: new Date().toISOString(),
    };
    console.error('Failed to load settings, resetting to defaults:', parseError);
    _settingsCache = { ...DEFAULT_SETTINGS };
    _settingsCacheTime = now;
    return { ..._settingsCache };
  }

  try {
    const merged = { ...DEFAULT_SETTINGS, ...savedSettings } as Settings;
    const mergedPermissions = {
      ...(DEFAULT_SETTINGS.permissions || {}),
      ...(savedSettings.permissions || {})
    } as Record<string, boolean>;
    merged.permissions = mergedPermissions;
    const demoMode = process.argv?.includes('--demo') || process.env.HOMEBOT_DEMO_MODE === '1' || process.env.HOMEBOT_DEMO_MODE === 'true';
    if (demoMode) {
      merged.telemetryEnabled = false;
      merged.telemetryConsentTimestamp = undefined;
      merged.telemetryConsentVersion = undefined;
      merged.permissions = {
        ...(merged.permissions || {}),
        delete_file: false,
        move_file: false,
        launch_app: false,
        screenshot: false
      };
    }
    for (const key of SECRET_KEYS) {
      const val = (merged as any)[key];
      if (typeof val === 'string' && val.length > 0) {
        (merged as any)[key] = decryptSecret(val);
      }
    }
    // Decrypt nested customLLM.apiKey
    if (merged.customLLM && typeof (merged.customLLM as any).apiKey === 'string' && (merged.customLLM as any).apiKey.length > 0) {
      (merged.customLLM as any).apiKey = decryptSecret((merged.customLLM as any).apiKey);
    }
    // Ensure uncensored model is always dolphin:7b
    if (merged.uncensoredModel && merged.uncensoredModel !== 'dolphin:7b') {
      merged.uncensoredModel = 'dolphin:7b';
    }
    _settingsCache = merged;
    _settingsCacheTime = now;
    return { ...merged };
  } catch (error) {
    console.error('Failed to load settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    ensureConfigDirectory();
    const settingsPath = getSettingsPath();
    if (process.env.NODE_ENV !== 'production') console.log('[DIAG] Saving settings to:', settingsPath, 'firstRun:', settings.firstRun, 'telemetryEnabled:', settings.telemetryEnabled);
    // Compare with previous to log telemetry consent events
    const previous = getSettings();
    const toSave = { ...settings } as Settings & { telemetryConsentTimestamp?: string; telemetryConsentVersion?: string };
    if (toSave.telemetryEnabled && !toSave.telemetryConsentTimestamp) {
      toSave.telemetryConsentTimestamp = new Date().toISOString();
    }
    // Default consent version to 1.0 when consent is given
    if (toSave.telemetryEnabled && !toSave.telemetryConsentVersion) {
      toSave.telemetryConsentVersion = '1.0';
    }
    // Encrypt secret fields before writing to disk
    for (const key of SECRET_KEYS) {
      const val = (toSave as any)[key];
      if (typeof val === 'string' && val.length > 0) {
        (toSave as any)[key] = encryptSecret(val);
      }
    }
    // Encrypt nested customLLM.apiKey (guard against bloated re-encryption)
    if (toSave.customLLM && typeof (toSave.customLLM as any).apiKey === 'string' && (toSave.customLLM as any).apiKey.length > 0) {
      const rawKey = (toSave.customLLM as any).apiKey as string;
      if (rawKey.length > 10_000) {
        console.error('[CONFIG] customLLM.apiKey suspiciously large (%d chars) — clearing to prevent bloat', rawKey.length);
        (toSave.customLLM as any).apiKey = '';
      } else {
        (toSave.customLLM as any).apiKey = encryptSecret(rawKey);
      }
    }
    writeFileSync(settingsPath, JSON.stringify(toSave, null, 2), 'utf-8');
    invalidateSettingsCache();
    if (process.env.NODE_ENV !== 'production') console.log('[DIAG] Settings saved successfully to:', settingsPath);
    // Log consent changes
    try {
      if (!previous.telemetryEnabled && toSave.telemetryEnabled) {
        logTelemetryConsent('consent_given', { version: toSave.telemetryConsentVersion, timestamp: toSave.telemetryConsentTimestamp });
      } else if (previous.telemetryEnabled && !toSave.telemetryEnabled) {
        logTelemetryConsent('consent_revoked', { version: previous.telemetryConsentVersion, timestamp: new Date().toISOString() });
      }
    } catch (e) {
      console.error('Failed to record telemetry consent change:', e);
    }
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw error;
  }
}

export function resetSettings(): Settings {
  const defaultSettings = { ...DEFAULT_SETTINGS };
  saveSettings(defaultSettings);
  return defaultSettings;
}

export function getDefaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS };
}

/**
 * Model defaults for each hardware profile.
 * Applied automatically on first run (VRAM auto-detected) and when the user
 * explicitly changes the profile in Settings.
 */
export const HARDWARE_PROFILE_DEFAULTS: Record<string, Partial<Settings>> = {
  '4gb': {
    chatModel: 'qwen2.5:7b',
    visionModel: 'moondream',
    uncensoredModel: 'dolphin:7b',
  },
  '8gb': {
    chatModel: 'qwen2.5:7b',
    visionModel: 'moondream',
    uncensoredModel: 'dolphin:7b',
  },
  '16gb+': {
    chatModel: 'gemma4:e4b',
    visionModel: 'moondream',
    uncensoredModel: 'dolphin:7b',
  },
};

/**
 * Merge hardware-profile model defaults into the given settings object.
 * Only overwrites model fields — all other user preferences are preserved.
 */
export function applyHardwareProfile(settings: Settings): Settings {
  const profile = settings.hardwareProfile;
  if (!profile || !HARDWARE_PROFILE_DEFAULTS[profile]) return settings;
  return { ...settings, ...HARDWARE_PROFILE_DEFAULTS[profile] };
}

export function resetPermissions(): Settings {
  const current = getSettings();
  const defaults = getDefaultSettings();
  const updated = { ...current, permissions: { ...(defaults.permissions || {} ) } } as Settings;
  saveSettings(updated);
  return updated;
}

export function exportTelemetryConsent(): { success: true; path: string } {
  const settings = getSettings();
  const telemetry = {
    enabled: !!settings.telemetryEnabled,
    consentGivenAt: settings.telemetryConsentTimestamp || null,
    consentVersion: settings.telemetryConsentVersion || null
  };

  const userData = app.getPath('userData');
  const logDir = join(userData, 'logs');
  try {
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const filename = `telemetry-consent-export-${Date.now()}.json`;
    const fullPath = join(logDir, filename);
    writeFileSync(fullPath, JSON.stringify(telemetry, null, 2), 'utf-8');
    return { success: true, path: fullPath };
  } catch (err) {
    console.error('Failed to export telemetry consent:', err);
    throw err;
  }
}
