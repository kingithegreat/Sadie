/**
 * SADIE Voice Tools
 *
 * Text-to-speech using Microsoft Edge Neural voices (free, no API key).
 * Falls back to Web Speech API if Edge TTS is unavailable.
 */

import { ToolDefinition, ToolHandler, ToolResult } from './types';
import { BrowserWindow } from 'electron';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Preferred voice ──────────────────────────────────────────────────────────
// Microsoft Ava is the newest, most natural US female neural voice (2024+).
// Jenny is the fallback — also excellent and widely available.
const DEFAULT_VOICE = 'en-US-AvaNeural';
const FALLBACK_VOICE = 'en-US-JennyNeural';

// Temp directory for audio files
const TTS_CACHE_DIR = path.join(os.tmpdir(), 'sadie-tts');

// Singleton TTS instance (reused across calls for speed)
let ttsInstance: MsEdgeTTS | null = null;
let currentVoice: string = DEFAULT_VOICE;
let ttsInitPromise: Promise<MsEdgeTTS> | null = null; // guards concurrent init

async function getTTS(voice?: string): Promise<MsEdgeTTS> {
  const targetVoice = voice || DEFAULT_VOICE;
  // Fast path: already initialized with the right voice
  if (ttsInstance && currentVoice === targetVoice) {
    return ttsInstance;
  }
  // Guard: if another call is already initializing, wait for it
  if (ttsInitPromise) {
    const existing = await ttsInitPromise;
    if (currentVoice === targetVoice) return existing;
  }
  // Initialize (only one caller runs this at a time)
  ttsInitPromise = (async () => {
    const inst = new MsEdgeTTS();
    try {
      await inst.setMetadata(targetVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      ttsInstance = inst;
      currentVoice = targetVoice;
    } catch {
      if (targetVoice !== FALLBACK_VOICE) {
        await inst.setMetadata(FALLBACK_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        ttsInstance = inst;
        currentVoice = FALLBACK_VOICE;
      } else {
        throw new Error('No Edge TTS voice available');
      }
    }
    return ttsInstance!;
  })();
  try {
    return await ttsInitPromise;
  } finally {
    ttsInitPromise = null;
  }
}

// Ensure cache dir exists
function ensureCacheDir() {
  if (!fs.existsSync(TTS_CACHE_DIR)) {
    fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
  }
}

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
        description: 'Speech rate (-50 to +100 percent, default: 0)',
        default: 0
      },
      pitch: {
        type: 'number',
        description: 'Voice pitch in Hz adjustment (-50 to +50, default: 0)',
        default: 0
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

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

/**
 * Synthesize speech using Edge TTS neural voices and play via renderer.
 * The flow: main process generates MP3 → saves to temp file → renderer plays via <audio>.
 */
export const speakHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const text = args.text;
    if (!text || typeof text !== 'string') {
      return { success: false, error: 'Text is required' };
    }

    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return { success: false, error: 'No window available for speech' };
    }

    ensureCacheDir();

    // Generate audio with Edge TTS
    const tts = await getTTS();
    const audioFile = path.join(TTS_CACHE_DIR, `sadie-${Date.now()}.mp3`);

    // Build SSML rate/pitch prosody
    const rate = typeof args.rate === 'number' ? args.rate : 0;
    const pitch = typeof args.pitch === 'number' ? args.pitch : 0;
    const volume = Math.max(0, Math.min(1, args.volume ?? 1.0));

    const rateStr = rate >= 0 ? `+${rate}%` : `${rate}%`;
    const pitchStr = pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`;

    await tts.toFile(audioFile, text, {
      rate: rateStr,
      pitch: pitchStr,
      volume: `${Math.round(volume * 100)}%`,
    } as any);

    // Play in renderer via HTML5 Audio
    const fileUrl = `file://${audioFile.replace(/\\/g, '/')}`;
    await mainWindow.webContents.executeJavaScript(`
      (function() {
        // Stop any existing SADIE audio
        if (window.__sadieAudio) {
          window.__sadieAudio.pause();
          window.__sadieAudio = null;
        }
        return new Promise((resolve) => {
          const audio = new Audio(${JSON.stringify(fileUrl)});
          audio.volume = ${volume};
          window.__sadieAudio = audio;
          audio.onended = () => { window.__sadieAudio = null; resolve({ success: true }); };
          audio.onerror = (e) => { window.__sadieAudio = null; resolve({ success: false, error: 'Audio playback failed' }); };
          audio.play().catch(err => resolve({ success: false, error: err.message }));
        });
      })()
    `);

    // Clean up temp file after a delay
    setTimeout(() => { try { fs.unlinkSync(audioFile); } catch {} }, 120000);

    return {
      success: true,
      result: {
        message: 'Speaking text',
        voice: currentVoice,
        textLength: text.length,
      }
    };
  } catch (err: any) {
    // Fallback to Web Speech API if Edge TTS fails
    console.error('[SADIE Voice] Edge TTS failed, falling back to Web Speech API:', err.message);
    return speakFallback(args);
  }
};

