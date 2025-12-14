import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { logTelemetryConsent } from './utils/logger';
import { isReleaseBuild } from './env';

interface WindowPosition {
  x: number;
  y: number;
}

export interface Settings {
  n8nUrl: string;
  ollamaUrl: string;
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
}

const DEFAULT_SETTINGS: Settings = {
  n8nUrl: 'http://localhost:5678',
  ollamaUrl: 'http://localhost:11434',
  theme: 'system',
  alwaysOnTop: true,
  globalHotkey: 'Ctrl+Shift+Space',
  confirmDangerousActions: true,
  saveConversationHistory: true,
  hideOnBlur: false,

  // onboarding defaults
  firstRun: true,
  telemetryEnabled: true, // REQUIRED: telemetry is anonymous and always enabled

  // sensible safe defaults: most dangerous tools are disabled until user enables
  permissions: {
    // File system
    read_file: true,
    list_directory: true,
    create_directory: true,
    get_file_info: true,
    copy_file: true,
    // Dangerous: disabled by default
    write_file: false,
    delete_file: false,
    move_file: false,
    // System controls
    launch_app: false,
    screenshot: false,
    open_url: true,
    // Allow read-only network or info operations
    web_search: true,
    nba_query: true,
    generate_sports_report: false
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

function getSettingsPath(): string {
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
    // If permissions are missing, ensure default
    if (!merged.permissions) {
      merged.permissions = DEFAULT_SETTINGS.permissions;
    }
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
