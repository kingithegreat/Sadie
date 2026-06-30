/**
 * Focused lint config. Intentionally narrow: it enforces only the React Hooks
 * rules, because a `react-hooks/rules-of-hooks` violation in ConversationSidebar
 * (a hook called after an early `return null`) shipped a real bug — the
 * conversations panel silently never opened. `rules-of-hooks` is an ERROR (these
 * are always real bugs); `exhaustive-deps` is a WARN (advisory, non-blocking).
 *
 * This is not a full style lint — it deliberately leaves other rules off so the
 * gate stays green and meaningful rather than drowning in pre-existing noise.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  // @typescript-eslint is declared (not enabled) only so the existing inline
  // `// eslint-disable @typescript-eslint/...` directives in source resolve to a
  // known rule instead of erroring "Definition for rule ... was not found".
  plugins: ['react-hooks', '@typescript-eslint'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  ignorePatterns: [
    'node_modules/**',
    'out/**',
    'dist/**',
    'dist-electron/**',
    'playwright-report/**',
    'test-results/**',
    '**/*.js',
    '**/*.cjs',
    '**/*.mjs',
  ],
};
