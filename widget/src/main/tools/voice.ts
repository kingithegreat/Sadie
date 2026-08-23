/**
 * HomeBot Voice Tools
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
import { logTelemetryEvent } from '../utils/logger';

// ── Preferred voice ──────────────────────────────────────────────────────────
// Microsoft Ava is the newest, most natural US female neural voice (2024+).
// Jenny is the fallback — also excellent and widely available.
const DEFAULT_VOICE = 'en-US-AvaNeural';
const FALLBACK_VOICE = 'en-US-JennyNeural';

// Temp directory for audio files
const TTS_CACHE_DIR = path.join(os.tmpdir(), 'homebot-tts');

// Singleton TTS instance (reused across calls for speed)
let ttsInstance: MsEdgeTTS | null = null;
let currentVoice: string = DEFAULT_VOICE;
let ttsInitPromise: Promise<MsEdgeTTS> | null = null; // guards concurrent init

/**
 * Throw away the cached instance so the next call builds a fresh connection.
 *
 * Exported for the test that proves a dead socket does not poison every
 * subsequent narration.
 */
export function resetTTS(): void {
  ttsInstance = null;
  ttsInitPromise = null;
}

/**
 * Does this error mean the connection died, rather than the request being bad?
 *
 * Only a closed/failed stream is worth reconnecting for. Retrying a rejected
 * SSML or an unknown voice would just fail twice as slowly.
 */
