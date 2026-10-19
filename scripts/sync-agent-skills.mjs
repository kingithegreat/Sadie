#!/usr/bin/env node
// Copies .agents/skills/** (source of truth) to .claude/skills/** as real files.
// Windows symlinks are unreliable, so copies are committed. `--check` exits 1 on drift.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const src = path.join(root, '.agents', 'skills');
const dst = path.join(root, '.claude', 'skills');
const check = process.argv.includes('--check');

const list = (dir) => fs.existsSync(dir)
  ? fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => f.split(path.sep).join('/')).sort()
  : [];

const a = list(src);
const b = list(dst);
const drift = [...new Set([...a, ...b])].filter((f) => {
  const s = path.join(src, f), d = path.join(dst, f);
  return !fs.existsSync(s) || !fs.existsSync(d) || !fs.readFileSync(s).equals(fs.readFileSync(d));
});

if (check) {
  if (drift.length) { console.error('.claude/skills out of sync with .agents/skills:\n  ' + drift.join('\n  ') + '\nRun: node scripts/sync-agent-skills.mjs'); process.exit(1); }
  console.log(`skills in sync (${a.length} files)`);
} else {
  fs.rmSync(dst, { recursive: true, force: true });
  for (const f of a) { fs.mkdirSync(path.dirname(path.join(dst, f)), { recursive: true }); fs.copyFileSync(path.join(src, f), path.join(dst, f)); }
  console.log(`copied ${a.length} files to .claude/skills`);
}
