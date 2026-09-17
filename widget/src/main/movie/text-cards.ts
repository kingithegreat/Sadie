/**
 * Drawing a text card on a shot (MS-5), measured before it is drawn.
 *
 * Captions are burned by libass, which wraps on its own — but the card has to
 * be sized to the frame and guaranteed to fit, and "guaranteed" means measured.
 * Pango (through sharp) reports the real ink extents of a string at a size, so
 * lines are broken where they actually stop fitting and the type is stepped
 * down until the whole block sits inside the action-safe box. Nothing here
 * guesses an average character width.
 *
 * The result is an ASS file the renderer burns after the captions, so a card
 * sits over them rather than under.
 */

import sharp from 'sharp';
import { TEXT_CARD_POSITIONS, type TextCard, type TextCardPosition } from '../../shared/text-card';

/** Broadcast action-safe: keep text off the outer tenth on every side. */
export const SAFE_MARGIN = 0.1;
/** Heading size as a share of frame height, before any shrinking. */
const HEADING_SHARE = 0.075;
const SUBLINE_RATIO = 0.55;
/** Below this the card is unreadable on a phone; the text is trimmed instead. */
const MIN_HEADING_PX = 24;
const LINE_SPACING = 1.25;

export interface Frame { width: number; height: number }

export interface TextCardLayout {
  headingPx: number;
  sublinePx: number;
  headingLines: string[];
  sublineLines: string[];
  /** Ink height of the whole block, px. */
  blockHeight: number;
  /** The box the block had to fit inside. */
  safe: { width: number; height: number };
}

export interface Measurer {
  (text: string, fontPx: number): Promise<{ width: number; height: number }>;
}

const FONT_FAMILY = 'sans';

/** Real ink extents from Pango. Cached: layout asks about the same line often. */
export function createMeasurer(family = FONT_FAMILY): Measurer {
  const cache = new Map<string, { width: number; height: number }>();
  return async (text, fontPx) => {
    const key = `${fontPx}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (!text) return { width: 0, height: 0 };
    const meta = await sharp({ text: { text, font: `${family} ${Math.round(fontPx)}`, dpi: 72, rgba: true } }).metadata();
    const size = { width: meta.width ?? 0, height: meta.height ?? 0 };
    cache.set(key, size);
    return size;
  };
}

/** Break `text` into lines that each measure no wider than `maxWidth`. */
export async function wrapMeasured(text: string, fontPx: number, maxWidth: number, measure: Measurer): Promise<string[]> {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const { width } = await measure(candidate, fontPx);
    if (width <= maxWidth || !current) {
      // A single word wider than the line is split rather than allowed to clip.
      if (width > maxWidth && !current) {
        const pieces = await splitLongWord(word, fontPx, maxWidth, measure);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] ?? '';
        continue;
      }
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

async function splitLongWord(word: string, fontPx: number, maxWidth: number, measure: Measurer): Promise<string[]> {
  const pieces: string[] = [];
  let rest = word;
  while (rest) {
    let take = rest.length;
    while (take > 1 && (await measure(rest.slice(0, take), fontPx)).width > maxWidth) take--;
    pieces.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  return pieces;
}

/**
 * Lines and type sizes for one card on one frame. Steps the heading down (and
 * the sub-line with it) until the wrapped block fits the safe box; at the floor
 * it keeps as many lines as fit rather than drawing over the frame edge.
 */
export async function layoutTextCard(card: TextCard, frame: Frame, measure: Measurer = createMeasurer()): Promise<TextCardLayout> {
  const safe = { width: Math.round(frame.width * (1 - 2 * SAFE_MARGIN)), height: Math.round(frame.height * (1 - 2 * SAFE_MARGIN)) };
  let headingPx = Math.max(MIN_HEADING_PX, Math.round(frame.height * HEADING_SHARE));

  for (;;) {
    const sublinePx = Math.max(MIN_HEADING_PX * SUBLINE_RATIO, Math.round(headingPx * SUBLINE_RATIO));
    const headingLines = await wrapMeasured(card.heading, headingPx, safe.width, measure);
    const sublineLines = card.subline ? await wrapMeasured(card.subline, sublinePx, safe.width, measure) : [];
    const blockHeight = Math.round(headingLines.length * headingPx * LINE_SPACING + sublineLines.length * sublinePx * LINE_SPACING);
    if (blockHeight <= safe.height || headingPx <= MIN_HEADING_PX) {
      const fitted = blockHeight <= safe.height
        ? { headingLines, sublineLines, blockHeight }
        : trimToFit(headingLines, sublineLines, headingPx, sublinePx, safe.height);
      return { headingPx, sublinePx, ...fitted, safe };
    }
    headingPx = Math.max(MIN_HEADING_PX, Math.round(headingPx * 0.9));
  }
}

/** At the smallest readable size, drop lines that would fall outside the frame. */
function trimToFit(headingLines: string[], sublineLines: string[], headingPx: number, sublinePx: number, maxHeight: number) {
  const headingStep = headingPx * LINE_SPACING;
  const sublineStep = sublinePx * LINE_SPACING;
  const keptHeading = headingLines.slice(0, Math.max(1, Math.floor(maxHeight / headingStep)));
  const remaining = maxHeight - keptHeading.length * headingStep;
  const keptSubline = sublineLines.slice(0, Math.max(0, Math.floor(remaining / sublineStep)));
  return {
    headingLines: keptHeading,
    sublineLines: keptSubline,
    blockHeight: Math.round(keptHeading.length * headingStep + keptSubline.length * sublineStep),
  };
}

// ---------------------------------------------------------------------------
// ASS
// ---------------------------------------------------------------------------

/** libass numpad alignment: 8 top-centre, 5 middle-centre, 2 bottom-centre. */
const ALIGNMENT: Record<TextCardPosition, number> = { top: 8, middle: 5, bottom: 2 };

export interface TextCardEntry {
  card: TextCard;
  startSec: number;
  /** End of the shot; a card with its own duration ends earlier. */
  endSec: number;
}

export function assTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs === 100 ? 99 : cs).padStart(2, '0')}`;
}

/** `{`, `}` and newlines have meaning in ASS; a card's text must not. */
export function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, ' ');
}

