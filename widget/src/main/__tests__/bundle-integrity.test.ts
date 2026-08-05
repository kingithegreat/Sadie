/**
 * bundle-integrity.test.ts
 *
 * Guards a bug class that every other check misses.
 *
 * electron-vite bundles the whole main process into a single
 * `out/main/index.js`. A static `import` is resolved and inlined by rollup, but
 * a runtime `require('./thing')` is emitted verbatim — and at runtime there is
 * no `./thing` beside the bundle, so it throws MODULE_NOT_FOUND.
 *
 * Nothing else catches it: tsc resolves the path fine, unit tests import the
 * module directly, and the build emits no warning. It fails only in a real
 * built app — which is exactly the surface nobody runs.
 *
 * Four instances had shipped before this test existed:
 *   - index.ts               → morning briefing never ran (threw loudly)
 *   - permission-requester   → configurable prompt timeout silently ignored
 *   - tools/vision.ts        → visionModel / ollamaUrl settings silently ignored
 *   - tools/system.ts        → open_in_browser threw
 *
 * Three of the four failed *silently* into a fallback, which is why they
 * survived so long.
 */

import * as fs from 'fs';
import * as path from 'path';

const MAIN_DIR = path.resolve(__dirname, '..');

/** Node builtins and packages resolve fine at runtime; only relative paths break. */
const RELATIVE_REQUIRE = /\brequire\s*\(\s*['"`]\.\.?\//;

/** Strip comments so prose *about* the anti-pattern isn't flagged as the anti-pattern. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      collectTsFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('main process bundle integrity', () => {
  const files = collectTsFiles(MAIN_DIR);

  test('finds main-process sources to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test('no relative runtime require() — they do not survive bundling', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (RELATIVE_REQUIRE.test(line)) {
          offenders.push(`${path.relative(MAIN_DIR, file)}:${i + 1}  ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  test('the detector actually detects (guards against a vacuous pass)', () => {
    // A test that can only pass is worthless; prove the regex fires.
    expect(RELATIVE_REQUIRE.test(`const x = require('./config-manager');`)).toBe(true);
    expect(RELATIVE_REQUIRE.test(`const y = require("../config-manager");`)).toBe(true);
    expect(RELATIVE_REQUIRE.test(`const z = require( './spaced' );`)).toBe(true);
    // Builtins and packages are fine — they resolve at runtime.
    expect(RELATIVE_REQUIRE.test(`const { shell } = require('electron');`)).toBe(false);
    expect(RELATIVE_REQUIRE.test(`const fs = require('fs');`)).toBe(false);
  });

  test('comment stripping does not hide a real offender on the same line', () => {
    const src = `const a = require('./real'); // require('./mentioned-in-a-comment')`;
    expect(RELATIVE_REQUIRE.test(stripComments(src))).toBe(true);
  });

  test('prose about the anti-pattern is not flagged', () => {
    const src = `// a bare require('./morning-briefing') resolves to nothing\n/* require('../x') */\nconst ok = 1;`;
    expect(RELATIVE_REQUIRE.test(stripComments(src))).toBe(false);
  });
});
