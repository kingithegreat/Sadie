/**
 * migrate-userdata.ts — one-time rescue of the pre-rename profile.
 *
 * PR #89 renamed the product SADIE -> HomeBot, which silently changed
 * app.getPath('userData') from %APPDATA%\SADIE to %APPDATA%\HomeBot. The app
 * started fresh and every existing user's conversations, memory, RAG index,
 * automations and quiz progress were stranded in the old folder — an update
 * that presents as "everything got deleted".
 *
 * Policy, deliberately conservative:
 *  - copy, never move: the old folder stays untouched as the fallback.
 *  - never overwrite: anything the new profile already wrote wins. In
 *    particular user-settings.json is EXCLUDED outright — the new one carries
 *    post-rename fixes; resurrecting the stale one would undo them.
 *  - app-owned files only. Chromium internals (IndexedDB, Local Storage,
 *    Cache, Partitions...) are engine state, unsafe to graft between profiles
 *    and worth nothing here — chat drafts at most.
 *  - one shot, marker-gated: a marker in the NEW profile records the outcome;
 *    reruns are no-ops even if a copy partially failed (the old dir still
 *    exists for a manual retry — logged loudly in that case).
 */

import * as fs from 'fs';
import * as path from 'path';

const MARKER = '.sadie-migration-v1.json';

/** App-owned entries worth rescuing, relative to the profile root. */
const RESCUE_ENTRIES = [
  'config',           // conversations + app config (settings excluded below)
  'memory',           // RAG index
  'databases',
  'logs',
  'automations.json',
  'quiz-progress.json',
];

/** Files that must never migrate, even inside a rescued directory. */
const EXCLUDE_BASENAMES = new Set(['user-settings.json']);

export interface MigrationReport {
  ran: boolean;
  copied: string[];
  skippedExisting: number;
  errors: string[];
}

/** Recursive copy-if-absent. Existing targets always win. */
function copyMissing(src: string, dst: string, report: MigrationReport): void {
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (EXCLUDE_BASENAMES.has(entry)) continue;
      copyMissing(path.join(src, entry), path.join(dst, entry), report);
    }
    return;
  }

  if (fs.existsSync(dst)) {
    report.skippedExisting++;
    return;
  }
  fs.copyFileSync(src, dst);
  report.copied.push(dst);
}

/**
 * Pure worker — paths injected so tests run against tmp dirs with no electron.
 */
export function migrateLegacyUserData(oldDir: string, newDir: string): MigrationReport {
  const report: MigrationReport = { ran: false, copied: [], skippedExisting: 0, errors: [] };

  const marker = path.join(newDir, MARKER);
  try {
    if (fs.existsSync(marker)) return report;           // already handled
    if (!fs.existsSync(oldDir)) return report;          // nothing to rescue
    if (path.resolve(oldDir) === path.resolve(newDir)) return report;
  } catch {
    return report;
  }

  report.ran = true;
  for (const entry of RESCUE_ENTRIES) {
    const src = path.join(oldDir, entry);
    try {
      if (!fs.existsSync(src) || EXCLUDE_BASENAMES.has(entry)) continue;
      copyMissing(src, path.join(newDir, entry), report);
    } catch (e: any) {
      // Keep going: one unreadable file must not strand the other 169
      // conversations. The error lands in the marker for later diagnosis.
      report.errors.push(`${entry}: ${e?.message || e}`);
    }
  }

  try {
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({
      migratedFrom: oldDir,
      copiedCount: report.copied.length,
      skippedExisting: report.skippedExisting,
      errors: report.errors,
      // Old dir is deliberately left in place as the manual fallback.
    }, null, 2), 'utf-8');
  } catch (e: any) {
    report.errors.push(`marker: ${e?.message || e}`);
  }

  return report;
}

/** Electron entry point — resolves the two profile paths and runs the rescue. */
export function migrateLegacyUserDataIfNeeded(): MigrationReport {
  try {
    // Lazy require keeps this module importable under plain node/jest.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    const newDir = app.getPath('userData');
    const oldDir = path.join(path.dirname(newDir), 'SADIE');
    const report = migrateLegacyUserData(oldDir, newDir);
    if (report.ran) {
      console.log(
        `[MIGRATE] SADIE -> HomeBot profile rescue: ${report.copied.length} copied, ` +
        `${report.skippedExisting} already present, ${report.errors.length} errors`,
      );
      if (report.errors.length) console.error('[MIGRATE] errors:', report.errors);
    }
    return report;
  } catch (e) {
    console.error('[MIGRATE] skipped (no electron app):', e);
    return { ran: false, copied: [], skippedExisting: 0, errors: [String(e)] };
  }
}
