import { resolveTheme, followsSystem, systemPrefersDark, FALLBACK_THEME } from '../theme';

describe('resolveTheme', () => {
  it('returns explicit settings unchanged, ignoring the OS', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('follows the OS only when the setting is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('never returns "system" — callers must only ever see a renderable state', () => {
    // This is the actual bug this module was written to kill: the app root
    // used to receive the raw setting, so it carried data-theme="system",
    // which no stylesheet matches and which left the panel unthemed.
    for (const osPrefersDark of [true, false]) {
      for (const setting of ['dark', 'light', 'system', undefined, null, 'sepia']) {
        const out = resolveTheme(setting as never, osPrefersDark);
        expect(out === 'dark' || out === 'light').toBe(true);
      }
    }
  });

  it('falls back to dark for missing or unrecognised settings', () => {
    expect(resolveTheme(undefined, false)).toBe(FALLBACK_THEME);
    expect(resolveTheme(null, false)).toBe(FALLBACK_THEME);
    expect(resolveTheme('', false)).toBe(FALLBACK_THEME);
    expect(resolveTheme('midnight', false)).toBe(FALLBACK_THEME);
    expect(FALLBACK_THEME).toBe('dark');
  });
});

describe('followsSystem', () => {
  it('is true only for the system setting', () => {
    expect(followsSystem('system')).toBe(true);
    expect(followsSystem('dark')).toBe(false);
    expect(followsSystem('light')).toBe(false);
    expect(followsSystem(undefined)).toBe(false);
  });
});

describe('systemPrefersDark', () => {
  const original = window.matchMedia;
  afterEach(() => {
    (window as unknown as { matchMedia: unknown }).matchMedia = original;
  });

  it('reports the OS preference when matchMedia is available', () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
      matches: q.includes('dark'),
      media: q,
    });
    expect(systemPrefersDark()).toBe(true);
  });

  it('defaults to dark when matchMedia is missing, not light', () => {
    // A dark-first app must never fall into a light flash because an API was
    // unavailable — that reads to the user as "dark mode is broken".
    (window as unknown as { matchMedia: unknown }).matchMedia = undefined;
    expect(systemPrefersDark()).toBe(true);
  });

  it('defaults to dark when matchMedia throws', () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => {
      throw new Error('not supported');
    };
    expect(systemPrefersDark()).toBe(true);
  });
});
