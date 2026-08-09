/**
 * Icon set — replaces emoji in chrome (headers, toolbars, buttons).
 *
 * Emoji were the single biggest thing making the UI read as homemade: they
 * render differently per platform, can't be recoloured or aligned to a grid,
 * and sit at an inconsistent optical weight. These are inline SVGs instead —
 * no dependency (this repo's npm installs keep tripping native rebuilds, and
 * ~14 icons don't justify a package), and they inherit `currentColor` so they
 * follow the theme.
 *
 * Drawn in SF Symbols' idiom: 24×24 box, 1.75 stroke, round caps and joins,
 * consistent optical weight. Emoji remain fine in *content* (chat, empty
 * states) — this is only for chrome.
 */

export type IconName =
  | 'refresh' | 'library' | 'tools' | 'terminal' | 'analytics' | 'bell'
  | 'settings' | 'menu' | 'close' | 'dashboard' | 'chat' | 'sparkle'
  | 'image' | 'document' | 'globe' | 'stop' | 'send' | 'chevronDown';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Decorative by default; pass a label when the icon is the only content. */
  label?: string;
}

const PATHS: Record<IconName, JSX.Element> = {
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>,
  library: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
  tools: <path d="M14.7 6.3a4 4 0 0 0 5 5l-9.6 9.6a2.1 2.1 0 0 1-3-3L16.7 8.3" />,
  terminal: <><path d="m4 17 6-5-6-5" /><path d="M12 19h8" /></>,
  analytics: <><path d="M3 3v18h18" /><path d="m7 15 4-5 4 3 5-7" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a2 2 0 0 0 3.4 0" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  menu: <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  chat: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 4 11.5a8.4 8.4 0 0 1 8.5-8.4h.5a8.4 8.4 0 0 1 8 8.4Z" />,
  sparkle: <><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="m5.6 5.6 2.8 2.8" /><path d="m15.6 15.6 2.8 2.8" /><path d="m18.4 5.6-2.8 2.8" /><path d="m8.4 15.6-2.8 2.8" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="9" cy="9" r="1.6" /><path d="m21 15-4.6-4.6a2 2 0 0 0-2.8 0L3 21" /></>,
  document: <><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" /><path d="M14 2v5h5" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  send: <><path d="m21 3-9 18-2.5-7.5L2 11Z" /><path d="M21 3 9.5 13.5" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
};

export default function Icon({ name, size = 18, className, label }: IconProps) {
  return (
    <svg
      className={className ? `hb-icon ${className}` : 'hb-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
