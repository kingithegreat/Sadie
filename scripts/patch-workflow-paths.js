/**
 * patch-workflow-paths.js
 *
 * Rewrites absolute paths baked into the committed n8n workflow JSON so a clone
 * works from any directory, on any Windows user profile.
 *
 * The committed files carry the developer's own root ("C:\Users\adenk\Desktop\homebot")
 * because n8n exports absolute paths. Rather than matching that one literal, this
 * anchors on the repo-relative directory that follows it — "…\scripts\", "…\config\",
 * "…\memory\" — and replaces whatever prefix precedes it. That keeps working after
 * the repo has already been patched once and moved again.
 *
 * Usage:
 *   node scripts/patch-workflow-paths.js            patch in place
 *   node scripts/patch-workflow-paths.js --check    report only; exit 1 if stale
 */

const fs = require('fs');
const path = require('path');

const CHECK_ONLY = process.argv.includes('--check');

const HOMEBOT_ROOT = process.env.HOMEBOT_ROOT || path.resolve(__dirname, '..');
const WORKFLOW_ROOT = path.join(HOMEBOT_ROOT, 'n8n-workflows');
const SAFETY_RULES = path.join(HOMEBOT_ROOT, 'config', 'safety-rules.json');

// Repo-relative directories that an absolute path in a workflow may point into.
// These anchor the rewrite: everything before them is the project root.
const ANCHORS = ['scripts', 'config', 'memory', 'data', 'prompts', 'logs'];
const ANCHOR_ALT = ANCHORS.join('|');

// Folder names this project has been cloned as, for the bare-root case where no
// anchor follows (a "cwd" field, for example).
const ROOT_FOLDER_ALT = 'homebot|sadie|Sadie|HomeBot';

// Both representations of the current root:
//   BS — double-backslash, how a Windows path is escaped inside JSON
//   FS — forward-slash, used inside the jsCode strings of several nodes
const ROOT_BS = HOMEBOT_ROOT.replace(/\\/g, '\\\\');
const ROOT_FS = HOMEBOT_ROOT.replace(/\\/g, '/');

// In the patterns below, String.raw`\\\\` is four characters, which the regex
// engine reads as "two literal backslashes" — the escaped separator as it
// appears in the raw JSON text.
const RULES = [
  {
    label: 'escaped-backslash path into a repo directory',
    pattern: new RegExp(String.raw`[A-Za-z]:(?:\\\\[^\\"]+)*?\\\\(${ANCHOR_ALT})\\\\`, 'g'),
    replace: (_m, anchor) => `${ROOT_BS}\\\\${anchor}\\\\`,
  },
  {
    label: 'forward-slash path into a repo directory',
    pattern: new RegExp(String.raw`[A-Za-z]:(?:/[^/"]+)*?/(${ANCHOR_ALT})/`, 'g'),
    replace: (_m, anchor) => `${ROOT_FS}/${anchor}/`,
  },
  {
    label: 'escaped-backslash bare project root',
    pattern: new RegExp(String.raw`[A-Za-z]:(?:\\\\[^\\"]+)*?\\\\(?:${ROOT_FOLDER_ALT})(?![^\\"])`, 'g'),
    replace: () => ROOT_BS,
  },
  {
    label: 'forward-slash bare project root',
    pattern: new RegExp(String.raw`[A-Za-z]:(?:/[^/"]+)*?/(?:${ROOT_FOLDER_ALT})(?![^/"])`, 'g'),
    replace: () => ROOT_FS,
  },
];

function collectJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      found.push(full);
    }
  }
  return found;
}

function rewrite(text) {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}

// --- workflow JSON ----------------------------------------------------------

const files = collectJsonFiles(WORKFLOW_ROOT);
const stale = [];

for (const file of files) {
  const before = fs.readFileSync(file, 'utf-8');
  const after = rewrite(before);
  if (after === before) continue;

  stale.push(path.relative(HOMEBOT_ROOT, file));
  if (!CHECK_ONLY) {
    fs.writeFileSync(file, after, 'utf-8');
    console.log(`[patch-workflow-paths] patched ${path.relative(HOMEBOT_ROOT, file)}`);
  }
}

// --- config/safety-rules.json ----------------------------------------------
// The safety whitelist must not name a specific user profile, or a clone on any
// other machine whitelists a directory that does not exist and rejects the
// directories that do.

const configProblems = [];

if (!fs.existsSync(SAFETY_RULES)) {
  configProblems.push('config/safety-rules.json is missing — tools that check safety rules will reject file operations');
} else {
  const raw = fs.readFileSync(SAFETY_RULES, 'utf-8');
  const hardcodedProfile = raw.match(/[A-Za-z]:\\\\Users\\\\[^\\"]+/g);
  if (hardcodedProfile) {
    const unique = [...new Set(hardcodedProfile)];
    configProblems.push(
      `config/safety-rules.json hardcodes a user profile (${unique.join(', ')}); use %USERPROFILE% so the whitelist follows the machine it runs on`
    );
  }
}

// --- report -----------------------------------------------------------------

for (const problem of configProblems) {
  console.error(`[patch-workflow-paths] ${problem}`);
}

if (CHECK_ONLY) {
  if (stale.length > 0) {
    console.error(`[patch-workflow-paths] ${stale.length} workflow file(s) hold a stale absolute path:`);
    for (const file of stale) console.error(`  ${file}`);
  }
  if (stale.length === 0 && configProblems.length === 0) {
    console.log(`[patch-workflow-paths] ${files.length} workflow file(s) checked; all paths resolve to ${HOMEBOT_ROOT}`);
  }
  process.exit(stale.length > 0 || configProblems.length > 0 ? 1 : 0);
}

if (stale.length > 0) {
  console.log(`[patch-workflow-paths] updated ${stale.length} workflow file(s) to root: ${HOMEBOT_ROOT}`);
} else {
  console.log(`[patch-workflow-paths] ${files.length} workflow file(s) checked; all paths already correct`);
}

process.exit(configProblems.length > 0 ? 1 : 0);
