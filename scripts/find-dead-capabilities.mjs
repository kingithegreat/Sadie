#!/usr/bin/env node
/**
 * Finds exported functions that no production code path calls, but tests do.
 *
 * This shape has bitten this codebase repeatedly:
 *   - initLogging()/logStartup() were exported, unit-tested, and called by
 *     nothing. The startup log had no writer for seven months, which is why a
 *     failing assistant bridge left no durable trace.
 *   - git_commit was registered and promised in the system prompt, but missing
 *     from the bridge allowlist, so the assistant could not call it.
 *   - Category tool routing was disabled entirely by a cap set below the core
 *     tool count.
 *
 * The common thread is that tests kept passing throughout: a unit test calls
 * the function directly, so it cannot tell whether anything else does. This
 * script asks the question the tests structurally cannot.
 *
 * ADVISORY, NOT A GATE. Test helpers are legitimate hits by design, and
 * dynamic dispatch (IPC channel names, tool registries) can hide real callers.
 * Read the output; don't wire it into CI as a blocking check.
 *
 *   node scripts/find-dead-capabilities.mjs [rootDir]
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.argv[2] || 'widget/src';

/** Names that are meant to exist only for tests. */
const INTENTIONAL = /^__|ForTests?$|^reset[A-Z]|^clear.*ForTests?$/;

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'out', 'dist', 'build'].includes(e.name)) continue;
      walk(p, acc);
    } else if (/\.tsx?$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

const isTest = p => /__tests__|\.test\.|\.spec\.|[\\/]e2e[\\/]/.test(p);

const all = walk(ROOT);
const prod = all.filter(p => !isTest(p)).map(f => ({ f, s: fs.readFileSync(f, 'utf8') }));
const testBlob = all.filter(isTest).map(f => fs.readFileSync(f, 'utf8')).join('\n');

const word = n => new RegExp(`\\b${n}\\b`, 'g');
const findings = [];

for (const { f, s } of prod) {
  for (const m of s.matchAll(/^export (?:async )?function ([A-Za-z_][A-Za-z0-9_]*)/gm)) {
    const name = m[1];
    if (INTENTIONAL.test(name)) continue;

    let prodUses = 0;
    for (const o of prod) {
      const text = o.f === f
        ? o.s.replace(new RegExp(`export (?:async )?function ${name}\\b`, 'g'), '')
        : o.s;
      prodUses += (text.match(word(name)) || []).length;
    }
    if (prodUses > 0) continue;

    const testUses = (testBlob.match(word(name)) || []).length;
    if (testUses > 0) {
      findings.push({ name, file: path.relative(ROOT, f).replace(/\\/g, '/'), testUses });
    }
  }
}

findings.sort((a, b) => b.testUses - a.testUses);

console.log(`scanned ${prod.length} production files under ${ROOT}\n`);
if (!findings.length) {
  console.log('No exported function is reachable only from tests.');
} else {
  console.log(`${findings.length} exported function(s) with no production caller:\n`);
  for (const x of findings) {
    console.log(`  ${x.name.padEnd(30)} ${x.file}  (${x.testUses} test refs)`);
  }
  console.log('\nEach is one of: dead code, an unfinished feature, a helper that');
  console.log('should not be exported, or a real capability nothing reaches.');
  console.log('Only the last is a bug — check before deleting.');
}

// Advisory: always exits 0 so it can be run in a pipeline without gating.
process.exit(0);
