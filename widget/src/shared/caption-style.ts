/**
 * How burned-in captions look: one saved choice per Storyboard project or
 * Media Studio video, shared by both render paths. Pure and dependency-free so
 * the renderer UI, the tools and the FFmpeg style builder agree on one shape.
 *
 * The default reproduces the captions every export had before this existed
 * (bold white Arial, black outline, bottom centre), so saved projects render
 * exactly as they did.
 */

export type CaptionSize = 'small' | 'medium' | 'large';
export type CaptionPosition = 'bottom' | 'middle' | 'top';
export type CaptionBackground = 'outline' | 'box';

/** Fonts every Windows install ships, so a render never silently substitutes. */
export const CAPTION_FONTS = ['Arial', 'Segoe UI', 'Verdana', 'Georgia', 'Impact', 'Trebuchet MS'] as const;
export type CaptionFont = typeof CAPTION_FONTS[number];

export interface CaptionStyle {
  size: CaptionSize;
  position: CaptionPosition;
  font: CaptionFont;
  /** Text colour, #rrggbb. */
  color: string;
  /** Black outline around the letters, or a dark box behind the line. */
  background: CaptionBackground;
}

export const DEFAULT_CAPTION_STYLE: Readonly<CaptionStyle> = Object.freeze({
  size: 'medium', position: 'bottom', font: 'Arial', color: '#ffffff', background: 'outline',
});

const SIZES: readonly CaptionSize[] = ['small', 'medium', 'large'];
const POSITIONS: readonly CaptionPosition[] = ['bottom', 'middle', 'top'];
const BACKGROUNDS: readonly CaptionBackground[] = ['outline', 'box'];

/**
 * A complete, valid style. Missing fields take the default; an invalid value
 * throws with a message a person can act on, rather than rendering something
 * other than what they chose.
 */
export function resolveCaptionStyle(value: unknown): CaptionStyle {
  if (value === undefined || value === null) return { ...DEFAULT_CAPTION_STYLE };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose valid caption style settings.');
  const v = value as Record<string, unknown>;
  const pick = <T extends string>(key: string, allowed: readonly T[], label: string): T => {
    if (v[key] === undefined) return DEFAULT_CAPTION_STYLE[key as keyof CaptionStyle] as T;
    if (typeof v[key] !== 'string' || !allowed.includes(v[key] as T)) throw new Error(`Choose a supported caption ${label}.`);
    return v[key] as T;
  };
  const color = v.color === undefined ? DEFAULT_CAPTION_STYLE.color : v.color;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Choose a caption colour like #ffffff.');
  return {
    size: pick('size', SIZES, 'size'),
    position: pick('position', POSITIONS, 'position'),
    font: pick('font', CAPTION_FONTS, 'font'),
    color: color.toLowerCase(),
    background: pick('background', BACKGROUNDS, 'background'),
  };
}

/** True when the style would render differently from the default. */
export function isCustomCaptionStyle(value: unknown): boolean {
  try {
    const style = resolveCaptionStyle(value);
    return (Object.keys(DEFAULT_CAPTION_STYLE) as Array<keyof CaptionStyle>).some(key => style[key] !== DEFAULT_CAPTION_STYLE[key]);
  } catch {
    return false;
  }
}