/**
 * Fallback: Web Speech API (built into Chromium, less natural voices)
 */
async function speakFallback(args: any): Promise<ToolResult> {
  try {
  const text = args.text;
  const rate = Math.max(0.5, Math.min(2.0, args.rate != null ? 1.0 + args.rate / 100 : 1.0));
  const pitch = Math.max(0.5, Math.min(2.0, args.pitch != null ? 1.0 + args.pitch / 50 : 1.1));
  const volume = Math.max(0.0, Math.min(1.0, args.volume || 1.0));

  const mainWindow = getMainWindow();
  if (!mainWindow) return { success: false, error: 'No window available for speech' };

  const result = await mainWindow.webContents.executeJavaScript(`
    (function() {
      return new Promise((resolve) => {
        if (!window.speechSynthesis) {
          resolve({ success: false, error: 'Speech synthesis not supported' });
          return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(${JSON.stringify(text)});
        utterance.rate = ${rate};
        utterance.pitch = ${pitch};
        utterance.volume = ${volume};

        function pickVoice(voices) {
          const prefs = ['Microsoft Jenny', 'Microsoft Aria', 'Microsoft Zira',
            'Google UK English Female', 'Samantha', 'Karen'];
          for (const p of prefs) {
            const m = voices.find(v => v.name.includes(p));
            if (m) return m;
          }
          return voices.find(v => v.lang.startsWith('en') && v.localService)
            || voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
        }

        function go(voices) {
          const chosen = pickVoice(voices);
          if (chosen) utterance.voice = chosen;
          utterance.onend = () => resolve({ success: true, voice: chosen?.name || 'default' });
          utterance.onerror = (e) => resolve({ success: false, error: e.error || 'Speech failed' });
          window.speechSynthesis.speak(utterance);
          setTimeout(() => resolve({ success: true }), 60000);
        }

        let voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) { go(voices); }
        else {
          const h = () => { window.speechSynthesis.removeEventListener('voiceschanged', h); go(window.speechSynthesis.getVoices()); };
          window.speechSynthesis.addEventListener('voiceschanged', h);
          setTimeout(() => { window.speechSynthesis.removeEventListener('voiceschanged', h); go(window.speechSynthesis.getVoices()); }, 2000);
        }
      });
    })()
  `);

  return result.success
    ? { success: true, result: { message: 'Speaking (fallback voice)', voice: result.voice || 'system default', textLength: text.length } }
    : { success: false, error: result.error || 'Speech failed' };
  } catch (err: any) {
    return { success: false, error: `Speech failed: ${err.message}` };
  }
}

export const stopSpeakingHandler: ToolHandler = async (): Promise<ToolResult> => {
  try {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false, error: 'No window available' };

    await mainWindow.webContents.executeJavaScript(`
      if (window.__sadieAudio) { window.__sadieAudio.pause(); window.__sadieAudio = null; }
      if (window.speechSynthesis) { window.speechSynthesis.cancel(); }
    `);

    return { success: true, result: { message: 'Stopped speaking' } };
  } catch (err: any) {
    return { success: false, error: `Failed to stop speaking: ${err.message}` };
  }
};

export const getVoicesHandler: ToolHandler = async (): Promise<ToolResult> => {
  try {
    const tts = new MsEdgeTTS();
    const voices = await tts.getVoices();
    const english = voices
      .filter((v: any) => v.Locale.startsWith('en-') && v.Gender === 'Female')
      .map((v: any) => ({
        name: v.ShortName,
        friendlyName: v.FriendlyName,
        locale: v.Locale,
      }));

    return {
      success: true,
      result: {
        currentVoice,
        count: english.length,
        voices: english.slice(0, 15)
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
