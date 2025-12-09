import { ipcMain, BrowserWindow } from 'electron';
import { getMainWindow } from './window-manager';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import {
  MemoryManager,
  StoredConversation,
  ConversationStore,
} from './memory-manager';
import { Message } from '../shared/types';

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

  // ============= Memory / Conversation Handlers =============

  /**
   * Load all conversations (list view)
   */
  ipcMain.handle('sadie:load-conversations', async () => {
    try {
      const store = MemoryManager.loadConversationStore();
      return { success: true, data: store };
    } catch (err: any) {
      console.error('Error loading conversations:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get a single conversation by ID
   */
  ipcMain.handle('sadie:get-conversation', async (_event, conversationId: string) => {
    try {
      const conversation = MemoryManager.getConversation(conversationId);
      return { success: true, data: conversation };
    } catch (err: any) {
      console.error('Error getting conversation:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Create a new conversation
   */
  ipcMain.handle('sadie:create-conversation', async (_event, title?: string) => {
    try {
      const conversation = MemoryManager.createNewConversation(title);
      return { success: true, data: conversation };
    } catch (err: any) {
      console.error('Error creating conversation:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Save/update a conversation
   */
  ipcMain.handle('sadie:save-conversation', async (_event, conversation: StoredConversation) => {
    try {
      const success = MemoryManager.saveConversation(conversation);
      return { success };
    } catch (err: any) {
      console.error('Error saving conversation:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Delete a conversation
   */
  ipcMain.handle('sadie:delete-conversation', async (_event, conversationId: string) => {
    try {
      const success = MemoryManager.deleteConversation(conversationId);
      return { success };
    } catch (err: any) {
      console.error('Error deleting conversation:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Set active conversation
   */
  ipcMain.handle('sadie:set-active-conversation', async (_event, conversationId: string | null) => {
    try {
      const success = MemoryManager.setActiveConversation(conversationId);
      return { success };
    } catch (err: any) {
      console.error('Error setting active conversation:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Add a message to a conversation
   */
  ipcMain.handle('sadie:add-message', async (_event, { conversationId, message }: { conversationId: string; message: Message }) => {
    try {
      const success = MemoryManager.addMessageToConversation(conversationId, message);
      return { success };
    } catch (err: any) {
      console.error('Error adding message:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Update a message in a conversation
   */
  ipcMain.handle('sadie:update-message', async (_event, { conversationId, messageId, updates }: { conversationId: string; messageId: string; updates: Partial<Message> }) => {
    try {
      const success = MemoryManager.updateMessageInConversation(conversationId, messageId, updates);
      return { success };
    } catch (err: any) {
      console.error('Error updating message:', err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Start Windows speech recognition (offline capable)
   * Uses Windows SAPI through PowerShell
   */
  ipcMain.handle('sadie:start-speech-recognition', async () => {
    const { exec } = require('child_process');
    
    return new Promise((resolve) => {
      // PowerShell script to use Windows Speech Recognition
      const psScript = `
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()

# Create a simple grammar that accepts any dictation
$dictation = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($dictation)

# Listen for 10 seconds max
$recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(5)
$recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(3)
$recognizer.EndSilenceTimeout = [TimeSpan]::FromSeconds(1)

try {
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(10))
    if ($result -and $result.Text) {
        Write-Output $result.Text
    } else {
        Write-Output ""
    }
} catch {
    Write-Output ""
} finally {
    $recognizer.Dispose()
}
`;

      exec(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, 
        { timeout: 15000 }, 
        (error: any, stdout: string, stderr: string) => {
          if (error) {
            console.error('Speech recognition error:', error.message);
            resolve({ success: false, error: 'Speech recognition failed', text: '' });
          } else {
            const text = stdout.trim();
            resolve({ success: true, text });
          }
        }
      );
    });
  });

  // Mark registration complete
  g.__sadie_ipc_registered = true;
  if (process.env.NODE_ENV === 'development') {
    console.log('[IPC] Handlers registered');
  }
}
