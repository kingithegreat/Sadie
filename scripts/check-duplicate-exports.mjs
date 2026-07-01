#!/usr/bin/env node
/**
 * Duplicate-export guard.
 * ---------------------------------------------------------------------------
 * Mechanical collision detector: fails CI when a newly ADDED file exports a
 * top-level identifier that another (pre-existing) file already exports.
 *
 * This exists because a sibling project (Vacuum Empire) had two independent
 * sessions build two incompatible "cosmetics" systems in the same repo
 * without either checking the other existed (see CLAIMS.md and the Notion
 * "Work Claims Ledger"). Sadie's Step 1 licensing/entitlements scaffold also
 * shipped with a channel-name mismatch that would have been unreachable in
 * the real app — a variant of the same "built without checking the existing
 * integration point" failure mode. A written rule to "check first" is
 * skippable; this check is not — it runs on every PR.
 *
 * It is a heuristic, not a type checker: same-named exports are flagged even
 * when unrelated (false positives happen), and genuinely different names for
 * the same concept are not caught (false negatives happen). When a flagged
 * pair is a real, deliberate rename/extension rather than a collision, note
 * it in CLAIMS.md under "Known non-duplicates" with the exact identifier
 * name to suppress it.
 *
 * Usage: node scripts/check-duplicate-exports.mjs [baseRef]
 * baseRef defaults to $GITHUB_BASE_REF or 'main'.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Sadie has two source trees: repo-root src/ (pure, testable modules like
// licensing/entitlements) and widget/src/ (the actual Electron app).
const SRC_DIRS = ['src', 'widget/src'];
const EXT_RE = /\.(ts|tsx)$/;
const EXCLUDE_RE = /(\.test\.|\.spec\.|\.d\.ts$|\/__tests__\/|\/e2e\/|\/node_modules\/)/;

const baseRef = process.argv[2] || process.env.GITHUB_BASE_REF || 'main';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8' }).trim();
}

function listAllTrackedFiles() {
  return sh('git ls-files')
    .split('\n')
    .filter((f) => SRC_DIRS.some((d) => f.startsWith(d + '/')))
    .filter((f) => EXT_RE.test(f) && !EXCLUDE_RE.test(f));
}

function listAddedFiles(base) {
  let diffBase = `origin/${base}`;
  try {
    sh(`git rev-parse --verify ${diffBase}`);
  } catch {
    diffBase = base; // fall back to a local ref (e.g. running outside CI)
  }
  let out;
  try {
    out = sh(`git diff --name-status ${diffBase}...HEAD`);
  } catch {
    console.log(`[duplicate-export-guard] Could not diff against ${diffBase}; skipping (not a PR context?).`);
    return [];
  }
  return out
    .split('\n')
    .filter(Boolean)
    .filter((line) => line.startsWith('A\t'))
    .map((line) => line.slice(2))
    .filter((f) => SRC_DIRS.some((d) => f.startsWith(d + '/')))
    .filter((f) => EXT_RE.test(f) && !EXCLUDE_RE.test(f));
}

// Deliberately simple: catches `export const/function/class/interface/type NAME`.
// Does not resolve re-exports, default exports, or `export { a as b }` renames.
const EXPORT_RE = /^export\s+(?:const|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm;

function extractExports(file) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf-8');
  const names = [];
  let m;
  while ((m = EXPORT_RE.exec(text))) names.push(m[1]);
  return names;
}

function loadSuppressions() {
  if (!existsSync('CLAIMS.md')) return new Set();
  const text = readFileSync('CLAIMS.md', 'utf-8');
  const section = text.split(/##\s*Known non-duplicates/i)[1] || '';
  const names = [...section.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]);
  return new Set(names);
}

function main() {
  const added = listAddedFiles(baseRef);
  if (added.length === 0) {
    console.log('[duplicate-export-guard] No newly added source files in this diff — nothing to check.');
    return;
  }

  const allFiles = listAllTrackedFiles();
  const addedSet = new Set(added);
  const existingFiles = allFiles.filter((f) => !addedSet.has(f));

  const existingExportMap = new Map(); // identifier -> [files]
  for (const f of existingFiles) {
    for (const name of extractExports(f)) {
      if (!existingExportMap.has(name)) existingExportMap.set(name, []);
      existingExportMap.get(name).push(f);
    }
  }

  const suppressed = loadSuppressions();
  const collisions = [];
  for (const f of added) {
    for (const name of extractExports(f)) {
      if (suppressed.has(name)) continue;
      const existingIn = existingExportMap.get(name);
      if (existingIn && existingIn.length > 0) {
        collisions.push({ name, newFile: f, existingFiles: existingIn });
      }
    }
  }

  if (collisions.length === 0) {
    console.log(`[duplicate-export-guard] Checked ${added.length} new file(s), no collisions found.`);
    return;
  }

  console.error('\n[duplicate-export-guard] Possible feature collision(s) detected:\n');
  for (const c of collisions) {
    console.error(`  \`${c.name}\` is exported by NEW file ${c.newFile}`);
    console.error(`    ...and ALSO already exported by: ${c.existingFiles.join(', ')}\n`);
  }
  console.error(
    'Before merging: check the Work Claims Ledger and CLAIMS.md for an existing implementation of this feature.\n' +
    'If this is a genuine duplicate (two independent builds of the same thing), reconcile them — don\'t ship both.\n' +
    'If this is a deliberate, unrelated same-name export, add it under "## Known non-duplicates" in CLAIMS.md\n' +
    '(as `IdentifierName`) to suppress this check.\n'
  );
  process.exitCode = 1;
}

main();
