import { app, safeStorage } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { logTelemetryConsent } from './utils/logger';

// Keys that contain secrets and should be encrypted at rest
const SECRET_KEYS: (keyof Settings)[] = [
  'tavilyApiKey', 'serperApiKey', 'anthropicApiKey', 'openaiApiKey', 'codeApiKey', 'calendarIcsUrl'
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
  ollamaUrl: string;
  // Model selection
  chatModel?: string;
  uncensoredModel?: string;
  visionModel?: string;
  codeModel?: string;
  theme: 'light' | 'dark' | 'system';
  alwaysOnTop: boolean;
  globalHotkey: string;
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

  // Misc / developer defaults
  defaultTeam?: string;
  uncensoredMode?: boolean;
  // Web search API keys
  tavilyApiKey?: string;
  serperApiKey?: string;
  // LLM provider API keys
  anthropicApiKey?: string;
  openaiApiKey?: string;
  // Code model API (optional — routes coding queries to a cloud API instead of Ollama)
  codeApiKey?: string;
  codeApiProvider?: 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'deepseek' | 'google-ai-studio' | 'custom';
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
}

const DEFAULT_SETTINGS: Settings = {
  n8nUrl: 'http://localhost:5678',
  // Prefer IPv4 to avoid ::1 resolution issues on Windows
  ollamaUrl: 'http://127.0.0.1:11434',
  chatModel: 'phi4-mini',               // best reasoning in the 3-4B range
  uncensoredModel: 'dolphin-phi:2.7b',  // 1.6 GB — safe on 4-5 GB VRAM
  visionModel: 'moondream',            // 1.7 GB — replaces llava (4.7 GB)
  codeModel: '',
  theme: 'system',
  alwaysOnTop: true,
  uncensoredMode: false,
  globalHotkey: 'Ctrl+Shift+Space',
  confirmDangerousActions: true,
  saveConversationHistory: true,
  hideOnBlur: false,

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
    parse_document_from_path: true,
    // File system — dangerous: disabled by default
    write_file: false,
    delete_file: false,
    move_file: false,
    // System controls
    launch_app: false,
    screenshot: false,
    open_url: true,
    open_in_browser: true,
    browser_search: true,
    show_notification: true,
    // Read-only network or info operations
    web_search: true,
    nba_query: true,
    get_news: true,
    list_news_feeds: true,
    get_weather: true,
    generate_sports_report: false,
    image_generate: true,
    // Reminders & calendar — read-only safe
    list_reminders: true,
    set_reminder: true,
    list_calendar_events: true,
    add_calendar_event: false,   // modifies state — require confirmation
    // Clipboard — read safe, write requires confirmation
    clipboard_read: true,
    clipboard_write: false,
    // Planning & contacts — read-only safe
    plan_task: true,
    get_plans: true,
    search_contacts: true,
    add_contact: false,          // modifies state — require confirmation
    // Git — read-only operations safe
    git_status: true,
    git_log: true,
    git_diff: true,
    // Process management — read safe, kill dangerous
    list_processes: true,
    kill_process: false,
    // Code execution — dangerous
    run_code: false,
    // Email — all require confirmation
    email_send: false,
    email_draft: false,
    email_list: true,
  },

  // Default NBA team for new users
  defaultTeam: 'GSW'
};

// A convenience function for asserting permissions on a tool
export function assertPermission(toolName: string): boolean {
  const settings = getSettings();
  if (!settings.permissions) return false;
  // If the toolName is not present, default to deny (safe approach)
  if (typeof settings.permissions[toolName] === 'boolean') {
    return !!settings.permissions[toolName];
  }
  // Allow if explicitly present in defaults or read-only type
  // Fallback to false to be conservative
  return false;
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

export function getSettings(): Settings {
  try {
    const settingsPath = getSettingsPath();
    
    if (!existsSync(settingsPath)) {
      if (process.env.NODE_ENV !== 'production') console.log('[DIAG] Settings file does not exist, using defaults:', settingsPath);
      return { ...DEFAULT_SETTINGS };
    }
    
    const data = readFileSync(settingsPath, 'utf-8');
    const savedSettings = JSON.parse(data);
    if (process.env.NODE_ENV !== 'production') console.log('[DIAG] Settings loaded from:', settingsPath, 'keys:', Object.keys(savedSettings));
    
    // Merge with defaults to ensure all keys exist
    const merged = { ...DEFAULT_SETTINGS, ...savedSettings } as Settings;
    const mergedPermissions = {
      ...(DEFAULT_SETTINGS.permissions || {}),
      ...(savedSettings.permissions || {})
    } as Record<string, boolean>;
    merged.permissions = mergedPermissions;
    // If running in assessor demo mode, enforce safe defaults: telemetry off and dangerous permissions disabled
    const demoMode = process.argv?.includes('--demo') || process.env.SADIE_DEMO_MODE === '1' || process.env.SADIE_DEMO_MODE === 'true';
    if (demoMode) {
      merged.telemetryEnabled = false;
      merged.telemetryConsentTimestamp = undefined;
      merged.telemetryConsentVersion = undefined;
      // Force dangerous permissions off
      merged.permissions = {
        ...(merged.permissions || {}),
        delete_file: false,
        move_file: false,
        launch_app: false,
        screenshot: false
      };
    }
    // Decrypt any encrypted secret fields
    for (const key of SECRET_KEYS) {
      const val = (merged as any)[key];
      if (typeof val === 'string' && val.length > 0) {
        (merged as any)[key] = decryptSecret(val);
      }
    }
    return merged;
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
    writeFileSync(settingsPath, JSON.stringify(toSave, null, 2), 'utf-8');
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
    chatModel: 'phi4-mini',              // 2.5 GB — best reasoning that safely fits 4-5 GB
    visionModel: 'moondream',           // 1.7 GB — lightweight vision
    uncensoredModel: 'dolphin-phi:2.7b', // 1.6 GB — safe uncensored
  },
  '8gb': {
    chatModel: 'phi4-mini',              // still best small model; upgrade to 7b if desired
    visionModel: 'moondream',
    uncensoredModel: 'dolphin-phi:2.7b',
  },
  '16gb+': {
    chatModel: 'qwen2.5:7b',
    visionModel: 'llava',
    uncensoredModel: 'dolphin-llama3:8b', // 16 GB+ cards can afford the full 8B model
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
