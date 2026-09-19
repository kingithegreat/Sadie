import {
  assTimestamp, buildTextCardAss, createMeasurer, entriesFromShots, escapeAssText,
  layoutTextCard, SAFE_MARGIN, wrapMeasured, type Measurer,
} from '../movie/text-cards';
import { sanitizeTextCard } from '../../shared/text-card';

// Real text measurement (Pango through sharp) is exercised by the last test;
// the rest use a predictable stand-in so line breaks can be asserted exactly.
const fake: Measurer = async (text, fontPx) => ({ width: text.length * fontPx * 0.5, height: fontPx });

const HD = { width: 1920, height: 1080 };
const PORTRAIT = { width: 1080, height: 1920 };

describe('wrapping text to a measured width', () => {
  it('breaks where the line stops fitting, never mid-sentence at a guess', async () => {
    const lines = await wrapMeasured('the quick brown fox jumps over the lazy dog', 20, 200, fake);
    for (const line of lines) expect((await fake(line, 20)).width).toBeLessThanOrEqual(200);
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('splits a single word too long for the line instead of letting it clip', async () => {
    const lines = await wrapMeasured('Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch', 20, 100, fake);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect((await fake(line, 20)).width).toBeLessThanOrEqual(100);
    expect(lines.join('')).toBe('Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch');
  });

  it('empty text is one empty line, not a crash', async () => {
    expect(await wrapMeasured('   ', 20, 100, fake)).toEqual(['']);
  });
});

describe('fitting a card to the frame', () => {
  it('keeps the block inside the action-safe box at 16:9 and 9:16', async () => {
    const card = { heading: 'The Great Pyramid of Giza', subline: 'Built for Pharaoh Khufu around 2560 BC', position: 'bottom' as const };
    for (const frame of [HD, PORTRAIT]) {
      const layout = await layoutTextCard(card, frame, fake);
      expect(layout.safe.width).toBe(Math.round(frame.width * (1 - 2 * SAFE_MARGIN)));
      expect(layout.blockHeight).toBeLessThanOrEqual(layout.safe.height);
      for (const [lines, size] of [[layout.headingLines, layout.headingPx], [layout.sublineLines, layout.sublinePx]] as const) {
        for (const line of lines) expect((await fake(line, size)).width).toBeLessThanOrEqual(layout.safe.width);
      }
      expect(layout.headingLines.join(' ')).toBe(card.heading);
    }
  });

  it('a very long card is stepped down and still fits, rather than being drawn over the edge', async () => {
    const heading = 'A heading that simply will not stop going on and on and on about the pyramids '.repeat(2).trim();
    const layout = await layoutTextCard({ heading, subline: 'and a sub-line that is also far too long for any sensible title card', position: 'middle' }, PORTRAIT, fake);
    expect(layout.blockHeight).toBeLessThanOrEqual(layout.safe.height);
    expect(layout.headingPx).toBeLessThan(Math.round(PORTRAIT.height * 0.075));
    expect(layout.headingLines.length).toBeGreaterThan(2);
  });

  it('the sub-line is smaller than the heading', async () => {
    const layout = await layoutTextCard({ heading: 'Title', subline: 'Detail', position: 'top' }, HD, fake);
    expect(layout.sublinePx).toBeLessThan(layout.headingPx);
    expect(layout.sublineLines).toEqual(['Detail']);
  });
});

describe('the ASS the renderer burns', () => {
  const entry = (over: Partial<{ heading: string; subline: string; position: 'top' | 'middle' | 'bottom'; durationSec: number }> = {}, start = 0, end = 5) =>
    ({ card: { heading: 'Chapter One', position: 'bottom' as const, ...over }, startSec: start, endSec: end });

  it('uses the real frame as PlayRes, so measured sizes are drawn sizes', async () => {
    const ass = await buildTextCardAss([entry()], PORTRAIT, fake);
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toMatch(/Style: card_bottom_\d+,Arial,\d+/);
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:05.00,');
  });

  it('places top, middle and bottom cards where they were asked for, inside the safe margin', async () => {
    const ass = await buildTextCardAss([
      entry({ position: 'top' }, 0, 2), entry({ position: 'middle' }, 2, 4), entry({ position: 'bottom' }, 4, 6),
    ], HD, fake);
    const styles = ass.split('\n').filter(l => l.startsWith('Style: '));
    const alignment = (name: string) => styles.find(s => s.includes(name))!.split(',').slice(-5)[0];
    expect(alignment('card_top')).toBe('8');
    expect(alignment('card_middle')).toBe('5');
    expect(alignment('card_bottom')).toBe('2');
    // Margins are the action-safe box: 10% of each edge.
    expect(styles[0]).toContain(',192,192,108,');
  });

  it('a card with its own duration ends early, and one with no time left is dropped', async () => {
    const ass = await buildTextCardAss([entry({ durationSec: 1.5 }, 10, 15)], HD, fake);
    expect(ass).toContain('0:00:10.00,0:00:11.50');
    expect(await buildTextCardAss([entry({ durationSec: 2 }, 5, 5)], HD, fake)).toBe('');
    expect(await buildTextCardAss([], HD, fake)).toBe('');
  });

  it('braces and newlines in the text cannot become ASS commands', () => {
    expect(escapeAssText('{\\an8}Fake override\nsecond line')).toBe('\\{\\\\an8\\}Fake override second line');
    expect(assTimestamp(3661.239)).toBe('1:01:01.24');
    expect(assTimestamp(-5)).toBe('0:00:00.00');
  });

  it('cards follow their own shots along the timeline', () => {
    const entries = entriesFromShots([
      { durationSec: 4 },
      { durationSec: 3, textCard: { heading: 'Second shot', position: 'top' } },
      { durationSec: 2, textCard: { heading: 'Third shot', position: 'bottom' } },
    ]);
    expect(entries).toEqual([
      { card: { heading: 'Second shot', position: 'top' }, startSec: 4, endSec: 7 },
      { card: { heading: 'Third shot', position: 'bottom' }, startSec: 7, endSec: 9 },
    ]);
  });
});

describe('a card from untrusted input', () => {
  it('needs a heading, tidies whitespace, caps length and defaults its position', () => {
    expect(sanitizeTextCard({ heading: '  The   Nile  ', subline: ' flows north ', position: 'middle' }))
      .toEqual({ heading: 'The Nile', subline: 'flows north', position: 'middle' });
    expect(sanitizeTextCard({ heading: 'Only a heading' })).toEqual({ heading: 'Only a heading', position: 'bottom' });
    expect(sanitizeTextCard({ heading: 'x'.repeat(500) })!.heading).toHaveLength(120);
    expect(sanitizeTextCard({ heading: 'A', position: 'nowhere' })!.position).toBe('bottom');
    expect(sanitizeTextCard({ heading: 'A', durationSec: -2 })!.durationSec).toBeUndefined();
    expect(sanitizeTextCard({ heading: 'A', durationSec: 2.456 })!.durationSec).toBe(2.46);
    for (const nothing of [null, undefined, 'text', { subline: 'no heading' }, { heading: '   ' }]) {
      expect(sanitizeTextCard(nothing)).toBeNull();
    }
  });
});

describe('real text measurement', () => {
  // Pango reports the ink a string actually takes; the layout is only honest if
  // this is what decides the line breaks.
  jest.setTimeout(30_000);

  it('measures real strings and keeps a long title inside a 1080x1920 frame', async () => {
    const measure = createMeasurer();
    const short = await measure('Giza', 60);
    const long = await measure('Giza and the pyramids of the Fourth Dynasty', 60);
    expect(long.width).toBeGreaterThan(short.width * 3);
    expect(short.width).toBeGreaterThan(0);

    const layout = await layoutTextCard(
      { heading: 'The Great Pyramid of Giza, last of the Seven Wonders', subline: 'Built for Pharaoh Khufu around 2560 BC', position: 'bottom' },
      PORTRAIT, measure);
    expect(layout.headingLines.length).toBeGreaterThan(1);
    for (const line of layout.headingLines) {
      expect((await measure(line, layout.headingPx)).width).toBeLessThanOrEqual(layout.safe.width);
    }
    expect(layout.blockHeight).toBeLessThanOrEqual(layout.safe.height);
  });
});
