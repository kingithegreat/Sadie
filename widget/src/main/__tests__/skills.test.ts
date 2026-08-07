/**
 * Tests for the skill loader.
 *
 * Focus is on the parts that fail silently in production: frontmatter the user
 * hand-wrote slightly wrong, and the catalogue string that goes into a small
 * model's prompt (where every token is budget).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-skills-'));

jest.mock('electron', () => ({
  app: { getPath: () => tmpRoot },
}));

import { parseFrontmatter, loadSkills, reloadSkills, getSkill, getSkillCatalogue, skillsDir } from '../skills';

function writeSkill(folder: string, content: string) {
  const dir = path.join(skillsDir(), folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
}

beforeEach(() => {
  fs.rmSync(skillsDir(), { recursive: true, force: true });
  reloadSkills();
});

describe('parseFrontmatter', () => {
  it('reads flat keys and the body', () => {
    const { meta, body } = parseFrontmatter('---\nname: demo\ndescription: A demo\n---\nDo the thing.');
    expect(meta.name).toBe('demo');
    expect(meta.description).toBe('A demo');
    expect(body).toBe('Do the thing.');
  });

  it('reads inline lists', () => {
    const { meta } = parseFrontmatter('---\nname: d\ntools: [web_search, fetch_url]\n---\nbody');
    expect(meta.tools).toEqual(['web_search', 'fetch_url']);
  });

  it('normalises when-to-use to when_to_use', () => {
    const { meta } = parseFrontmatter('---\nname: d\nwhen-to-use: always\n---\nbody');
    expect(meta.when_to_use).toBe('always');
  });

  it('treats a file with no frontmatter as all body', () => {
    const { meta, body } = parseFrontmatter('Just instructions.');
    expect(meta).toEqual({});
    expect(body).toBe('Just instructions.');
  });

  it('ignores malformed lines instead of throwing', () => {
    // A stray colon is the most likely hand-editing mistake; a real YAML
    // parser would throw here and lose the whole skill.
    const { meta } = parseFrontmatter('---\nname: d\nthis line is not a pair\ndescription: ok\n---\nbody');
    expect(meta.name).toBe('d');
    expect(meta.description).toBe('ok');
  });

  it('strips surrounding quotes', () => {
    const { meta } = parseFrontmatter('---\nname: "quoted"\n---\nbody');
    expect(meta.name).toBe('quoted');
  });
});

describe('loadSkills', () => {
  it('returns nothing when the folder does not exist', () => {
    expect(loadSkills()).toEqual([]);
  });

  it('loads a well-formed skill', () => {
    writeSkill('demo', '---\nname: demo\ndescription: Does a thing\n---\nStep one.');
    const all = reloadSkills();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('demo');
    expect(all[0].body).toBe('Step one.');
  });

  it('falls back to the folder name when name is missing', () => {
    // Silently skipping would leave the user staring at a folder they created,
    // with no explanation anywhere.
    writeSkill('my-skill', '---\ndescription: no name given\n---\nBody here.');
    expect(reloadSkills()[0].name).toBe('my-skill');
  });

  it('skips a skill with an empty body', () => {
    writeSkill('empty', '---\nname: empty\ndescription: nothing\n---\n');
    expect(reloadSkills()).toHaveLength(0);
  });

  it('skips folders with no SKILL.md', () => {
    fs.mkdirSync(path.join(skillsDir(), 'not-a-skill'), { recursive: true });
    expect(reloadSkills()).toHaveLength(0);
  });

  it('sorts by name so the catalogue order is stable', () => {
    writeSkill('zebra', '---\nname: zebra\ndescription: z\n---\nbody');
    writeSkill('alpha', '---\nname: alpha\ndescription: a\n---\nbody');
    expect(reloadSkills().map(s => s.name)).toEqual(['alpha', 'zebra']);
  });
});

describe('getSkill', () => {
  beforeEach(() => {
    writeSkill('research', '---\nname: research-a-question\ndescription: d\n---\nSteps.');
    reloadSkills();
  });

  it('finds by exact name', () => {
    expect(getSkill('research-a-question')?.body).toBe('Steps.');
  });

  it('is case-insensitive', () => {
    expect(getSkill('Research-A-Question')).not.toBeNull();
  });

  it('tolerates spaces and underscores for hyphens', () => {
    // A small model asked for "research a question" should not get a miss.
    expect(getSkill('research a question')).not.toBeNull();
    expect(getSkill('research_a_question')).not.toBeNull();
  });

  it('returns null for an unknown name', () => {
    expect(getSkill('nope')).toBeNull();
  });
});

describe('getSkillCatalogue', () => {
  it('is empty when no skills exist, so the prompt gains nothing', () => {
    expect(getSkillCatalogue()).toBe('');
  });

  it('lists one line per skill', () => {
    writeSkill('a', '---\nname: a\ndescription: Does A\n---\nbody');
    writeSkill('b', '---\nname: b\ndescription: Does B\nwhen_to_use: when B\n---\nbody');
    reloadSkills();

    const cat = getSkillCatalogue();
    expect(cat).toContain('- a: Does A');
    expect(cat).toContain('- b: Does B Use when: when B');
    expect(cat).toContain('use_skill');
  });

  it('stays small — the whole point of not registering a tool per skill', () => {
    for (let i = 0; i < 50; i++) {
      writeSkill(`skill-${i}`, `---\nname: skill-${i}\ndescription: Does thing ${i}\n---\nbody`);
    }
    reloadSkills();
    // 50 skills must not blow a 7B model's prompt budget. A tool schema each
    // would be many times this.
    expect(getSkillCatalogue().length).toBeLessThan(3000);
  });
});
