/**
 * Tests for the skills loader module.
 */

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp/homebot-test') },
}));

describe('skills-loader', () => {
  // Import after mocks
  let loadSkills: typeof import('../skills-loader').loadSkills;
  let matchSkills: typeof import('../skills-loader').matchSkills;
  let reloadSkills: typeof import('../skills-loader').reloadSkills;

  beforeEach(() => {
    jest.resetModules();
    const mod = require('../skills-loader');
    loadSkills = mod.loadSkills;
    matchSkills = mod.matchSkills;
    reloadSkills = mod.reloadSkills;
  });

  it('loads skills from the skills directory', () => {
    const skills = loadSkills();
    expect(Array.isArray(skills)).toBe(true);
    // The example skill should be present
    const example = skills.find(s => s.name === 'example');
    expect(example).toBeDefined();
    expect(example!.triggers).toContain('example');
    expect(example!.context.length).toBeGreaterThan(0);
  });

  it('matchSkills returns context for matching triggers', () => {
    const ctx = matchSkills('show me an example of something');
    expect(ctx).not.toBeNull();
    expect(ctx).toContain('Skill: example');
  });

  it('matchSkills returns null when no trigger matches', () => {
    const ctx = matchSkills('what is the weather in London');
    expect(ctx).toBeNull();
  });

  it('reloadSkills refreshes from disk', () => {
    const first = loadSkills();
    const second = reloadSkills();
    expect(second.length).toBe(first.length);
  });
});
