/**
 * ansi.test.ts — pure ANSI parsing for the Terminal panel.
 * No Electron, no DOM: this module is deliberately dependency-free.
 */

import {
  parseAnsiChunk,
  stripAnsi,
  applyCarriageReturns,
  excerptForModel,
} from '../ansi';

const text = (input: string) => parseAnsiChunk(input).segments.map(s => s.text).join('');

describe('parseAnsiChunk', () => {
  test('returns plain text unchanged as a single segment', () => {
    const { segments } = parseAnsiChunk('hello world');
    expect(segments).toEqual([{ text: 'hello world' }]);
  });

  test('splits on colour changes and applies foreground colour', () => {
    const { segments } = parseAnsiChunk('ok \x1b[31mfail\x1b[0m done');
    expect(segments.map(s => s.text)).toEqual(['ok ', 'fail', ' done']);
    expect(segments[1].fg).toContain('--ansi-red');
    expect(segments[2].fg).toBeUndefined();
  });

  test('handles bold, italic and underline', () => {
    const { segments } = parseAnsiChunk('\x1b[1mB\x1b[3mI\x1b[4mU');
    expect(segments[0].bold).toBe(true);
    expect(segments[1].italic).toBe(true);
    expect(segments[2].underline).toBe(true);
  });

  test('resets only what the reset code targets', () => {
    const { segments } = parseAnsiChunk('\x1b[1;31mx\x1b[22my');
    expect(segments[0]).toMatchObject({ bold: true });
    expect(segments[1].bold).toBeUndefined();
    expect(segments[1].fg).toContain('--ansi-red'); // 22 clears weight, not colour
  });

  test('supports 256-colour and truecolor', () => {
    const c256 = parseAnsiChunk('\x1b[38;5;196mred').segments[0];
    expect(c256.fg).toMatch(/^rgb\(/);
    const truecolor = parseAnsiChunk('\x1b[38;2;10;20;30mx').segments[0];
    expect(truecolor.fg).toBe('rgb(10,20,30)');
  });

  test('carries style across chunk boundaries via returned state', () => {
    const first = parseAnsiChunk('\x1b[32mgreen');
    const second = parseAnsiChunk(' still green', first.state);
    expect(second.segments[0].fg).toContain('--ansi-green');
  });

  test('drops cursor-movement and erase sequences instead of rendering them', () => {
    expect(text('a\x1b[2Kb\x1b[1;1Hc')).toBe('abc');
  });

  test('drops OSC title sequences', () => {
    expect(text('\x1b]0;window title\x07shell')).toBe('shell');
  });

  test('never emits a raw ESC for a truncated sequence', () => {
    expect(text('abc\x1b')).toBe('abc');
    expect(text('abc\x1b[')).not.toContain('\x1b');
  });
});

describe('stripAnsi', () => {
  test('removes styling but keeps the text', () => {
    expect(stripAnsi('\x1b[31mERROR\x1b[0m: nope')).toBe('ERROR: nope');
  });
});

describe('applyCarriageReturns', () => {
  test('later text overwrites the start of the line', () => {
    expect(applyCarriageReturns('aaaaa\rbb')).toBe('bbaaa');
  });

  test('a full overwrite replaces the line', () => {
    expect(applyCarriageReturns('50%\r100% done')).toBe('100% done');
  });

  test('lines without a carriage return are untouched', () => {
    expect(applyCarriageReturns('plain')).toBe('plain');
  });
});

describe('excerptForModel', () => {
  // HomeBot's default runtime is a 7B-class local model — an unbounded build
  // log would swamp its context, so this must always cap.
  test('keeps the tail, where errors and summaries live', () => {
    const input = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const out = excerptForModel(input, { maxLines: 10 });
    expect(out).toContain('line 199');
    expect(out).not.toContain('line 100');
    expect(out).toMatch(/earlier lines omitted/);
  });

  test('respects the character cap even when the line cap passes', () => {
    const input = Array.from({ length: 20 }, () => 'x'.repeat(500)).join('\n');
    const out = excerptForModel(input, { maxLines: 20, maxChars: 1000 });
    expect(out.length).toBeLessThanOrEqual(1000 + 60);
  });

  test('strips ANSI so the model never sees escape codes', () => {
    expect(excerptForModel('\x1b[31mboom\x1b[0m')).toBe('boom');
  });

  test('short output passes through without an omission notice', () => {
    expect(excerptForModel('all good')).toBe('all good');
  });

  test('empty output yields an empty string, not a notice', () => {
    expect(excerptForModel('   \n  ')).toBe('');
  });
});
