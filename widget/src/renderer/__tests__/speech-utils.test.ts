/**
 * Voice input helper tests — engine selection, Whisper model mapping, and the
 * silence auto-stop gate. These are the pure pieces of the voice pipeline;
 * the audio-API plumbing is exercised manually/e2e.
 */

import {
  resolveVoiceEngine,
  pickWhisperModelId,
  SilenceGate,
  computeRms,
  DEFAULT_SILENCE_GATE,
} from '../utils/speech';

describe('resolveVoiceEngine', () => {
  const allCaps = { hasSapi: true, hasWebSpeech: true };
  const noCaps = { hasSapi: false, hasWebSpeech: false };

  test('defaults to whisper', () => {
    expect(resolveVoiceEngine(undefined, allCaps)).toBe('whisper');
    expect(resolveVoiceEngine('whisper', allCaps)).toBe('whisper');
    expect(resolveVoiceEngine('garbage', allCaps)).toBe('whisper');
  });

  test('honours an explicit sapi/webspeech preference when available', () => {
    expect(resolveVoiceEngine('sapi', allCaps)).toBe('sapi');
    expect(resolveVoiceEngine('webspeech', allCaps)).toBe('webspeech');
  });

  test('falls back to whisper when the preferred engine is unavailable', () => {
    expect(resolveVoiceEngine('sapi', noCaps)).toBe('whisper');
    expect(resolveVoiceEngine('webspeech', noCaps)).toBe('whisper');
  });
});

describe('pickWhisperModelId', () => {
  test('English uses the .en checkpoints', () => {
    expect(pickWhisperModelId('base', 'en')).toBe('Xenova/whisper-base.en');
    expect(pickWhisperModelId('tiny', undefined)).toBe('Xenova/whisper-tiny.en');
    expect(pickWhisperModelId('small', 'EN')).toBe('Xenova/whisper-small.en');
  });

  test('other languages use the multilingual checkpoints', () => {
    expect(pickWhisperModelId('base', 'es')).toBe('Xenova/whisper-base');
    expect(pickWhisperModelId('small', 'mi')).toBe('Xenova/whisper-small');
  });

  test('unknown or missing size falls back to base', () => {
    expect(pickWhisperModelId(undefined, 'en')).toBe('Xenova/whisper-base.en');
    expect(pickWhisperModelId('mega', 'en')).toBe('Xenova/whisper-base.en');
  });
});

describe('SilenceGate', () => {
  const opts = { ...DEFAULT_SILENCE_GATE, minDurationMs: 3000, silenceStopMs: 2000, maxDurationMs: 60000, speechThreshold: 0.012 };
  const QUIET = 0.001;
  const LOUD = 0.1;

  test('keeps recording through initial silence (min duration grace)', () => {
    const gate = new SilenceGate(opts);
    expect(gate.feed(QUIET, 0)).toBe('continue');
    expect(gate.feed(QUIET, 2500)).toBe('continue');
    expect(gate.sawSpeech).toBe(false);
  });

  test('stops after speech followed by enough silence', () => {
    const gate = new SilenceGate(opts);
    gate.feed(QUIET, 0);
    gate.feed(LOUD, 2000);       // user speaks
    expect(gate.feed(QUIET, 3500)).toBe('continue'); // 1.5s silence < 2s threshold
    expect(gate.feed(QUIET, 4100)).toBe('stop');     // 2.1s silence since speech at 2000
    expect(gate.sawSpeech).toBe(true);
  });

  test('does not stop while the user keeps talking', () => {
    const gate = new SilenceGate(opts);
    gate.feed(LOUD, 0);
    for (let t = 500; t <= 10_000; t += 500) {
      expect(gate.feed(LOUD, t)).toBe('continue');
    }
  });

  test('short pauses inside a sentence do not stop the recording', () => {
    const gate = new SilenceGate(opts);
    gate.feed(LOUD, 0);
    gate.feed(LOUD, 3000);
    expect(gate.feed(QUIET, 4500)).toBe('continue'); // 1.5s pause — mid-sentence
    gate.feed(LOUD, 4800); // resumes talking — silence clock resets
    expect(gate.feed(QUIET, 6000)).toBe('continue'); // 1.2s after speech at 4800
    expect(gate.feed(QUIET, 6900)).toBe('stop');     // 2.1s after speech at 4800
  });

  test('hard-stops at max duration even mid-speech', () => {
    const gate = new SilenceGate({ ...opts, maxDurationMs: 5000 });
    gate.feed(LOUD, 0);
    expect(gate.feed(LOUD, 4999)).toBe('continue');
    expect(gate.feed(LOUD, 5000)).toBe('stop');
  });
});

describe('computeRms', () => {
  test('silence is 0', () => {
    expect(computeRms(new Float32Array(1024))).toBe(0);
    expect(computeRms(new Float32Array(0))).toBe(0);
  });

  test('constant amplitude returns that amplitude', () => {
    const buf = new Float32Array(512).fill(0.5);
    expect(computeRms(buf)).toBeCloseTo(0.5, 5);
  });

  test('mixed signal is between min and max amplitude', () => {
    const buf = new Float32Array([0, 0.5, -0.5, 0]);
    expect(computeRms(buf)).toBeCloseTo(Math.sqrt(0.125), 5);
  });
});
