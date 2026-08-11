/**
 * The startup log had no writer for seven months.
 *
 * initLogging() and logStartup() were exported, unit-tested, and called by
 * nothing in production — the tests passed because they invoke the functions
 * directly. The last line in startup.log on the dev machine was dated
 * 2026-01-23 and still said "SADIE".
 *
 * That is why a failing assistant bridge left no durable trace: its only
 * signal went to a console silenced in packaged builds, and the file that
 * should have caught it had no caller. A subsystem that cannot say why it
 * failed cannot be diagnosed from a user's machine — which is the whole point
 * of shipping a log.
 *
 * Source-read rather than imported: index.ts pulls in Electron and the entire
 * main process.
 */

import * as fs from 'fs';
import * as path from 'path';

const mainSrc = fs.readFileSync(path.resolve(__dirname, '..', 'index.ts'), 'utf-8');

describe('startup logging is actually wired', () => {
  it('imports the logger', () => {
    expect(mainSrc).toMatch(/import \{[^}]*initLogging[^}]*\} from '\.\/utils\/logger'/);
  });

  it('calls initLogging() during startup', () => {
    expect(mainSrc).toMatch(/\binitLogging\(\)/);
  });

  it('writes at least one startup line to disk', () => {
    expect(mainSrc).toMatch(/logStartup\(/);
  });

  it('records the assistant bridge outcome durably, not only in memory', () => {
    // The in-memory buffer dies with the process; the bridge's state is
    // exactly what someone needs AFTER a bad session.
    expect(mainSrc).toMatch(/logStartup\(okLine\)/);
    expect(mainSrc).toMatch(/logStartup\(failLine\)/);
  });

  it('logging failures never take startup down', () => {
    // A logger that can crash the app is worse than no logger.
    // Match the CALL, not the mention of it in the comment above — the first
    // occurrence in the file is prose explaining why this exists.
    const idx = mainSrc.search(/^\s+initLogging\(\);/m);
    expect(idx).toBeGreaterThan(-1);
    const window = mainSrc.slice(Math.max(0, idx - 200), idx + 200);
    expect(window).toMatch(/try\s*\{/);
    expect(window).toMatch(/catch/);
  });
});
