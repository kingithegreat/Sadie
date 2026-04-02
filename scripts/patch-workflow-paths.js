/**
 * patch-workflow-paths.js
 *
 * Replaces the hardcoded SADIE project root in all n8n workflow JSON files
 * with the actual project root at startup time.  This makes the repo
 * portable — cloning to a different directory "just works".
 *
 * Usage:  node scripts/patch-workflow-paths.js
 */

const fs = require('fs');
const path = require('path');

const SADIE_ROOT = process.env.SADIE_ROOT || path.resolve(__dirname, '..');
const WORKFLOWS_DIR = path.join(SADIE_ROOT, 'n8n-workflows', 'tools');

// The original hardcoded path that appears in the committed JSON files.
const HARDCODED_PATH = 'C:\\\\Users\\\\adenk\\\\Desktop\\\\sadie';

// Normalise the current root to use the same double-backslash JSON escaping.
const ESCAPED_ROOT = SADIE_ROOT.replace(/\\/g, '\\\\');

if (ESCAPED_ROOT === HARDCODED_PATH) {
  // Already correct — nothing to do.
  process.exit(0);
}

let patched = 0;

if (!fs.existsSync(WORKFLOWS_DIR)) {
  console.log('[patch-workflow-paths] workflows dir not found, skipping');
  process.exit(0);
}

for (const file of fs.readdirSync(WORKFLOWS_DIR)) {
  if (!file.endsWith('.json')) continue;
  const fp = path.join(WORKFLOWS_DIR, file);
  const raw = fs.readFileSync(fp, 'utf-8');
  if (!raw.includes(HARDCODED_PATH)) continue;

  const updated = raw.split(HARDCODED_PATH).join(ESCAPED_ROOT);
  fs.writeFileSync(fp, updated, 'utf-8');
  patched++;
  console.log(`[patch-workflow-paths] patched ${file}`);
}

if (patched > 0) {
  console.log(`[patch-workflow-paths] updated ${patched} workflow file(s) to root: ${SADIE_ROOT}`);
} else {
  console.log('[patch-workflow-paths] all workflow paths already correct');
}
