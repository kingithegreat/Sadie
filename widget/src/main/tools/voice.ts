/**
 * SADIE Voice Tools
 * 
 * Provides text-to-speech and speech recognition capabilities.
 * Uses Web Speech API through the renderer process.
 */

import { ToolDefinition, ToolHandler, ToolResult } from './types';
import { BrowserWindow } from 'electron';

// ============= TOOL DEFINITIONS =============

export const speakDef: ToolDefinition = {
  name: 'speak',
  description: 'Speak text aloud using text-to-speech. Use this to read responses to the user verbally.',
  category: 'voice',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to speak aloud'
      },
      rate: {
        type: 'number',
        description: 'Speech rate (0.5 to 2.0, default: 1.0)',
        default: 1.0
      },
      pitch: {
        type: 'number', 
        description: 'Voice pitch (0.5 to 2.0, default: 1.0)',
        default: 1.0
      },
      volume: {
        type: 'number',
        description: 'Volume (0.0 to 1.0, default: 1.0)',
        default: 1.0
      }
    },
    required: ['text']
  }
};

export const stopSpeakingDef: ToolDefinition = {
  name: 'stop_speaking',
  description: 'Stop any ongoing text-to-speech playback.',
  category: 'voice',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  }
};

export const getVoicesDef: ToolDefinition = {
  name: 'get_voices',
  description: 'Get a list of available text-to-speech voices on the system.',
  category: 'voice',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  }
};

// ============= TOOL HANDLERS =============

// Helper to get main window
function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

export const speakHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const text = args.text;
    if (!text || typeof text !== 'string') {
      return { success: false, error: 'Text is required' };
    }

    const rate = Math.max(0.5, Math.min(2.0, args.rate || 1.0));
    const pitch = Math.max(0.5, Math.min(2.0, args.pitch || 1.1));  // Slightly higher default for warmer tone
    const volume = Math.max(0.0, Math.min(1.0, args.volume || 1.0));

    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return { success: false, error: 'No window available for speech' };
    }

    // Execute TTS in renderer process via Web Speech API
    const result = await mainWindow.webContents.executeJavaScript(`
      (function() {
        return new Promise((resolve) => {
          if (!window.speechSynthesis) {
            resolve({ success: false, error: 'Speech synthesis not supported' });
            return;
          }
          
          // Cancel any ongoing speech
          window.speechSynthesis.cancel();
          
          const utterance = new SpeechSynthesisUtterance(${JSON.stringify(text)});
          utterance.rate = ${rate};
          utterance.pitch = ${pitch};
          utterance.volume = ${volume};
          
          // Chromium loads voices asynchronously — getVoices() often returns []
          // on the first call. Wait for voiceschanged if needed.
          function pickVoice(voices) {
            const femalePrefs = [
              'Microsoft Jenny',    // Win 11 neural — warm, natural female
              'Microsoft Aria',     // Win 11 neural — clear female
              'Microsoft Zira',     // Win 10+ classic female
              'Google UK English Female',
              'Google US English',
              'Samantha',           // macOS default female
              'Karen',              // macOS Australian female
              'Moira',              // macOS Irish female
            ];
            for (const pref of femalePrefs) {
              const match = voices.find(v => v.name.includes(pref));
              if (match) return match;
            }
            // Fallback: any local English voice, then any English, then first available
            return voices.find(v => v.lang.startsWith('en') && v.localService)
              || voices.find(v => v.lang.startsWith('en'))
              || voices[0] || null;
          }

          function speakWith(voices) {
            const chosen = pickVoice(voices);
            if (chosen) utterance.voice = chosen;
            utterance.onend = () => resolve({ success: true, spoken: true, voice: chosen?.name || 'default' });
            utterance.onerror = (e) => resolve({ success: false, error: e.error || 'Speech failed' });
            window.speechSynthesis.speak(utterance);
            setTimeout(() => resolve({ success: true, spoken: true }), 60000);
          }

          let voices = window.speechSynthesis.getVoices();
          if (voices.length > 0) {
            speakWith(voices);
          } else {
            // Voices not loaded yet — wait for the event (fires once in Chromium)
            const onReady = () => {
              window.speechSynthesis.removeEventListener('voiceschanged', onReady);
              speakWith(window.speechSynthesis.getVoices());
            };
            window.speechSynthesis.addEventListener('voiceschanged', onReady);
            // Safety timeout: if voiceschanged never fires, speak with system default
            setTimeout(() => {
              window.speechSynthesis.removeEventListener('voiceschanged', onReady);
              const retry = window.speechSynthesis.getVoices();
              speakWith(retry.length > 0 ? retry : []);
            }, 2000);
          }
        });
      })()
    `);

    if (result.success) {
      return {
        success: true,
        result: {
          message: 'Speaking text',
          textLength: text.length,
          rate,
          pitch,
          volume
        }
      };
    } else {
      return { success: false, error: result.error || 'Speech failed' };
    }
  } catch (err: any) {
    return { success: false, error: `Failed to speak: ${err.message}` };
  }
};

export const stopSpeakingHandler: ToolHandler = async (): Promise<ToolResult> => {
  try {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return { success: false, error: 'No window available' };
    }

    await mainWindow.webContents.executeJavaScript(`
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    `);

    return {
      success: true,
      result: { message: 'Stopped speaking' }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to stop speaking: ${err.message}` };
  }
};

export const getVoicesHandler: ToolHandler = async (): Promise<ToolResult> => {
  try {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return { success: false, error: 'No window available' };
    }

    const voices = await mainWindow.webContents.executeJavaScript(`
      (function() {
        if (!window.speechSynthesis) {
          return [];
        }
        return window.speechSynthesis.getVoices().map(v => ({
          name: v.name,
          lang: v.lang,
          local: v.localService
        }));
      })()
    `);

    return {
      success: true,
      result: {
        count: voices.length,
        voices: voices.slice(0, 20) // Limit to 20 voices
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to get voices: ${err.message}` };
  }
};

// Export all definitions and handlers
export const voiceToolDefs = [
  speakDef,
  stopSpeakingDef,
  getVoicesDef
];

export const voiceToolHandlers: Record<string, ToolHandler> = {
  'speak': speakHandler,
  'stop_speaking': stopSpeakingHandler,
  'get_voices': getVoicesHandler
};
