/**
 * HomeBot voice input engines.
 *
 * The default engine is local Whisper — far more accurate than the legacy Windows
 * SAPI dictation path, works with any accent, and needs no per-user training.
 * This file records and resamples; the model runs in the main process
 * (main/speech/whisper-transcriber.ts), downloads once while Online is on,
 * and is cached in HomeBot's data folder.
 *
 * SAPI and the Web Speech API remain available as selectable fallbacks in
 * Settings → Voice.
 */

// ── Engine selection (pure — unit tested) ──────────────────────────────────

export type VoiceEngine = 'whisper' | 'sapi' | 'webspeech';

export interface VoiceCapabilities {
  hasSapi: boolean;      // window.electron.startSpeechRecognition exists
  hasWebSpeech: boolean; // window.SpeechRecognition/webkitSpeechRecognition exists
}

/**
 * Picks the engine to use. Whisper is the default and the universal fallback
 * (it's bundled, so it is always available); an explicit sapi/webspeech
 * preference is honoured only when that engine actually exists here.
 */
export function resolveVoiceEngine(pref: string | undefined, caps: VoiceCapabilities): VoiceEngine {
  if (pref === 'sapi' && caps.hasSapi) return 'sapi';
  if (pref === 'webspeech' && caps.hasWebSpeech) return 'webspeech';
  if (pref === 'sapi' || pref === 'webspeech') return 'whisper';
  return 'whisper';
}

export type WhisperModelSize = 'tiny' | 'base' | 'small';

/** Approximate download sizes shown in Settings. */
export const WHISPER_MODEL_INFO: Record<WhisperModelSize, { label: string; downloadMB: number }> = {
  tiny: { label: 'Fast (tiny, ~75 MB)', downloadMB: 75 },
  base: { label: 'Balanced (base, ~145 MB) — recommended', downloadMB: 145 },
  small: { label: 'Accurate (small, ~470 MB)', downloadMB: 470 },
};

/**
 * Maps the Settings model size + language to a hub model id.
 * English gets the .en variants (smaller + more accurate for English);
 * any other language needs the multilingual checkpoints.
 */
export function pickWhisperModelId(size: string | undefined, language: string | undefined): string {
  const s: WhisperModelSize = size === 'tiny' || size === 'small' ? size : 'base';
  const lang = (language || 'en').toLowerCase();
  return lang === 'en' ? `Xenova/whisper-${s}.en` : `Xenova/whisper-${s}`;
}

// ── Silence gate (pure — unit tested) ───────────────────────────────────────

export interface SilenceGateOptions {
  /** RMS level above which we consider the user to be speaking. */
  speechThreshold: number;
  /** Stop this many ms after speech has gone quiet. */
  silenceStopMs: number;
  /** Hard cap on total recording length, ms. */
  maxDurationMs: number;
  /** Never stop before this many ms, even in silence (gives the user time to start). */
  minDurationMs: number;
}

export const DEFAULT_SILENCE_GATE: SilenceGateOptions = {
  speechThreshold: 0.012,
  silenceStopMs: 2000,
  maxDurationMs: 60_000,
  minDurationMs: 3000,
};

/**
 * Feed periodic RMS samples; tells the recorder when to auto-stop.
 * Deterministic and side-effect free so it can be tested without audio APIs.
 */
export class SilenceGate {
  private startedAt: number | null = null;
  private lastSpeechAt: number | null = null;
  private heardSpeech = false;

  constructor(private opts: SilenceGateOptions = DEFAULT_SILENCE_GATE) {}

  /** @returns 'continue' to keep recording, 'stop' to finish. */
  feed(rms: number, nowMs: number): 'continue' | 'stop' {
    if (this.startedAt === null) this.startedAt = nowMs;
    const elapsed = nowMs - this.startedAt;

    if (rms >= this.opts.speechThreshold) {
      this.heardSpeech = true;
      this.lastSpeechAt = nowMs;
    }

    if (elapsed >= this.opts.maxDurationMs) return 'stop';
    if (elapsed < this.opts.minDurationMs) return 'continue';
    if (this.heardSpeech && this.lastSpeechAt !== null && nowMs - this.lastSpeechAt >= this.opts.silenceStopMs) {
      return 'stop';
    }
    return 'continue';
  }

  get sawSpeech(): boolean {
    return this.heardSpeech;
  }
}

