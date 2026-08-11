/**
 * Captions from a known script and a known audio duration.
 *
 * The properties that matter for a subtitle file are structural, and a player
 * enforces none of them: cues must not overlap, must not run past the audio,
 * must be readable in the time given, and must reproduce the script exactly.
 * A caption that says something the narrator did not is worse than no caption.
 */

import {
  mp3DurationSeconds,
  splitIntoCues,
  timeCues,
  toSrt,
  toVtt,
  buildCaptions,
} from '../media-captions';

const SCRIPT =
  'Jonah heard a call and ran the other way. He boarded a ship bound for Tarshish, ' +
  'as far from Nineveh as money could buy. Then the storm came. The sailors threw ' +
  'cargo overboard while Jonah slept below deck.';

describe('duration from a constant-bitrate file', () => {
  it('converts bytes to seconds at 96 kbps', () => {
    // 96 kbit/s = 12 kB/s, so 600 kB is 50 seconds.
    expect(mp3DurationSeconds(600_000)).toBeCloseTo(50, 1);
  });

  it('treats an empty or missing file as zero rather than NaN', () => {
    expect(mp3DurationSeconds(0)).toBe(0);
    expect(mp3DurationSeconds(-1)).toBe(0);
  });
});

describe('splitting a script into readable cues', () => {
  it('breaks on sentences', () => {
    const cues = splitIntoCues(SCRIPT);
    expect(cues.length).toBeGreaterThan(2);
    expect(cues[0]).toMatch(/^Jonah heard a call/);
  });

  it('keeps every cue short enough to read', () => {
    for (const c of splitIntoCues(SCRIPT)) {
      expect(c.length).toBeLessThanOrEqual(84);
    }
  });

  it('splits a sentence that is too long to show at once', () => {
    const long = 'He walked ' + 'on and on '.repeat(30) + 'until the city.';
    const cues = splitIntoCues(long);
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) expect(c.length).toBeLessThanOrEqual(84);
  });

  it('loses no words from the script', () => {
    // The one unforgivable caption bug: text the narrator never said, or
    // words dropped silently.
    const joined = splitIntoCues(SCRIPT).join(' ').replace(/\s+/g, ' ');
    expect(joined).toBe(SCRIPT.replace(/\s+/g, ' '));
  });

  it('returns nothing for an empty script', () => {
    expect(splitIntoCues('   ')).toEqual([]);
  });
});

describe('timing cues against the real duration', () => {
  const cues = timeCues(splitIntoCues(SCRIPT), 50);

  it('never overlaps', () => {
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startMs).toBeGreaterThanOrEqual(cues[i - 1].endMs);
    }
  });

  it('starts at zero and ends exactly with the audio', () => {
    expect(cues[0].startMs).toBe(0);
    // Pinned, so rounding cannot leave a caption showing after the sound stops.
    expect(cues.at(-1)!.endMs).toBe(50_000);
  });

  it('gives every cue enough time to be read', () => {
    for (const c of cues) {
      expect(c.endMs - c.startMs).toBeGreaterThanOrEqual(500);
    }
  });

  it('gives longer lines more time than shorter ones', () => {
    const timed = timeCues(['Short.', 'A considerably longer line with many more words in it.'], 20);
    expect(timed[1].endMs - timed[1].startMs).toBeGreaterThan(timed[0].endMs - timed[0].startMs);
  });

  it('handles a missing duration without producing garbage', () => {
    expect(timeCues(splitIntoCues(SCRIPT), 0)).toEqual([]);
  });
});

describe('file formats', () => {
  const { srt, vtt, cues } = buildCaptions(SCRIPT, 600_000);

  it('writes SRT with comma milliseconds and blank-line separators', () => {
    expect(srt).toMatch(/^1\n00:00:00,000 --> 00:00:\d{2},\d{3}\n/);
    expect(srt.split('\n\n').length).toBeGreaterThanOrEqual(cues.length);
  });

  it('writes VTT with a header and dot milliseconds', () => {
    expect(vtt.startsWith('WEBVTT\n')).toBe(true);
    expect(vtt).toMatch(/00:00:00\.000 --> /);
    // A comma here is the classic SRT/VTT mix-up; players reject the file.
    expect(vtt).not.toMatch(/\d{2},\d{3} -->/);
  });

  it('wraps a long cue to at most two lines', () => {
    const long = 'This is a single sentence that is comfortably longer than one caption line should ever be.';
    const out = toSrt(timeCues([long], 10));
    const text = out.split('\n').slice(2).filter(Boolean);
    expect(text.length).toBeLessThanOrEqual(2);
  });

  it('reports the duration it timed against', () => {
    expect(buildCaptions(SCRIPT, 600_000).durationSeconds).toBeCloseTo(50, 1);
  });

  it('produces nothing rather than an empty file for an empty script', () => {
    const empty = buildCaptions('', 600_000);
    expect(empty.cues).toEqual([]);
    expect(toVtt(empty.cues)).toBe('WEBVTT\n\n');
  });
});