/**
 * One ASS file for every card in the movie. Written with the real frame size as
 * PlayRes, so the measured sizes are the drawn sizes — libass does not rescale.
 */
export async function buildTextCardAss(entries: TextCardEntry[], frame: Frame, measure: Measurer = createMeasurer()): Promise<string> {
  const marginH = Math.round(frame.width * SAFE_MARGIN);
  const marginV = Math.round(frame.height * SAFE_MARGIN);
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${frame.width}`,
    `PlayResY: ${frame.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  ];
  const events = [
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const styles = new Map<string, string>();
  for (const [index, entry] of entries.entries()) {
    const layout = await layoutTextCard(entry.card, frame, measure);
    const styleName = `card_${entry.card.position}_${layout.headingPx}`;
    if (!styles.has(styleName)) {
      styles.set(styleName, `Style: ${styleName},Arial,${layout.headingPx},&H00FFFFFF,&H000000FF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(layout.headingPx * 0.06))},${Math.max(1, Math.round(layout.headingPx * 0.04))},${ALIGNMENT[entry.card.position]},${marginH},${marginH},${marginV},1`);
    }
    const heading = layout.headingLines.map(escapeAssText).join('\\N');
    const subline = layout.sublineLines.length
      ? `\\N{\\fs${layout.sublinePx}}${layout.sublineLines.map(escapeAssText).join('\\N')}`
      : '';
    const end = entry.card.durationSec !== undefined
      ? Math.min(entry.endSec, entry.startSec + entry.card.durationSec)
      : entry.endSec;
    if (end <= entry.startSec) continue;
    events.push(`Dialogue: ${index},${assTimestamp(entry.startSec)},${assTimestamp(end)},${styleName},,0,0,0,,${heading}${subline}`);
  }

  if (events.length <= 3) return '';
  return [...head, ...styles.values(), ...events, ''].join('\n');
}

/** Cards from shots in order, each over its own stretch of the timeline. */
export function entriesFromShots(shots: Array<{ textCard?: TextCard | null; durationSec?: number }>): TextCardEntry[] {
  const entries: TextCardEntry[] = [];
  let at = 0;
  for (const shot of shots) {
    const duration = typeof shot.durationSec === 'number' && shot.durationSec > 0 ? shot.durationSec : 5;
    if (shot.textCard) entries.push({ card: shot.textCard, startSec: at, endSec: at + duration });
    at += duration;
  }
  return entries;
}

export { TEXT_CARD_POSITIONS };
