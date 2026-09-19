/**
 * MS-5 — a title card over a shot: one heading, an optional sub-line.
 *
 * Shared because the panel writes it, the storyboard tool saves it, and the
 * renderer draws it. Kept deliberately small: what it says, where it sits, and
 * how long it stays. Everything about how it LOOKS is measured at render time
 * against the real frame size (movie/text-cards.ts), because a size that fits
 * 1920x1080 clips at 1080x1920.
 */

export const TEXT_CARD_POSITIONS = ['top', 'middle', 'bottom'] as const;
export type TextCardPosition = (typeof TEXT_CARD_POSITIONS)[number];

export interface TextCard {
  heading: string;
  subline?: string;
  position: TextCardPosition;
  /** Seconds from the start of the shot. Absent means the whole shot. */
  durationSec?: number;
}

export const TEXT_CARD_HEADING_MAX = 120;
export const TEXT_CARD_SUBLINE_MAX = 200;

/**
 * A card from untrusted input (chat tool, saved file, panel), or null when
 * there is nothing to draw. A card with no heading is not a card.
 */
export function sanitizeTextCard(value: unknown): TextCard | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const clean = (text: unknown, max: number): string =>
    typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const heading = clean(raw.heading, TEXT_CARD_HEADING_MAX);
  if (!heading) return null;
  const subline = clean(raw.subline, TEXT_CARD_SUBLINE_MAX);
  const position = TEXT_CARD_POSITIONS.includes(raw.position as TextCardPosition)
    ? (raw.position as TextCardPosition) : 'bottom';
  const duration = typeof raw.durationSec === 'number' && Number.isFinite(raw.durationSec) && raw.durationSec > 0
    ? Math.min(3600, Math.round(raw.durationSec * 100) / 100) : undefined;
  return { heading, ...(subline ? { subline } : {}), position, ...(duration !== undefined ? { durationSec: duration } : {}) };
}
