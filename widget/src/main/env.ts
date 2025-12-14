import { app } from 'electron';

// Webpack-defined global for compile-time dead code elimination
declare const IS_RELEASE_BUILD: boolean | undefined;

// Determine packaging/dev/test/demo modes in one place.
export const isPackagedBuild = app?.isPackaged === true;

export const isProduction = isPackagedBuild || process.env.NODE_ENV === 'production';
export const isDevelopment = !isPackagedBuild && process.env.NODE_ENV === 'development';

// E2E detection: enable when running under test or when SADIE_E2E is explicitly set.
// Do NOT gate this by packaging here so Playwright-packaged runs can enable E2E.
export const isE2E = (process.env.NODE_ENV === 'test') || (process.env.SADIE_E2E === '1' || process.env.SADIE_E2E === 'true');

export const isDemoMode = process.argv?.includes('--demo') || process.env.SADIE_DEMO_MODE === '1' || process.env.SADIE_DEMO_MODE === 'true';

// Runtime mode: determines security and feature levels
export type RuntimeMode = 'demo' | 'beta' | 'prod';
export function getRuntimeMode(): RuntimeMode {
  if (isDemoMode) return 'demo';
  if (process.argv?.includes('--beta') || process.env.SADIE_BETA === '1') return 'beta';
  return 'prod';
}

// Hard safety: use webpack-defined global for compile-time dead code elimination
// Consider E2E explicitly: even in packaged or release builds we should
// preserve E2E mode when `SADIE_E2E` or `NODE_ENV=test` is set so that
// Playwright-packaged test runs still behave like E2E runs.
export const isReleaseBuild = (((typeof IS_RELEASE_BUILD !== 'undefined' && IS_RELEASE_BUILD) || (app?.isPackaged === true)) && !isE2E);

/**
 * Sanitize environment for packaged builds. Removes or ignores test/dev flags
 * so that a user or external process cannot flip test behavior in a shipped app.
 */
export function sanitizeEnvForPackaged() {
  // Only aggressively sanitize environment for true release builds.
  if (!isReleaseBuild) return;

  if (process.env.SADIE_E2E) {
    console.warn('[SADIE] Removing SADIE_E2E in release build');
    delete process.env.SADIE_E2E;
  }
  if (process.env.SADIE_DIRECT_OLLAMA) {
    console.warn('[SADIE] Removing SADIE_DIRECT_OLLAMA in release build');
    delete process.env.SADIE_DIRECT_OLLAMA;
  }
  // Do not allow demo mode to be set via ENV in release builds
  if (process.env.SADIE_DEMO_MODE) {
    console.warn('[SADIE] Removing SADIE_DEMO_MODE in release build');
    delete process.env.SADIE_DEMO_MODE;
  }
}

export default {
  isPackagedBuild,
  isProduction,
  isDevelopment,
  isE2E,
  isDemoMode,
  getRuntimeMode,
  sanitizeEnvForPackaged
};
