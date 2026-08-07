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

    return {
      name,
      description: description || 'No description provided.',
      whenToUse: meta.when_to_use ? String(meta.when_to_use) : undefined,
      tools: Array.isArray(meta.tools) ? meta.tools : undefined,
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

  try {
    const root = skillsDir();
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || found.length >= MAX_SKILLS) continue;
        const skill = readSkill(path.join(root, entry.name), 'user');
        // First one wins, so a user copy shadows a bundled skill of the
        // same name rather than both showing up in the catalogue.
        if (skill && !byName.has(skill.name.toLowerCase())) {
          byName.add(skill.name.toLowerCase());
          found.push(skill);
        }
      }
    }
  } catch (e) {
    console.error('[SKILLS] Could not read skills directory:', e);
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
