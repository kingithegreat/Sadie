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
import * as path from 'path';

const script = path.resolve(__dirname, '..', '..', 'scripts', 'check-docs-drift.mjs');

describe('docs/api-reference.md', () => {
  it('lists the complete preload + IPC surface', () => {
    try {
      execFileSync(process.execPath, [script], { encoding: 'utf-8', stdio: 'pipe' });
    } catch (err: any) {
      const detail = String(err?.stderr || err?.stdout || err?.message || '').trim();
      throw new Error(
        `The API reference is out of date with the source.\n` +
        `Run: npm run docs:write\n\n${detail}`,
      );
    }
  });
});
