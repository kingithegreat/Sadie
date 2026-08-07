/**
 * Theme resolution.
 *
 * The app has three theme *settings* ('dark' | 'light' | 'system') but only two
 * theme *states* ('dark' | 'light'). Everything downstream — the `data-theme`
 * attribute, the CSS token overrides, any component that branches on theme —
 * must see a resolved state, never the raw setting.
 *
 * This existed inline in App.tsx and was applied inconsistently: `<html>` and
 * `<body>` got the resolved value while the app root div got the RAW setting,
 * so with the setting on 'system' the root carried `data-theme="system"` — a
 * value no stylesheet matches. Pulling it into one tested function is what
 * stops the two paths drifting again.
 */

export type ThemeSetting = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

/** The theme used when nothing is stored yet. The stylesheet's `:root` block
 *  IS the dark palette (light is applied as a set of overrides), so dark is
 *  the design's true default — anything else means the first paint fights the
 *  base stylesheet. */
export const FALLBACK_THEME: ResolvedTheme = 'dark';

/**
 * Resolve a theme setting to the state the UI should actually render.
 *
 * @param setting     the stored preference; anything unrecognised (undefined,
 *                    null, a stale value from an older build) falls back to
 *                    dark rather than throwing or rendering unstyled
 * @param prefersDark whether the OS currently prefers dark. Passed in rather
 *                    than read from `window` so this stays pure and testable
 *                    outside a browser.
 */
export function resolveTheme(
  setting: ThemeSetting | string | undefined | null,
  prefersDark: boolean,
): ResolvedTheme {
  if (setting === 'dark' || setting === 'light') return setting;
  if (setting === 'system') return prefersDark ? 'dark' : 'light';
  return FALLBACK_THEME;
}

/** True when the setting delegates to the OS, and therefore needs a live
 *  listener — the app must repaint when the OS flips, not only when settings
 *  change. */
export function followsSystem(setting: ThemeSetting | string | undefined | null): boolean {
  return setting === 'system';
}

/** Read the OS preference, guarding environments without matchMedia (jsdom in
 *  tests, older webviews). Defaults to dark so a missing API can never drop
 *  the user into an unreadable light flash on a dark-first app. */
export function systemPrefersDark(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}
