/**
 * Icon set — replaces emoji in chrome (headers, toolbars, buttons).
 *
 * Emoji were the single biggest thing making the UI read as homemade: they
 * render differently per platform, can't be recoloured or aligned to a grid,
 * and sit at an inconsistent optical weight. These are inline SVGs instead —
 * no dependency (this repo's npm installs keep tripping native rebuilds), and
 * they inherit `currentColor` so they follow the theme.
 *
 * 2026-08 visual pass: every glyph redrawn on the Lucide grid (24×24 box,
 * 1.75 stroke, round caps/joins) so optical weight matches across the set.
 * The worst offenders before were `settings` (a mangled hand-traced gear) and
 * `sparkle` (read as a sun/asterisk rather than AI-magic). Emoji remain fine
 * in *content* (chat, empty states) — this is only for chrome.
 */

export type IconName =
  | 'refresh' | 'library' | 'tools' | 'terminal' | 'analytics' | 'bell'
  | 'settings' | 'menu' | 'close' | 'dashboard' | 'chat' | 'sparkle'
  | 'image' | 'document' | 'globe' | 'stop' | 'send' | 'chevronDown' | 'diff'
  // Chat surface — the composer and the per-message actions, which were still
  // emoji long after the chrome above them stopped being.
  | 'paperclip' | 'mic' | 'copy' | 'check' | 'pencil' | 'speak'
  | 'zap' | 'pause' | 'star' | 'starFilled' | 'spinner'
  // Mode switcher — the last row of the chrome still wearing emoji.
  | 'video' | 'quiz' | 'download' | 'code' | 'plug'
  // Chat surface avatars (replaces the illustrated PNG badges).
  | 'user';

/** Shared by both star states so the outline and the filled one are one shape. */
const STAR = 'M12 3.6l2.6 5.35 5.9.86-4.27 4.16 1.01 5.87L12 17.03l-5.24 2.81 1.01-5.87L3.5 9.81l5.9-.86z';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Decorative by default; pass a label when the icon is the only content. */
  label?: string;
}

const PATHS: Record<IconName, JSX.Element> = {
  // Rotate-cw: a single clean arc with an arrowhead that lands at 3 o'clock.
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" /><path d="M21 3v5h-5" /></>,
  // Book: closed cover with a spine curve — reads as "library" at 16px.
  library: <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />,
  // Wrench: the classic single-stroke spanner, diagonal across the box.
  tools: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  terminal: <><path d="m4 17 6-5-6-5" /><path d="M12 19h8" /></>,
  // Line chart: axis + a rising polyline with one dip, not a zig-zag.
  analytics: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  // Gear: proper symmetric cog (Lucide geometry) + centre hole. The old
  // version was a hand-traced approximation with lumpy teeth.
  settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
  menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  // Message bubble as one continuous stroke — no seam where the tail met.
  chat: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  // Sparkles: one four-point star plus two small companions. The old asterisk
  // burst read as "photo flash"; this reads as generated-by-AI.
  sparkle: <><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /><path d="M20 3v4" /><path d="M22 5h-4" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="9" cy="9" r="1.75" /><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" /></>,
  document: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h5" /></>,
  // Two stacked rows with +/- marks — reads as "changes" at 20px.
  diff: <><path d="M4 5h10" /><path d="M9 3v4" /><path d="M4 15h10" /><path d="M17 7l3 3-3 3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  // Paper plane: nose at top-right like every chat app, one fold line.
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  paperclip: <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  // Mic: rounded capsule + arc stand + stem. The old one had a stray base bar.
  mic: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></>,
  copy: <><rect x="8" y="8" width="14" height="14" rx="2.2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  pencil: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>,
  // Speaker: triangle horn + two arcs, sized down so it optically matches mic.
  speak: <><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>,
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  pause: <path d="M9.5 4.5v15M14.5 4.5v15" />,
  star: <path d={STAR} />,
  starFilled: <path d={STAR} fill="currentColor" />,
  // A gapped ring, spun by CSS. Reads as "working" where the ⏳ it replaces
  // read as "stuck".
  spinner: <circle cx="12" cy="12" r="8.5" strokeDasharray="40 27" />,
  video: <><rect x="2" y="6" width="14" height="12" rx="2.5" /><path d="m22 8-6 4 6 4V8Z" /></>,
  // A question in a circle, for the practice-questions mode.
  quiz: <><circle cx="12" cy="12" r="9" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
  // Code mode — angle brackets only; the terminal glyph already exists and
  // doubling it made both read worse.
  code: <><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></>,
  // Connections mode — a plug, reads as "plugging something in".
  plug: <><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></>,
  // Person — head + shoulders, for the user avatar in chat.
  user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
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
