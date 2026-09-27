import '@testing-library/jest-dom';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * G-3 (issue #229) — one temp root per test file, so no file can inherit another's state.
 *
 * Suites point the electron mock's `userData` at `os.tmpdir()`, and settings, movie
 * projects, card previews and QA fixtures are all resolved underneath it. That made
 * one run's files share directories: a file that saved a setting changed the
 * behaviour of whichever suite ran after it, and because jest picks file order from
 * cached durations, the victim was a different suite on different runs. The channel
 * is real and was proved with a two-file probe — before this, a marker one file wrote
 * through the real `config-manager` was read by another file; after, it is not.
 *
 * Patching `tmpdir` rather than the product's own path resolution matters: a suite
 * that deliberately chooses its own userData (e.g. `TEST_USERDATA` in
 * `config-manager.test.ts`, or `HOMEBOT_QA_TEST_USER_DATA`) must keep winning, and it
 * does — this only changes the shared default the rest of the run falls back to.
 *
 * `require` rather than an ESM import on purpose: `import * as os` is compiled to a
 * getter-only copy of the module, and assigning to that throws "Cannot set property
 * tmpdir". The patch has to land on the real module object that product code reads.
 *
 * The original `tmpdir` is captured ONCE and remembered on that module object,
 * because core modules are shared process-wide while jest gives each test file its
 * own `process`: capturing per file would make each file's root a child of the
 * previous file's, and the paths would grow until Windows refuses them (that
 * produced 63 "Test suite failed to run" errors in the first version of this patch).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const osModule = require('node:os') as { tmpdir: () => string; __homebotRealTmpdir?: () => string };
if (!osModule.__homebotRealTmpdir) osModule.__homebotRealTmpdir = osModule.tmpdir.bind(osModule);
const realTmpdir = osModule.__homebotRealTmpdir;
const testPath = expect.getState().testPath;
// testPath is the file's absolute path when jest has set it; the fallback keeps a
// module-scope call before the first hook resolving to one stable directory.
const slug = testPath ? testPath.replace(/[^a-zA-Z0-9]+/g, '-').slice(-80) : randomUUID();
const perFileTmp = join(realTmpdir(), 'homebot-jest-tmp', slug);
// Cleared and recreated, so a file never inherits its own previous run's leftovers
// either — and so the per-file roots cannot grow without bound on disk. Best effort
// on purpose: on Windows the delete can transiently hit ENOTEMPTY/EBUSY while
// something still holds a handle, and hygiene must never fail a suite at setup —
// the worst case of giving up is reusing one file's own directory, which is
// exactly the isolation this run already had.
try {
  rmSync(perFileTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch { /* best effort */ }
mkdirSync(perFileTmp, { recursive: true });
osModule.tmpdir = () => perFileTmp;

// Polyfill scrollIntoView for JSDOM (missing DOM API)
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  // @ts-ignore - jsdom doesn't declare scrollIntoView by default
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// Provide a minimal window.electron so tests can override as needed.
if (typeof window !== 'undefined' && !(window as any).electron) {
  (window as any).electron = {};
}
