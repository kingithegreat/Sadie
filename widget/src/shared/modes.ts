/**
 * Canonical UI modes, shared between renderer (App.tsx owns the switch),
 * preload (event surface) and main (the navigate_to_mode tool validates
 * against this list before forwarding). One source of truth so a new panel
 * cannot be added to one layer and forgotten in another.
 */
export const APP_MODES = [
  'chat',
  'automation',
  'image',
  'documents',
  'quiz',
  'dashboard',
  'media',
  'browser',
  'code',
] as const;

export type AppMode = (typeof APP_MODES)[number];

export function isAppMode(value: unknown): value is AppMode {
  return typeof value === 'string' && (APP_MODES as readonly string[]).includes(value);
}
