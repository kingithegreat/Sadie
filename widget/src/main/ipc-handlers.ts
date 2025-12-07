import { ipcMain, BrowserWindow } from 'electron';
import { getMainWindow } from './window-manager';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

// Default settings
const DEFAULT_SETTINGS = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space'
};

// Get settings file path
const getSettingsPath = (): string => {
  const configDir = path.join(__dirname, '..', '..', 'config');
  
  // Ensure config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  return path.join(configDir, 'user-settings.json');
};

/**
 * Register all IPC handlers for communication between renderer and main process
 */
export function registerIpcHandlers(mainWindow?: BrowserWindow): void {
    // Idempotency guard: prevent duplicate registrations which Electron disallows.
    // Handlers should be registered before any BrowserWindow exists to satisfy
    // early renderer invokes during startup without races.
    // Note: we store a flag on the global to persist across reloads in dev.
    const g = global as any;
    if (g.__sadie_ipc_registered) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[IPC] registerIpcHandlers already executed — skipping');
      }
      return;
    }
    // Simple health check so renderer can verify main is responsive
    ipcMain.handle('sadie:check-connection', async () => {
      return {
        ok: true,
        timestamp: Date.now()
      };
    });

    ipcMain.on('window-minimize', () => {
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.minimize();
      }
    });

    ipcMain.on('window-close', () => {
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.close();
      }
    });
  
  /**
   * Handle message from renderer → forward to n8n orchestrator
   */
  ipcMain.on('sadie:message', async (_event, { message, conversationId }) => {
    try {
      // Load settings to get n8n URL
      const settingsPath = getSettingsPath();
      let settings = DEFAULT_SETTINGS;
      
      if (fs.existsSync(settingsPath)) {
        const data = fs.readFileSync(settingsPath, 'utf8');
        settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      }

      // Send message to n8n orchestrator
      const response = await axios.post(`${settings.n8nUrl}/webhook/sadie/chat`, {
        user_id: 'desktop-user',
        conversation_id: conversationId || 'default',
        message: message,
        timestamp: new Date().toISOString()
      }, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      // Send response back to renderer
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('sadie:reply', {
        success: true,
        data: response.data
        });
      }

    } catch (err: any) {
      console.error('Error communicating with n8n orchestrator:', err.message);
      
      // Send error response back to renderer
      const win = mainWindow ?? getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('sadie:reply', {
          success: false,
          error: true,
          message: 'Sadie could not reach the orchestrator.',
          details: err.message,
          response: 'I\'m having trouble connecting to my backend. Please make sure n8n is running.'
        });
      }
    }
  });

  /**
   * Get user settings from file
   */
  ipcMain.handle('sadie:get-settings', async () => {
    try {
      const settingsPath = getSettingsPath();
      
      if (fs.existsSync(settingsPath)) {
        const data = fs.readFileSync(settingsPath, 'utf8');
        return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      }
      
      return DEFAULT_SETTINGS;
    } catch (err: any) {
      console.error('Error loading settings:', err.message);
      return DEFAULT_SETTINGS;
    }
  });

  /**
   * Save user settings to file
   */
  ipcMain.handle('sadie:save-settings', async (_event, settings) => {
    try {
      const settingsPath = getSettingsPath();
      
      // Merge with defaults to ensure all keys exist
      const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
      
      fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
      
      return { success: true };
    } catch (err: any) {
      console.error('Error saving settings:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Mark registration complete
  g.__sadie_ipc_registered = true;
  if (process.env.NODE_ENV === 'development') {
    console.log('[IPC] Handlers registered');
  }
}
