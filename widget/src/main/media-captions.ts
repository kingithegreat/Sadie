/**
 * media-captions.ts — subtitles for narration we wrote ourselves.
 *
 * The plan lists Whisper for captions. Whisper solves a harder problem than we
 * have: it recovers text from audio. We already KNOW the text — we generated
 * the narration from a script. What is missing is only the timing.
 *
 * So this distributes the known script across the known duration by word
 * count. It is an estimate, not forced alignment, and the accuracy claim is
 * bounded: within a single TTS voice at a fixed rate, speech tempo is close to
 * constant, so proportional distribution lands within a fraction of a second
 * over a 60-second short. That is good enough to read along with. It would NOT
 * be good enough for a human recording with pauses and varied pace, and if
 * visuals ever need beat-accurate sync, forced alignment is the upgrade path.
 *
 * No new dependency, no model download, no network call.
 */

export interface Cue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

/** Characters per caption line before wrapping. Two lines is the readable max. */
const MAX_LINE = 42;
const MAX_LINES = 2;
const MAX_CUE_CHARS = MAX_LINE * MAX_LINES;

/**
 * Duration of a constant-bitrate MP3 from its size.
 *
 * Edge TTS emits 24 kHz 96 kbit/s mono CBR, so bytes map directly to seconds.
 * Reading the real file beats re-estimating from word count: the estimate is
 * what we are trying to correct.
 */
export function mp3DurationSeconds(bytes: number, bitrateKbps = 96): number {
  if (!bytes || bytes <= 0) return 0;
  return (bytes * 8) / (bitrateKbps * 1000);
}

/**
 * Split narration into caption-sized chunks on sentence boundaries, falling
 * back to clause boundaries and then to width when a sentence is too long to
 * show at once.
 */
export function splitIntoCues(script: string): string[] {
  const clean = script.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  // Keep the terminator with its sentence.
  const sentences = clean.match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()).filter(Boolean) ?? [clean];

  const cues: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CUE_CHARS) {
      cues.push(sentence);
      continue;
    }
    // Too long to read at once: break at commas/semicolons, then by width.
    let rest = sentence;
    while (rest.length > MAX_CUE_CHARS) {
      const window = rest.slice(0, MAX_CUE_CHARS);
      const at = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '));
      const cut = at > MAX_LINE ? at + 1 : window.lastIndexOf(' ');
      const take = cut > 0 ? cut : MAX_CUE_CHARS;
      cues.push(rest.slice(0, take).trim());
      rest = rest.slice(take).trim();
    }
    if (rest) cues.push(rest);
  }
  return cues;
}

const wordCount = (s: string) => (s.match(/\S+/g) || []).length;

/**
 * Lay cues out across the real audio duration, proportional to word count.
 *
 * Every cue gets a minimum on-screen time so a two-word line does not flash
 * past unreadably; the remainder is shared by length. Cues never overlap and
 * the last one ends exactly at the audio's end, so a player cannot show a
 * caption after the sound has stopped.
 */
export function timeCues(cues: string[], totalSeconds: number): Cue[] {
  if (!cues.length || totalSeconds <= 0) return [];

  const MIN_CUE_MS = 900;
  const totalMs = Math.round(totalSeconds * 1000);
  const words = cues.map(wordCount);
  const totalWords = words.reduce((a, b) => a + b, 0) || 1;

  const floorMs = Math.min(MIN_CUE_MS * cues.length, totalMs);
  const shareMs = Math.max(0, totalMs - floorMs);

  const out: Cue[] = [];
  let cursor = 0;
  cues.forEach((text, i) => {
    const base = floorMs / cues.length;
    const extra = (words[i] / totalWords) * shareMs;
    const startMs = Math.round(cursor);
    // The final cue is pinned to the end so rounding cannot leave a gap or
    // run past the audio.
    const endMs = i === cues.length - 1 ? totalMs : Math.round(cursor + base + extra);
    out.push({ index: i + 1, startMs, endMs, text });
    cursor = endMs;
  });
  return out;
}

function stamp(ms: number, sep: ',' | '.'): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = String(Math.floor(clamped / 3_600_000)).padStart(2, '0');
  const m = String(Math.floor(clamped / 60_000) % 60).padStart(2, '0');
  const s = String(Math.floor(clamped / 1000) % 60).padStart(2, '0');
  const f = String(clamped % 1000).padStart(3, '0');
  return `${h}:${m}:${s}${sep}${f}`;
}

/** Wrap a cue to at most two lines, as subtitle convention expects. */
function wrap(text: string): string {
  if (text.length <= MAX_LINE) return text;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > MAX_LINE && line) {
      lines.push(line.trim());
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, MAX_LINES).join('\n');
}

export function toSrt(cues: Cue[]): string {
  return cues
    .map(c => `${c.index}\n${stamp(c.startMs, ',')} --> ${stamp(c.endMs, ',')}\n${wrap(c.text)}\n`)
    .join('\n');
}

export function toVtt(cues: Cue[]): string {
  const body = cues
    .map(c => `${stamp(c.startMs, '.')} --> ${stamp(c.endMs, '.')}\n${wrap(c.text)}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/** Everything a caller needs from a script plus the audio it produced. */
export function buildCaptions(script: string, audioBytes: number): {
  cues: Cue[];
  srt: string;
  vtt: string;
  durationSeconds: number;
} {
  const durationSeconds = mp3DurationSeconds(audioBytes);
  const cues = timeCues(splitIntoCues(script), durationSeconds);
  return { cues, srt: toSrt(cues), vtt: toVtt(cues), durationSeconds };
}
