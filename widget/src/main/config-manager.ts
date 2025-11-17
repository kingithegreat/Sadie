import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

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
}

const DEFAULT_SETTINGS: Settings = {
  n8nUrl: 'http://localhost:5678',
  ollamaUrl: 'http://localhost:11434',
  theme: 'system',
  alwaysOnTop: true,
  globalHotkey: 'Ctrl+Shift+Space',
  confirmDangerousActions: true,
  saveConversationHistory: true,
  hideOnBlur: false
};

function getSettingsPath(): string {
  const userDataPath = app.getPath('userData');
  return join(userDataPath, 'config', 'user-settings.json');
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
      return { ...DEFAULT_SETTINGS };
    }
    
    const data = readFileSync(settingsPath, 'utf-8');
    const savedSettings = JSON.parse(data);
    
    // Merge with defaults to ensure all keys exist
    return { ...DEFAULT_SETTINGS, ...savedSettings };
  } catch (error) {
    console.error('Failed to load settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    ensureConfigDirectory();
    const settingsPath = getSettingsPath();
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
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
