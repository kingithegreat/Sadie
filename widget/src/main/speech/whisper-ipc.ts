import { ipcMain } from 'electron';
import { transcribeWithWhisper } from './whisper-transcriber';

export const WHISPER_CHANNELS = {
  TRANSCRIBE: 'homebot:voice:whisper-transcribe',
  PROGRESS: 'homebot:voice:whisper-progress',
} as const;

/** Samples arrive as a structured-clone Float32Array; accept the byte forms too. */
export function toFloat32(audio: unknown): Float32Array | null {
  // Tag checks, not instanceof: a buffer from another realm (IPC, sandboxes) fails instanceof.
  const tag = Object.prototype.toString.call(audio);
  if (tag === '[object Float32Array]') return audio as Float32Array;
  if (tag === '[object ArrayBuffer]') {
    const buf = audio as ArrayBuffer;
    return buf.byteLength % 4 === 0 ? new Float32Array(buf) : null;
  }
  if (ArrayBuffer.isView(audio) && audio.byteLength % 4 === 0) {
    const copy = new Uint8Array(audio.byteLength);
    copy.set(new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength));
    return new Float32Array(copy.buffer);
  }
  return null;
}

export function registerWhisperIpc(): void {
  ipcMain.removeHandler(WHISPER_CHANNELS.TRANSCRIBE);
  ipcMain.handle(WHISPER_CHANNELS.TRANSCRIBE, async (event, args: { modelId?: unknown; language?: unknown; audio?: unknown }) => {
    try {
      const audio = toFloat32(args?.audio);
      if (!audio) return { success: false, error: 'No audio was recorded.' };
      const text = await transcribeWithWhisper(
        { modelId: String(args?.modelId || ''), language: typeof args?.language === 'string' ? args.language : undefined, audio },
        progress => { try { event.sender.send(WHISPER_CHANNELS.PROGRESS, progress); } catch { /* window closed */ } },
      );
      return { success: true, text };
    } catch (err) {
      return { success: false, error: (err as Error).message || String(err) };
    }
  });
}
