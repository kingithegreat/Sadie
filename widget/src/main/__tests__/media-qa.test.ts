/**
 * The render_qa stage, which until now inspected nothing.
 *
 * The state existed from the beginning: a job moved into `render_qa`, moved out
 * to `awaiting_approval`, and not one property of the file was ever checked. A
 * stage named QA that checks nothing is worse than no stage, because anyone
 * reading the pipeline assumes the output has been looked at.
 *
 * The fixtures below are REAL ffmpeg 9.0.1 output, captured from files made for
 * the purpose — a 1080x1920 clip with a 440 Hz tone, and the same clip with
 * anullsrc. Inventing the text would test the regex against my memory of
 * ffmpeg's format rather than against ffmpeg.
 */

import {
  parseRenderFacts,
  evaluateRenderQa,
  describeQa,
  SILENCE_FLOOR_DB,
  DURATION_TOLERANCE_SECONDS,
} from '../media-qa';

/** Captured from: ffmpeg -i good.mp4 -af volumedetect -f null - */
const REAL_GOOD = `
  Duration: 00:00:03.00, start: 0.000000, bitrate: 157 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1080x1920 [SAR 1:1 DAR 9:16], 19 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 123 kb/s (default)
  Stream #0:0 -> #0:0 (h264 (native) -> wrapped_avframe (native))
  Stream #0:1 -> #0:1 (aac (native) -> pcm_s16le (native))
  Stream #0:0(und): Video: wrapped_avframe, yuv420p(progressive), 1080x1920 [SAR 1:1 DAR 9:16], q=2-31, 200 kb/s, 30 fps, 30 tbn (default)
[Parsed_volumedetect_0 @ 0000029136abb540] mean_volume: -21.1 dB
[Parsed_volumedetect_0 @ 0000029136abb540] max_volume: -14.5 dB
`;

/** Same clip, anullsrc audio. Digital silence measures -91 dB. */
const REAL_SILENT = REAL_GOOD
  .replace('mean_volume: -21.1 dB', 'mean_volume: -91.0 dB')
  .replace('max_volume: -14.5 dB', 'max_volume: -91.0 dB');

const SHORT = { width: 1080, height: 1920 };

describe('parseRenderFacts — against real ffmpeg output', () => {
  test('reads streams, dimensions, duration and loudness', () => {
    const f = parseRenderFacts(REAL_GOOD);
    expect(f.hasVideo).toBe(true);
    expect(f.hasAudio).toBe(true);
    expect(f.width).toBe(1080);
    expect(f.height).toBe(1920);
    expect(f.durationSeconds).toBeCloseTo(3, 2);
    expect(f.meanVolumeDb).toBe(-21.1);
    expect(f.maxVolumeDb).toBe(-14.5);
  });

  test('the aspect ratio is not mistaken for the dimensions', () => {
    // The same line carries "[SAR 1:1 DAR 9:16]" and "30 fps". Only 1080x1920
    // is the frame size.
    const f = parseRenderFacts(REAL_GOOD);
    expect(f.width).toBe(1080);
    expect(f.height).not.toBe(16);
  });

  test('an empty string yields nulls rather than throwing', () => {
    const f = parseRenderFacts('');
    expect(f.hasVideo).toBe(false);
    expect(f.hasAudio).toBe(false);
    expect(f.durationSeconds).toBeNull();
    expect(f.meanVolumeDb).toBeNull();
  });

  test('an audio-only file is recognised as having no video', () => {
    const audioOnly = `
  Duration: 00:00:47.05, start: 0.000000, bitrate: 96 kb/s
  Stream #0:0: Audio: mp3, 24000 Hz, mono, fltp, 96 kb/s
[Parsed_volumedetect_0 @ 0x1] mean_volume: -18.0 dB
[Parsed_volumedetect_0 @ 0x1] max_volume: -2.0 dB
`;
    const f = parseRenderFacts(audioOnly);
    expect(f.hasVideo).toBe(false);
    expect(f.hasAudio).toBe(true);
    expect(f.durationSeconds).toBeCloseTo(47.05, 2);
  });
});

