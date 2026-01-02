import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Default settings used when no config file exists
const DEFAULT_SETTINGS = {
  n8nUrl: 'http://localhost:5678',
  ollamaUrl: 'http://localhost:11434',
  // Agent/model defaults
  model: 'ollama',
  apiKeys: {},
  theme: 'system',
  alwaysOnTop: true,
  globalHotkey: 'CommandOrControl+Shift+S',
  confirmDangerousActions: true,
  saveConversationHistory: true,
  hideOnBlur: false,
  firstRun: true,
  telemetryEnabled: true,
  telemetryConsentTimestamp: undefined,
  telemetryConsentVersion: undefined,
  permissions: {
    read_file: true,
    list_directory: true,
    create_directory: true,
    get_file_info: true,
    copy_file: true,
    write_file: false,
    delete_file: false,
    move_file: false,
    launch_app: false,
    screenshot: false,
    open_url: true,
    web_search: true,
    nba_query: true,
  },
  defaultTeam: 'GSW'
};

// Safe Electron app import with fallback
let app: any;
try {
  const electron = require('electron');
  app = electron.app;
} catch (e) {
  // In test environment, electron might not be available yet
  app = null;
}

/**
 * Get the path to user settings file
 * Handles both production and test environments safely
 */
export function getSettingsPath(): string {
  try {
    // Priority 1: Test environment override
    if (process.env.SADIE_TEST_CONFIG_DIR) {
      const testPath = path.join(process.env.SADIE_TEST_CONFIG_DIR, 'config', 'user-settings.json');
      console.log('[DIAG] Config path resolved (test env):', testPath);
      
      // Ensure directory exists
      const dir = path.dirname(testPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      return testPath;
    }

    // Priority 2: Production with Electron app
    if (app && typeof app.getPath === 'function') {
      const userDataPath = app.getPath('userData');
      const configPath = path.join(userDataPath, 'config', 'user-settings.json');
      console.log('[DIAG] Config path resolved:', configPath);
      
      // Ensure directory exists
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      return configPath;
    }

    // Priority 3: Fallback for test environment without SADIE_TEST_CONFIG_DIR
    const fallbackDir = path.join(os.tmpdir(), `sadie-test-${process.pid}`);
    const fallbackPath = path.join(fallbackDir, 'config', 'user-settings.json');
    
    console.log('[DIAG] Config path resolved (fallback):', fallbackPath);
    
    if (!fs.existsSync(path.dirname(fallbackPath))) {
      fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
    }
    
    return fallbackPath;
  } catch (error) {
    // Last resort fallback
    const emergencyPath = path.join(os.tmpdir(), 'sadie-emergency', 'user-settings.json');
    console.error('[DIAG] Error in getSettingsPath, using emergency path:', emergencyPath, error);
    
    const dir = path.dirname(emergencyPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    return emergencyPath;
  }
}

/**
 * Check if a permission is allowed
 */
export function assertPermission(permission: string): boolean {
  try {
    const settings = getSettings();
    const permissions = settings.permissions || {};
    const allowed = permissions[permission] === true;
    
    if (!allowed) {
      console.log(`[SADIE] Permission denied: ${permission}`);
    }
    
    return allowed;
  } catch (error) {
    console.error('[SADIE] Permission check failed:', error);
    return false;
  }
}

/**
 * Load user settings, merging with defaults
 */
export function getSettings(): any {
  try {
    const settingsPath = getSettingsPath();
    
    if (!fs.existsSync(settingsPath)) {
      console.log('[DIAG] Settings file does not exist, using defaults:', settingsPath);
      return { ...DEFAULT_SETTINGS };
    }
    
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const loaded = JSON.parse(raw);
    
    // Deep merge with defaults
    const merged = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      permissions: {
        ...DEFAULT_SETTINGS.permissions,
        ...(loaded.permissions || {}),
      },
    };
    
    console.log('[DIAG] Settings loaded from:', settingsPath, 'keys:', Object.keys(merged));
    
    return merged;
  } catch (error) {
    console.error('Failed to load settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save user settings to disk
 */
export function saveSettings(settings: any): void {
  try {
    const settingsPath = getSettingsPath();
    // Ensure telemetry consent timestamp/version if telemetryEnabled is true
    if (settings.telemetryEnabled) {
      if (!settings.telemetryConsentTimestamp) {
        settings.telemetryConsentTimestamp = new Date().toISOString();
      }
      if (!settings.telemetryConsentVersion) {
        settings.telemetryConsentVersion = '1.0';
      }
    }
    console.log(
      '[DIAG] Saving settings to:',
      settingsPath,
      'firstRun:',
      settings.firstRun,
      'telemetryEnabled:',
      settings.telemetryEnabled
    );
    // Ensure directory exists
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('[DIAG] Settings saved successfully to:', settingsPath);
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw error;
  }
}

export function resetSettings(): any {
  const defaultSettings = { ...DEFAULT_SETTINGS };
  saveSettings(defaultSettings);
  return defaultSettings;
}

export function getDefaultSettings(): any {
  return { ...DEFAULT_SETTINGS };
}

export function resetPermissions(): any {
  const current = getSettings();
  const defaults = getDefaultSettings();
  const updated = { ...current, permissions: { ...(defaults.permissions || {}) } };
  saveSettings(updated);
  return updated;
}

export function exportTelemetryConsent(): { success: true; path: string } {
  const settings = getSettings();
  const telemetry = {
    enabled: !!settings.telemetryEnabled,
    consentGivenAt: settings.telemetryConsentTimestamp || null,
    consentVersion: settings.telemetryConsentVersion || null,
  };

  const userData = app && typeof app.getPath === 'function' ? app.getPath('userData') : os.tmpdir();
  const logDir = path.join(userData, 'logs');
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const filename = `telemetry-consent-export-${Date.now()}.json`;
    const fullPath = path.join(logDir, filename);
    fs.writeFileSync(fullPath, JSON.stringify(telemetry, null, 2), 'utf-8');
    return { success: true, path: fullPath };
  } catch (err) {
    console.error('Failed to export telemetry consent:', err);
    throw err;
  }
}

/**
 * Test helper: Clear settings for clean test state
 */
export function clearSettingsForTest(): void {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      fs.unlinkSync(settingsPath);
      console.log('[TEST] Cleared settings:', settingsPath);
    }
  } catch (error) {
    console.warn('[TEST] Failed to clear settings:', error);
  }
}

/**
 * Test helper: Set test config directory
 */
export function setTestConfigDir(dir: string): void {
  process.env.SADIE_TEST_CONFIG_DIR = dir;
  console.log('[TEST] Set config dir:', dir);
}
