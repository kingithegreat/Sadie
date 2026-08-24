/**
 * Narration engine registry — the one source both processes read.
 *
 * The renderer builds the engine/voice pickers from this file and the main
 * process validates against it, so a voice that appears in the dropdown is by
 * construction a voice the handler will accept. Kokoro's voices live here as
 * a fixed graded set (from kokoro-js 1.2.1's own quality grades) because the
 * local model only speaks English and only knows these speakers; Edge's
 * hundreds of locale voices stay reachable by leaving the engine on Edge.
 */

export type NarrationEngine = 'edge' | 'kokoro';

export const NARRATION_ENGINES: Array<{
  value: NarrationEngine | '';
  label: string;
}> = [
  { value: '', label: 'Edge neural (default)' },
  { value: 'kokoro', label: 'Kokoro — local, English (first use downloads ≈90 MB)' },
];

/** Kokoro speakers worth offering, with human labels. */
export const KOKORO_VOICES: ReadonlyArray<{ name: string; label: string }> = [
  { name: 'af_heart', label: 'Heart — US female' },
  { name: 'af_bella', label: 'Bella — US female' },
  { name: 'af_nicole', label: 'Nicole — US female (soft)' },
  { name: 'bf_emma', label: 'Emma — UK female' },
  { name: 'bm_george', label: 'George — UK male' },
  { name: 'am_michael', label: 'Michael — US male' },
  { name: 'am_fenrir', label: 'Fenrir — US male' },
];

export function isKokoroVoice(voice?: string): boolean {
  return !!voice && KOKORO_VOICES.some((v) => v.name === voice);
}

/** The speaker Kokoro uses when none (or an unknown one) was asked for. */
export const KOKORO_DEFAULT_VOICE = 'af_heart';