describe('evaluateRenderQa', () => {
  test('a good render passes', () => {
    const v = evaluateRenderQa(parseRenderFacts(REAL_GOOD), { ...SHORT, narrationSeconds: 3 });
    expect(v.ok).toBe(true);
    expect(v.failures).toEqual([]);
  });

  test('a SILENT render fails — the whole point of the stage', () => {
    const v = evaluateRenderQa(parseRenderFacts(REAL_SILENT), { ...SHORT, narrationSeconds: 3 });
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toMatch(/no audible sound/);
    // The number is in the message, so the reader can tell how silent.
    expect(v.failures.join(' ')).toContain('-91');
  });

  test('the silence floor separates quiet speech from actual silence', () => {
    // -91 is digital silence; -21 is ordinary narration. The floor must sit
    // between them and nowhere near either.
    expect(SILENCE_FLOOR_DB).toBeGreaterThan(-91);
    expect(SILENCE_FLOOR_DB).toBeLessThan(-21.1);
  });

  test('a missing audio track fails', () => {
    const noAudio = REAL_GOOD.replace(/^.*Audio:.*$/gm, '');
    const v = evaluateRenderQa(parseRenderFacts(noAudio), SHORT);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toMatch(/no audio track/);
  });

  test('the wrong frame size fails, and says both sizes', () => {
    const landscape = REAL_GOOD.replace(/1080x1920/g, '1920x1080');
    const v = evaluateRenderQa(parseRenderFacts(landscape), SHORT);
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toContain('1920x1080');
    expect(v.failures.join(' ')).toContain('1080x1920');
  });

  test('a video much longer than its narration fails — that is dead air', () => {
    const v = evaluateRenderQa(parseRenderFacts(REAL_GOOD), { ...SHORT, narrationSeconds: 30 });
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toMatch(/no speech/);
  });

  test('drift within tolerance passes', () => {
    const v = evaluateRenderQa(parseRenderFacts(REAL_GOOD), {
      ...SHORT,
      narrationSeconds: 3 + (DURATION_TOLERANCE_SECONDS - 0.1),
    });
    expect(v.ok).toBe(true);
  });

  test('an unknown narration length is not treated as a mismatch', () => {
    // Older jobs have no measured duration. Absence must not fail the gate.
    const v = evaluateRenderQa(parseRenderFacts(REAL_GOOD), { ...SHORT, narrationSeconds: null });
    expect(v.ok).toBe(true);
  });

  test('clipping warns but does not block — the video is still watchable', () => {
    const hot = REAL_GOOD.replace('max_volume: -14.5 dB', 'max_volume: 0.0 dB');
    const v = evaluateRenderQa(parseRenderFacts(hot), { ...SHORT, hasMusic: true });
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/quieter music track/);
  });

  test('the clipping note names music only when music was mixed', () => {
    const hot = REAL_GOOD.replace('max_volume: -14.5 dB', 'max_volume: 0.0 dB');
    const v = evaluateRenderQa(parseRenderFacts(hot), { ...SHORT, hasMusic: false });
    expect(v.warnings.join(' ')).toMatch(/narration peaks/);
    expect(v.warnings.join(' ')).not.toMatch(/music/);
  });
});

describe('describeQa', () => {
  test('a pass with no notes says so plainly', () => {
    expect(describeQa({ ok: true, failures: [], warnings: [] })).toBe('checks passed');
  });

  test('a pass with a note carries the note', () => {
    expect(describeQa({ ok: true, failures: [], warnings: ['it peaks'] })).toMatch(/with a note: it peaks/);
  });

  test('a failure lists every reason, not just the first', () => {
    const s = describeQa({ ok: false, failures: ['no audio', 'wrong size'], warnings: [] });
    expect(s).toContain('no audio');
    expect(s).toContain('wrong size');
  });
});
