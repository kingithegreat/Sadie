/**
 * skills.ts — user-authored capabilities as markdown files.
 *
 * Adding a capability to HomeBot used to mean editing TypeScript and rebuilding
 * the app. A skill is a folder with a SKILL.md in it, so anyone can add one —
 * including the user, without a toolchain.
 *
 * Why skills are NOT tools
 * ------------------------
 * tools/index.ts caps small models at SMALL_MODEL_MAX_TOOLS (12). Registering
 * one tool per skill would blow that budget at skill #13 and degrade every
 * other tool call on the way there. Instead the model sees a compact CATALOGUE
 * (name + one line each, ~15 tokens per skill) and one tool, `use_skill`,
 * which returns the full body on demand. 50 skills cost ~750 prompt tokens and
 * exactly one tool slot.
 *
 * That split matters most on the 7B models this app targets: the model picks a
 * recipe instead of inventing a plan, which is the thing small models are
 * actually good at.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface Skill {
  name: string;
  description: string;
  /** Optional hint about when this applies — shown in the catalogue if short. */
  whenToUse?: string;
  /**
   * Optional tool allowlist. When present, running this skill narrows the
   * model's toolset to these names (Stage 3) rather than the generic top-12.
   */
  tools?: string[];
  /**
   * Trigger phrases for PROACTIVE injection: when a user message contains one,
   * matchSkills() injects this skill without the model having to ask.
   * Populated from a frontmatter `triggers: [..]` list or a `## Triggers`
   * section in the body (one phrase per line) — the second form absorbed from
   * a parallel skills implementation that shipped on main, so its existing
   * skills keep working. Empty means on-demand only, via use_skill.
   */
  triggers: string[];
  /** Markdown body after the frontmatter — the actual instructions. */
  body: string;
  /** Absolute path to the SKILL.md, so the UI can offer "open folder". */
  path: string;
  source: 'bundled' | 'user';
}

/** A skill body larger than this is almost certainly not instructions. */
const MAX_SKILL_BYTES = 64 * 1024;
/** Guard against a runaway directory — the catalogue has to stay small. */
const MAX_SKILLS = 200;

let cache: Skill[] | null = null;

export function skillsDir(): string {
  // userData, same as settings/automations/license — survives app updates.
  return path.join(app.getPath('userData'), 'skills');
}

/**
 * Minimal YAML-ish frontmatter reader.
 *
 * Deliberately not a YAML dependency: the schema is four flat keys, and the
 * failure mode of a real parser here (throwing on a user's stray colon) is
 * worse than ignoring a line we don't understand. Supports `key: value` and
 * inline lists `key: [a, b]`.
 */
