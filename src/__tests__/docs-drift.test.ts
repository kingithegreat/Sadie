/**
 * Docs drift gate.
 *
 * docs/api-reference.md fell 39 IPC channels and 102 preload methods behind
 * the source before anyone noticed, because nothing checked. A reference that
 * silently lists a third of the surface is worse than one that admits its
 * scope: readers assume it is complete.
 *
 * This runs the same check as `npm run docs:check`, so adding an IPC channel
 * or preload method without regenerating the index fails the suite rather
 * than rotting for two months.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const script = path.resolve(__dirname, '..', '..', 'scripts', 'check-docs-drift.mjs');
const doc = path.resolve(__dirname, '..', '..', 'docs', 'api-reference.md');

const runCheck = () =>
  execFileSync(process.execPath, [script], { encoding: 'utf-8', stdio: 'pipe' });

describe('docs/api-reference.md', () => {
  it('lists the complete preload + IPC surface', () => {
    try {
      runCheck();
    } catch (err: any) {
      const detail = String(err?.stderr || err?.stdout || err?.message || '').trim();
      throw new Error(
        `The API reference is out of date with the source.\n` +
        `Run: npm run docs:write\n\n${detail}`,
      );
    }
  });

  it('does not report drift over line endings alone', () => {
    // The index is generated with \n, but git checks this file out with \r\n
    // on Windows. A raw comparison called that drift, so the check failed on
    // every fresh Windows checkout; running the suggested docs:write then
    // produced a diff git normalised away to nothing. A guard that cries wolf
    // and offers a fix that changes nothing is one people learn to ignore.
    const original = fs.readFileSync(doc);
    try {
      const crlf = original.toString('utf-8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
      fs.writeFileSync(doc, crlf, 'utf-8');
      expect(() => runCheck()).not.toThrow();
    } finally {
      // Restore the bytes exactly, whatever the assertion did.
      fs.writeFileSync(doc, original);
    }
  });
});
