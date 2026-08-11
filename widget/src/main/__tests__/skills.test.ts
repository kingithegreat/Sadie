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

import { parseFrontmatter, loadSkills, reloadSkills, getSkill, getSkillCatalogue, skillsDir, matchSkills, deriveDescription } from '../skills';

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

describe('triggers + matchSkills (ported from the reconciled skills-loader)', () => {
  // skills-loader.ts was a parallel build of this feature that shipped on
  // main with a different SKILL.md dialect: "## Triggers" / "## Context"
  // sections instead of frontmatter. The reconciled loader accepts both;
  // these tests hold it to the old loader's contract.

  it('reads triggers from a "## Triggers" section (old dialect)', () => {
    writeSkill('roblox', [
      '# Publish Roblox Game',
      '',
      '## Triggers',
      '- publish roblox',
      '- roblox go live',
      '',
      '## Context',
      'Check the audience setting before declaring a game live.',
    ].join('\n'));
    const s = reloadSkills().find(x => x.name === 'roblox');
    expect(s).toBeDefined();
    expect(s!.triggers).toEqual(['publish roblox', 'roblox go live']);
  });

  it('frontmatter triggers win over a section', () => {
    writeSkill('ft', '---\nname: ft\ndescription: d\ntriggers: [alpha, beta]\n---\n## Triggers\n- ignored\n\nbody');
    expect(reloadSkills()[0].triggers).toEqual(['alpha', 'beta']);
  });

  it('matchSkills injects the Context section with the [Skill: name] header', () => {
    writeSkill('roblox', '## Triggers\n- publish roblox\n\n## Context\nAudience must be Public.');
    reloadSkills();
    const ctx = matchSkills('how do I publish roblox games?');
    expect(ctx).toContain('[Skill: roblox]');
    expect(ctx).toContain('Audience must be Public.');
    // The Triggers section itself must NOT be injected as instructions.
    expect(ctx).not.toContain('publish roblox\n');
  });

  it('matchSkills falls back to the whole body when there is no Context section', () => {
    writeSkill('fm', '---\nname: fm\ndescription: d\ntriggers: [special phrase]\n---\nDo the steps.');
    reloadSkills();
    expect(matchSkills('this has the special phrase in it')).toContain('Do the steps.');
  });

  it('matchSkills returns null when nothing matches', () => {
    writeSkill('fm', '---\nname: fm\ndescription: d\ntriggers: [nomatch]\n---\nbody');
    reloadSkills();
    expect(matchSkills('what is the weather in London')).toBeNull();
  });

  it('a skill without triggers is on-demand only — never injected', () => {
    writeSkill('quiet', '---\nname: quiet\ndescription: d\n---\nOnly via use_skill.');
    reloadSkills();
    expect(matchSkills('quiet Only via use_skill')).toBeNull();
  });

  it('matching is case-insensitive substring, per the old contract', () => {
    writeSkill('cs', '---\nname: cs\ndescription: d\ntriggers: [Content Maturity]\n---\nbody');
    reloadSkills();
    expect(matchSkills('what is CONTENT MATURITY?')).not.toBeNull();
  });
});

describe('metadata bugs HomeBot spotted in its own prompt (2026-08-11)', () => {
  it('keeps a value that legitimately ENDS in a quote', () => {
    // Reported as "descriptions truncated mid-sentence". The cause was not a
    // length cap: the old /^['"]|['"]$/g stripped either end independently, so
    // a when_to_use ending in a quoted example lost its closing quote and read
    // as cut off.
    const { meta } = parseFrontmatter(
      '---\nname: d\nwhen_to_use: The user says "every morning", or "automatically"\n---\nbody',
    );
    expect(meta.when_to_use).toBe('The user says "every morning", or "automatically"');
  });

  it('still strips a genuinely quoted value', () => {
    const { meta } = parseFrontmatter('---\nname: "quoted"\n---\nbody');
    expect(meta.name).toBe('quoted');
  });

  it('does not strip a leading quote when there is no matching close', () => {
    const { meta } = parseFrontmatter('---\nname: "unbalanced\n---\nbody');
    expect(meta.name).toBe('"unbalanced');
  });

  describe('deriveDescription — section-dialect skills are no longer undescribed', () => {
    it('uses the H1 title', () => {
      expect(deriveDescription('# Publish Roblox Game — Go-Live Checklist\n\nSome prose.'))
        .toBe('Publish Roblox Game — Go-Live Checklist');
    });

    it('falls back to the first prose sentence when there is no H1', () => {
      expect(deriveDescription('Domain knowledge for going live. More detail follows.'))
        .toBe('Domain knowledge for going live.');
    });

    it('skips bullets and headings when looking for prose', () => {
      expect(deriveDescription('## Triggers\n- publish roblox\n\nReal description here.'))
        .toBe('Real description here.');
    });

    it('caps a runaway first line rather than flooding the catalogue', () => {
      const out = deriveDescription('x'.repeat(400));
      expect(out.length).toBeLessThanOrEqual(160);
      expect(out.endsWith('…')).toBe(true);
    });

    it('a real section-dialect skill gets a useful catalogue line', () => {
      writeSkill('roblox', [
        '# Publish Roblox Game — Go-Live Checklist',
        '',
        '## Triggers',
        '- publish roblox',
        '',
        '## Context',
        'Check the audience setting.',
      ].join('\n'));
      const s = reloadSkills().find(x => x.name === 'roblox')!;
      expect(s.description).toBe('Publish Roblox Game — Go-Live Checklist');
      expect(s.description).not.toMatch(/No description provided/);
      expect(getSkillCatalogue()).toContain('Publish Roblox Game');
    });
  });
});