export function parseFrontmatter(md: string): { meta: Record<string, string | string[]>; body: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!match) return { meta: {}, body: md };

  const meta: Record<string, string | string[]> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const key = kv[1].toLowerCase().replace(/-/g, '_');
    let value = kv[2].trim();
    if (!value) continue;

    const list = /^\[(.*)\]$/.exec(value);
    if (list) {
      meta[key] = list[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      meta[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, body: match[2].trim() };
}

/** Lines of a `## <heading>` section in a markdown body, stripped of bullets. */
function sectionLines(body: string, heading: string): string[] {
  const lines: string[] = [];
  let inSection = false;
  for (const line of body.split(/\r?\n/)) {
    if (new RegExp(`^##\\s+${heading}\\b`, 'i').test(line)) { inSection = true; continue; }
    if (/^##\s+/.test(line)) { inSection = false; continue; }
    if (inSection) {
      const t = line.replace(/^[-*]\s*/, '').trim();
      if (t) lines.push(t);
    }
  }
  return lines;
}

/** Body of a `## <heading>` section, joined; '' when the section is absent. */
function sectionText(body: string, heading: string): string {
  let out = '';
  let inSection = false;
  for (const line of body.split(/\r?\n/)) {
    if (new RegExp(`^##\\s+${heading}\\b`, 'i').test(line)) { inSection = true; continue; }
    if (/^##\s+/.test(line)) { inSection = false; continue; }
    if (inSection) out += line + '\n';
  }
  return out.trim();
}

function readSkill(dir: string, source: Skill['source']): Skill | null {
  const file = path.join(dir, 'SKILL.md');
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) return null;

    const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf-8'));
    // Fall back to the folder name so a skill missing frontmatter still loads
    // rather than vanishing silently — a silent skip is unexplainable to a user
    // staring at a folder they just created.
    const name = String(meta.name || path.basename(dir)).trim();
    const description = String(meta.description || '').trim();
    if (!name || !body) return null;

    // Triggers: frontmatter list wins; a "## Triggers" section is the
    // fallback so section-format skills load without conversion.
    const triggers = (Array.isArray(meta.triggers) ? meta.triggers : sectionLines(body, 'Triggers'))
      .map(t => t.toLowerCase())
      .filter(Boolean);

    return {
      name,
      description: description || 'No description provided.',
      whenToUse: meta.when_to_use ? String(meta.when_to_use) : undefined,
      tools: Array.isArray(meta.tools) ? meta.tools : undefined,
      triggers,
      body,
      path: file,
      source,
    };
  } catch {
    return null;
  }
}

/** Load every skill from disk. Cached — call reloadSkills() after an edit. */
export function loadSkills(): Skill[] {
  if (cache) return cache;

  const found: Skill[] = [];
  const byName = new Set<string>();

  // Scan order matters: userData first, so a user's edited copy shadows a
  // repo-bundled skill of the same name. The repo skills/ folder (second) is
  // how skills ship with the codebase in dev — absorbed from the parallel
  // loader on main. Not scanned under jest (hermetic tests) and it resolves
  // to nothing in a packaged asar, where seeding to userData is the path.
  // skillsDir() reaches electron's app.getPath, which throws under plain
  // node/jest. The refactor that introduced `roots` briefly hoisted that call
  // out of the try — and getSystemPromptForModel started throwing in any
  // environment without electron. Skills must NEVER take the prompt builder
  // down: no skills dir means an empty catalogue, not an exception.
  const roots: Array<[string, Skill['source']]> = [];
  try {
    roots.push([skillsDir(), 'user']);
  } catch { /* no electron app (plain node) — userData root unavailable */ }
  if (!process.env.JEST_WORKER_ID) {
    try {
      const devDir = path.resolve(__dirname, '..', '..', '..', 'skills');
      if (fs.existsSync(devDir)) roots.push([devDir, 'bundled']);
    } catch { /* packaged build — no dev dir */ }
  }

  for (const [root, source] of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || found.length >= MAX_SKILLS) continue;
        const skill = readSkill(path.join(root, entry.name), source);
        // First one wins across both roots.
        if (skill && !byName.has(skill.name.toLowerCase())) {
          byName.add(skill.name.toLowerCase());
          found.push(skill);
        }
      }
    } catch (e) {
      console.error('[SKILLS] Could not read skills directory:', e);
    }
  }

  cache = found.sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export function reloadSkills(): Skill[] {
  cache = null;
  return loadSkills();
}

export function getSkill(name: string): Skill | null {
  const needle = (name || '').trim().toLowerCase();
  if (!needle) return null;
  const all = loadSkills();
  return all.find(s => s.name.toLowerCase() === needle)
      ?? all.find(s => s.name.toLowerCase().replace(/[\s_]/g, '-') === needle.replace(/[\s_]/g, '-'))
      ?? null;
}

/**
 * The compact catalogue injected into the system prompt.
 *
 * One line per skill. Returns '' when there are none, so the prompt gains
 * nothing at all rather than an empty header telling a small model about a
 * feature it cannot use.
 */
export function getSkillCatalogue(): string {
  const all = loadSkills();
  if (!all.length) return '';

  const lines = all.map(s => {
    const when = s.whenToUse ? ` Use when: ${s.whenToUse}` : '';
    return `- ${s.name}: ${s.description}${when}`;
  });

  return [
    '## Skills',
    'Saved step-by-step recipes. If one matches the request, call use_skill with',
    'its name FIRST and follow the steps it returns. Do not guess the steps.',
    ...lines,
  ].join('\n');
}

/**
 * Proactive injection: skills whose trigger phrases appear in the user's
 * message get their content injected without the model asking. Same contract
 * as the loader this replaced (substring match, `[Skill: name]` headers,
 * null when nothing matches), so the router call site is a one-line import
 * change. Injects the `## Context` section when the skill has one (the
 * section format's convention), otherwise the whole body.
 */
export function matchSkills(message: string): string | null {
  const lower = (message || '').toLowerCase();
  if (!lower) return null;

  const matched = loadSkills().filter(
    s => s.triggers.length > 0 && s.triggers.some(t => lower.includes(t)),
  );
  if (matched.length === 0) return null;

  return matched
    .map(s => `[Skill: ${s.name}]\n${sectionText(s.body, 'Context') || s.body}`)
    .join('\n\n');
}
