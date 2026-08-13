/**
 * The HomeBot mark.
 *
 * Replaces the letter "S" that shipped as the app icon — left over from the
 * SADIE name and wrong on every surface since the rename.
 *
 * The mark is a speech bubble with a gabled roof: the thing HomeBot is, in one
 * shape. An assistant that lives on your own machine rather than in somebody's
 * cloud, and that you reach by talking to it. The tail is what makes it a
 * conversation rather than a house, and the dot inside is the same dot the
 * titlebar already uses for connection state, so the mark and the status
 * indicator are visibly the same family.
 *
 * Drawn to survive 16px. At taskbar size the dot and the tail are the only
 * details that read, which is why everything else is a plain silhouette.
 */

import React from 'react';

/**
 * The glyph, on a 24 grid, identical to resources/brand/homebot-mark.svg —
 * which is what the installer, taskbar and window icons are generated from.
 * Keep the two in step: if you change one, run `node scripts/build-icons.mjs`.
 */
const HOUSE_BUBBLE =
  'M12 2.8 20.4 9.6V17.5A2.4 2.4 0 0 1 18 19.9H13.4L10.4 23.2 10.8 19.9H6A2.4 2.4 0 0 1 3.6 17.5V9.6Z';

/** The face: a pill with two eyes knocked out of it, so it reads on any ground. */
const FACE =
  'M10.35 11.5H13.65A3.05 3.05 0 0 1 13.65 17.6H10.35A3.05 3.05 0 0 1 10.35 11.5ZM11.65 14.55A1.05 1.05 0 1 1 9.55 14.55A1.05 1.05 0 1 1 11.65 14.55ZM14.45 14.55A1.05 1.05 0 1 1 12.35 14.55A1.05 1.05 0 1 1 14.45 14.55Z';

export interface LogoProps {
  /**
   * `badge` — the filled brand tile used in the app chrome.
   * `mark`  — a monochrome glyph that inherits currentColor, for places that
   *           already have their own colour (menus, print, a disabled state).
   */
  variant?: 'badge' | 'mark';
  size?: number | string;
  className?: string;
  title?: string;
}

export const Logo: React.FC<LogoProps> = ({
  variant = 'badge',
  size = 28,
  className,
  title = 'HomeBot',
}) => {
  // Gradient ids must be unique per instance: two logos on one page with the
  // same id means the second silently paints with the first one's fill.
  const uid = React.useId().replace(/:/g, '');
  const grad = `hb-logo-grad-${uid}`;

  if (variant === 'mark') {
    return (
      <svg
        className={['hb-logo', className].filter(Boolean).join(' ')}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinejoin="round"
        role="img"
        aria-label={title}
      >
        <path d={HOUSE_BUBBLE} />
        <path d={FACE} fill="currentColor" stroke="none" fillRule="evenodd" />
      </svg>
    );
  }

  return (
    <svg
      className={['hb-logo', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5FB0FF" />
          <stop offset="55%" stopColor="#1E83F7" />
          <stop offset="100%" stopColor="#0A56D6" />
        </linearGradient>
      </defs>
      {/* The tile is a circle so it stays correct under the existing
          .header-logo rule, which clips its box with border-radius: 50%. */}
      <circle cx="16" cy="16" r="16" fill={`url(#${grad})`} />
      <g transform="translate(4.4 3.6) scale(0.97)">
        <path
          d={HOUSE_BUBBLE}
          fill="none"
          stroke="#fff"
          strokeWidth={1.85}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path d={FACE} fill="#fff" fillRule="evenodd" />
      </g>
    </svg>
  );
};

export interface WordmarkProps {
  /** Diameter of the mark; the text scales from it. */
  size?: number;
  className?: string;
}

/**
 * Mark plus name, for the places that want the full lockup.
 *
 * Live text rather than the HomeBotLogo.png it replaces. That file is a raster
 * with a baked-in white background, so on the dark theme it appeared as a white
 * slab — and the stylesheet had grown a translucent white plate behind it to
 * make the slab look deliberate. Text that takes its colour from the theme
 * cannot have that problem, and stays sharp at any size.
 */
export const Wordmark: React.FC<WordmarkProps> = ({ size = 48, className }) => (
  <div className={['hb-wordmark', className].filter(Boolean).join(' ')}>
    <Logo variant="badge" size={size} title="HomeBot" />
    <span className="hb-wordmark-text" style={{ fontSize: Math.round(size * 0.72) }}>
      Home<span className="hb-wordmark-accent">Bot</span>
    </span>
  </div>
);

export default Logo;
