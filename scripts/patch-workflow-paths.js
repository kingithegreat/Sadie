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
const WORKFLOW_DIRS = [
  path.join(SADIE_ROOT, 'n8n-workflows', 'tools'),
  path.join(SADIE_ROOT, 'n8n-workflows', 'core'),
];

// Hardcoded paths that appear in committed JSON files:
//   1. Double-backslash (JSON-escaped Windows paths in "command" / "cwd" fields)
//   2. Forward-slash (used inside jsCode strings in memory-manager, vision-tool, etc.)
const HARDCODED_BACKSLASH = 'C:\\\\Users\\\\adenk\\\\Desktop\\\\sadie';
const HARDCODED_FORWARD  = 'C:/Users/adenk/Desktop/sadie';

// Normalise the current root to both representations.
const ESCAPED_ROOT_BS = SADIE_ROOT.replace(/\\/g, '\\\\');   // double-backslash for JSON
const ESCAPED_ROOT_FS = SADIE_ROOT.replace(/\\/g, '/');       // forward-slash

const alreadyCorrectBS = (ESCAPED_ROOT_BS === HARDCODED_BACKSLASH);
const alreadyCorrectFS = (ESCAPED_ROOT_FS === HARDCODED_FORWARD);

if (alreadyCorrectBS && alreadyCorrectFS) {
  // Already correct — nothing to do.
  process.exit(0);
}

let patched = 0;

for (const dir of WORKFLOW_DIRS) {
  if (!fs.existsSync(dir)) continue;

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const fp = path.join(dir, file);
    let raw = fs.readFileSync(fp, 'utf-8');
    let changed = false;

    if (!alreadyCorrectBS && raw.includes(HARDCODED_BACKSLASH)) {
      raw = raw.split(HARDCODED_BACKSLASH).join(ESCAPED_ROOT_BS);
      changed = true;
    }
    if (!alreadyCorrectFS && raw.includes(HARDCODED_FORWARD)) {
      raw = raw.split(HARDCODED_FORWARD).join(ESCAPED_ROOT_FS);
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(fp, raw, 'utf-8');
      patched++;
      console.log(`[patch-workflow-paths] patched ${file}`);
    }
  }
}

if (patched > 0) {
  console.log(`[patch-workflow-paths] updated ${patched} workflow file(s) to root: ${SADIE_ROOT}`);
} else {
  console.log('[patch-workflow-paths] all workflow paths already correct');
}