export function isRecoverableStreamError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    msg.includes('turn.end') ||
    msg.includes('stream closed') ||
    msg.includes('websocket') ||
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('epipe') ||
    msg.includes('not connected') ||
    msg.includes('closed before')
  );
}

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
      console.log(`[HomeBot Voice] Edge TTS initialized with ${targetVoice}`);
      try { logTelemetryEvent('tts_voice_init', { voice: targetVoice, outcome: 'success' }); } catch (_e) {}
    } catch (err: any) {
      console.warn(`[HomeBot Voice] Edge TTS voice ${targetVoice} failed:`, err?.message || err);
      try { logTelemetryEvent('tts_voice_init', { voice: targetVoice, outcome: 'failed', error: err?.message || String(err) }); } catch (_e) {}
      if (targetVoice !== FALLBACK_VOICE) {
        await inst.setMetadata(FALLBACK_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        ttsInstance = inst;
        currentVoice = FALLBACK_VOICE;
        console.log(`[HomeBot Voice] Edge TTS fell back to ${FALLBACK_VOICE}`);
        try { logTelemetryEvent('tts_voice_init', { voice: FALLBACK_VOICE, outcome: 'fallback_success' }); } catch (_e) {}
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

/**
 * Render narration to a file without playing it.
 *
 * speakHandler needs a BrowserWindow because its job is to play audio through
 * the renderer. The Media Studio needs the opposite: an audio file it can
 * attach to a video, produced with no window, no playback, and no user
 * present. Same Edge TTS engine, so narration matches the voice HomeBot
 * already speaks with.
 *
 * Kept here rather than in the media code so there is one TTS integration
 * rather than two drifting copies of the voice, rate and cache handling.
 */
export async function renderNarrationToFile(
  text: string,
  outPath: string,
  opts?: { voice?: string; rate?: number; pitch?: number },
): Promise<{ path: string; bytes: number }> {
  const clean = (text || '').trim();
  if (!clean) throw new Error('Nothing to narrate — the script is empty.');

  const tts = await getTTS(opts?.voice);
  const rate = opts?.rate ?? 0;
  const pitch = opts?.pitch ?? 0;

  // msedge-tts 2.x takes a DIRECTORY and writes audio.mp3 inside it, returning
  // { audioFilePath }. 1.x took a file path. Passing a file path to 2.x makes
  // it try to open "<yourfile.mp3>/audio.mp3" and fail with ENOENT.
  const dir = outPath.toLowerCase().endsWith('.mp3') ? path.dirname(outPath) : outPath;
  // Sync fs, matching ensureCacheDir above. fs.promises is a separate object
  // that this module's existing test mock does not provide, and reaching for
  // it made every speak call fall through to the Web Speech fallback.
  fs.mkdirSync(dir, { recursive: true });

  const prosody = {
    rate: rate >= 0 ? `+${rate}%` : `${rate}%`,
    pitch: pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`,
    volume: '100%',
  } as any;

  // Enough to diagnose a recurrence without another round of guessing.
  //
  // This failure was reported from a real run and could NOT be reproduced from
  // outside the app: long text, a reused instance after idle, and two
  // concurrent syntheses on one socket all succeeded against the live service.
  // So the next occurrence has to carry its own evidence — the app runs in
  // Electron's network stack, not plain Node, and that is the difference this
  // log is here to expose.
  const started = Date.now();
  const context = () =>
    `voice=${currentVoice} chars=${clean.length} elapsed=${Date.now() - started}ms`;

  let res: any;
  try {
    res = await tts.toFile(dir, clean, prosody);
  } catch (err: any) {
    console.warn(`[HomeBot Voice] synthesis failed — ${context()} — ${err?.message || err}`);
    // The cached MsEdgeTTS holds a WebSocket to Microsoft's service, and that
    // socket is closed from the other end after a period of inactivity. The
    // instance survives, `getTTS`'s fast path keeps returning it, and every
    // synthesis from then on fails the same way:
    //
    //   "Stream closed before the synthesis completed (no turn.end received)"
    //
    // Reported live as narration failing and then continuing to fail — which
    // is the tell. A transient network problem does not repeat forever; a dead
    // cached socket does, until the app restarts.
    if (!isRecoverableStreamError(err)) throw err;

    console.warn('[HomeBot Voice] TTS stream was closed; reconnecting and retrying once.');
    resetTTS();
    const fresh = await getTTS(opts?.voice);
    try {
      res = await fresh.toFile(dir, clean, prosody);
      console.log(`[HomeBot Voice] retry succeeded — ${context()}`);
    } catch (retryErr: any) {
      // Both attempts failed. Say which, so a report distinguishes "the
      // connection was stale" from "this text or voice cannot be synthesised".
      console.error(`[HomeBot Voice] retry ALSO failed — ${context()} — ${retryErr?.message || retryErr}`);
      throw new Error(
        `Text-to-speech failed twice, on a fresh connection the second time. ` +
        `That points at the service or the network rather than a stale connection. ` +
        `(${context()}) Original error: ${retryErr?.message || retryErr}`
      );
    }
  }

  // Trust the returned path when given, but still stat it: a path to an empty
  // file would otherwise be reported as a successful narration.
  const candidates = [res?.audioFilePath, path.join(dir, 'audio.mp3'), outPath]
    .filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.size > 0) return { path: c, bytes: st.size };
    } catch { /* try the next candidate */ }
  }
  throw new Error('Text-to-speech produced no audio file.');
}

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

    // Build SSML rate/pitch prosody
    const rate = typeof args.rate === 'number' ? args.rate : 0;
    const pitch = typeof args.pitch === 'number' ? args.pitch : 0;
    const volume = Math.max(0, Math.min(1, args.volume ?? 1.0));

    // msedge-tts 2.x writes audio.mp3 into a DIRECTORY and returns its path;
    // 1.x took a file path. Reuse the shared helper so speaking and narrating
    // cannot drift apart on this again.
    const rendered = await renderNarrationToFile(
      text,
      path.join(TTS_CACHE_DIR, `homebot-${Date.now()}`),
      { voice: args.voice ? String(args.voice) : undefined, rate, pitch },
    );
    const audioFileOut = rendered.path;

    // Play in renderer via HTML5 Audio
    // Windows paths need file:///C:/... (three slashes)
    const normalized = audioFileOut.replace(/\\/g, '/');
    const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
    await mainWindow.webContents.executeJavaScript(`
      (function() {
        // Stop any existing HomeBot audio
        if (window.__homebotAudio) {
          window.__homebotAudio.pause();
          window.__homebotAudio = null;
        }
        return new Promise((resolve) => {
          const audio = new Audio(${JSON.stringify(fileUrl)});
          audio.volume = ${volume};
          window.__homebotAudio = audio;
          audio.onended = () => { window.__homebotAudio = null; resolve({ success: true }); };
          audio.onerror = (e) => { window.__homebotAudio = null; resolve({ success: false, error: 'Audio playback failed' }); };
          audio.play().catch(err => resolve({ success: false, error: err.message }));
        });
      })()
    `);

    // Clean up temp file after a delay. 2.x writes into a per-call directory,
    // so remove the directory rather than leaving an empty one behind on every
    // spoken reply.
    setTimeout(() => {
      try { fs.unlinkSync(audioFileOut); } catch {}
      try { fs.rmdirSync(path.dirname(audioFileOut)); } catch {}
    }, 120000);

    return {
      success: true,
      result: {
        message: 'Speaking text',
        voice: currentVoice,
        engine: 'edge-neural',
        usedFallback: currentVoice === FALLBACK_VOICE,
        textLength: text.length,
      }
    };
  } catch (err: any) {
    // Fallback to Web Speech API if Edge TTS fails
    console.error('[HomeBot Voice] Edge TTS failed, falling back to Web Speech API:', err.message);
    try { logTelemetryEvent('tts_fallback', { from: 'edge', to: 'web_speech', error: err?.message || String(err) }); } catch (_e) {}
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
            'Microsoft Eva', 'Microsoft Hazel', 'Microsoft Heera',
            'Google UK English Female', 'Samantha', 'Karen', 'Victoria'];
          for (const p of prefs) {
            const m = voices.find(v => v.name.includes(p));
            if (m) return m;
          }
          // Explicitly filter out known male voice names as last resort
          const maleNames = /\b(David|Mark|George|James|Guy|Ryan|Daniel|Alex|Fred|Thomas|William|Brian|Bruce|Tom)\b/i;
          const femaleHint = /\b(female|woman|girl|Jenny|Aria|Zira|Eva|Hazel|Heera|Samantha|Karen|Victoria|Susan|Amy|Emma|Lisa|Sarah)\b/i;
          const enVoices = voices.filter(v => v.lang.startsWith('en'));
          return enVoices.find(v => femaleHint.test(v.name))
            || enVoices.find(v => !maleNames.test(v.name) && v.localService)
            || enVoices.find(v => !maleNames.test(v.name))
            || enVoices[0] || voices[0] || null;
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
    ? { success: true, result: { message: 'Speaking (Web Speech fallback)', voice: result.voice || 'system default', engine: 'web-speech', usedFallback: true, textLength: text.length } }
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
      if (window.__homebotAudio) { window.__homebotAudio.pause(); window.__homebotAudio = null; }
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
