/**
 * HomeBot Skills Loader
 *
 * Reads SKILL.md files from the skills/ directory and provides trigger-based
 * injection of domain-specific context into the system prompt.
 *
 * Skill format:
 *   skills/<name>/SKILL.md with:
 *     ## Triggers       — one keyword per line
 *     ## Context        — text injected into the system prompt when triggered
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface Skill {
  name: string;
  triggers: string[];
  context: string;
}

let loadedSkills: Skill[] | null = null;

function getSkillsDir(): string {
  // In dev, use the workspace root skills/ folder.
  // In production, use userData/skills/ (user-editable).
  const devDir = path.resolve(__dirname, '..', '..', '..', 'skills');
  if (fs.existsSync(devDir)) return devDir;
  try {
    return path.join(app.getPath('userData'), 'skills');
  } catch {
    return devDir;
  }
}

function parseSkillMd(content: string): { triggers: string[]; context: string } {
  const triggers: string[] = [];
  let context = '';
  let section: 'none' | 'triggers' | 'context' = 'none';

  for (const line of content.split('\n')) {
    if (/^##\s+Triggers/i.test(line)) { section = 'triggers'; continue; }
    if (/^##\s+Context/i.test(line)) { section = 'context'; continue; }
    if (/^##\s+/.test(line)) { section = 'none'; continue; }

    if (section === 'triggers') {
      const trimmed = line.replace(/^[-*]\s*/, '').trim();
      if (trimmed) triggers.push(trimmed.toLowerCase());
    } else if (section === 'context') {
      context += line + '\n';
    }
  }

  return { triggers, context: context.trim() };
}

/**
 * Load all skills from the skills directory. Caches the result.
 */
export function loadSkills(): Skill[] {
  if (loadedSkills) return loadedSkills;
  const dir = getSkillsDir();
  loadedSkills = [];
  if (!fs.existsSync(dir)) return loadedSkills;

  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      try {
        const raw = fs.readFileSync(skillFile, 'utf-8');
        const { triggers, context } = parseSkillMd(raw);
        if (triggers.length > 0 && context) {
          loadedSkills.push({ name: entry.name, triggers, context });
        }
      } catch (err) {
        console.warn(`[SKILLS] Failed to load skill "${entry.name}":`, err);
      }
    }
    console.log(`[SKILLS] Loaded ${loadedSkills.length} skill(s): ${loadedSkills.map(s => s.name).join(', ')}`);
  } catch (err) {
    console.warn('[SKILLS] Could not read skills directory:', err);
  }
  return loadedSkills;
}

/**
 * Force a reload of all skills from disk.
 */
export function reloadSkills(): Skill[] {
  loadedSkills = null;
  return loadSkills();
}

/**
 * Find skills whose triggers match the user's message.
 * Returns the concatenated context strings of all matching skills.
 */
export function matchSkills(message: string): string | null {
  const skills = loadSkills();
  if (skills.length === 0) return null;

  const lower = message.toLowerCase();
  const matched: Skill[] = [];

  for (const skill of skills) {
    if (skill.triggers.some(t => lower.includes(t))) {
      matched.push(skill);
    }
  }

  if (matched.length === 0) return null;
  return matched.map(s => `[Skill: ${s.name}]\n${s.context}`).join('\n\n');
}