/** RMS of a time-domain sample buffer (Float32, -1..1). */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// ── Whisper runs in the main process ───────────────────────────────────────
//
// The model download used to be a renderer fetch to huggingface.co, which the
// renderer CSP (connect-src 'self') blocks: "Voice error: Failed to fetch".
// main/speech/whisper-transcriber.ts loads it instead (Online-gated, cached in
// userData); only the recorded 16 kHz samples are sent there.

const WHISPER_SAMPLE_RATE = 16_000;

export type VoiceStatusCallback = (status: string) => void;

// ── Recording ────────────────────────────────────────────────────────────────

export interface RecordingController {
  /** Stop recording early (e.g. mic button clicked again). Transcription still runs. */
  stop: () => void;
  /** Abort entirely — no transcription, promise resolves with empty text. */
  cancel: () => void;
}

export interface WhisperTranscribeOptions {
  modelSize?: string;       // 'tiny' | 'base' | 'small'
  language?: string;        // ISO code; 'en' default
  micDeviceId?: string;     // specific input device from Settings → Voice
  silenceStopSec?: number;  // auto-stop after this much post-speech silence
  maxDurationSec?: number;  // hard recording cap
  onStatus?: VoiceStatusCallback;
  onController?: (c: RecordingController) => void;
}

async function recordUntilSilence(opts: WhisperTranscribeOptions): Promise<Blob | null> {
  const constraints: MediaStreamConstraints = {
    audio: opts.micDeviceId
      ? { deviceId: { exact: opts.micDeviceId }, echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  return new Promise<Blob | null>((resolve, reject) => {
    const chunks: BlobPart[] = [];
    let cancelled = false;
    let settled = false;

    const recorder = new MediaRecorder(stream);
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const gate = new SilenceGate({
      ...DEFAULT_SILENCE_GATE,
      silenceStopMs: Math.max(0.5, opts.silenceStopSec ?? 2) * 1000,
      maxDurationMs: Math.max(5, opts.maxDurationSec ?? 60) * 1000,
    });
    const buf = new Float32Array(analyser.fftSize);

    const cleanup = () => {
      clearInterval(poll);
      try { source.disconnect(); } catch { /* already gone */ }
      try { audioCtx.close(); } catch { /* already gone */ }
      stream.getTracks().forEach(t => t.stop());
    };

    const finish = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };

    const poll = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      if (gate.feed(computeRms(buf), Date.now()) === 'stop') finish();
    }, 100);

    opts.onController?.({
      stop: finish,
      cancel: () => { cancelled = true; finish(); },
    });

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (cancelled || !gate.sawSpeech) resolve(null);
      else resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };
    recorder.onerror = (e: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(e?.error?.message || 'Recording failed'));
    };

    recorder.start(250);
  });
}

/** Decode a recorded blob and resample to 16 kHz mono for Whisper. */
async function blobToWhisperInput(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  try {
    const decoded = await decodeCtx.decodeAudioData(arrayBuf);
    const frames = Math.max(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, WHISPER_SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    try { decodeCtx.close(); } catch { /* already gone */ }
  }
}

/**
 * One-shot voice capture → local Whisper transcription.
 * Resolves with the recognised text ('' when nothing was said or cancelled).
 */
export async function whisperTranscribeOnce(opts: WhisperTranscribeOptions = {}): Promise<{ text: string }> {
  const modelId = pickWhisperModelId(opts.modelSize, opts.language);
  const api = (window as any).electron;
  if (typeof api?.whisperTranscribe !== 'function') throw new Error('Voice input is not available in this window.');

  opts.onStatus?.('🎤 Listening… speak now (auto-stops on silence)');
  const blob = await recordUntilSilence(opts);
  if (!blob) return { text: '' };

  opts.onStatus?.('📝 Transcribing…');
  const audio = await blobToWhisperInput(blob);
  const stopProgress = api.onWhisperProgress?.((p: { percent: number }) => {
    opts.onStatus?.(`⬇️ Downloading voice model… ${p.percent}% (one-time)`);
  });
  try {
    const res = await api.whisperTranscribe({ modelId, language: opts.language, audio });
    if (!res?.success) throw new Error(res?.error || 'Transcription failed');
    return { text: String(res.text || '').trim() };
  } finally {
    stopProgress?.();
  }
}
