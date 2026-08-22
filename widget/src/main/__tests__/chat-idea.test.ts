/**
 * chat-idea.test.ts
 *
 * The composition contract for "an idea brainstormed in chat becomes a Media
 * Studio job". Mirrors podcast-feed's episodeToJobInput tests: the user's own
 * words must travel into the brief as clearly-marked source material, because
 * media-generate's first guardrail is "never fabricate".
 */

import { chatIdeaToJobInput, deriveIdeaTitle } from '../../shared/chat-idea';

describe('deriveIdeaTitle', () => {
  test('takes the first line', () => {
    expect(deriveIdeaTitle('One-Minute Bible: Jonah\nmore detail below')).toBe('One-Minute Bible: Jonah');
  });

  test('falls back to the first sentence when the line is long', () => {
    const long = 'a'.repeat(150) + '. second sentence';
    const title = deriveIdeaTitle(long);
    expect(title.length).toBeLessThanOrEqual(120);
  });

  test('strips markdown list markers', () => {
    expect(deriveIdeaTitle('- video about tide pools')).toBe('video about tide pools');
  });

  test('empty input gets an honest placeholder, not a crash', () => {
    expect(deriveIdeaTitle('')).toBe('Untitled video');
    expect(deriveIdeaTitle('   \n  ')).toBe('Untitled video');
  });
});

describe('chatIdeaToJobInput', () => {
  test("the user's words travel as clearly-marked source material", () => {
    const { title, brief } = chatIdeaToJobInput({ content: 'A short explainer on how tides work' });
    expect(title).toBe('A short explainer on how tides work');
    expect(brief).toContain('A short explainer on how tides work');
    expect(brief).toMatch(/ONLY this as source material/);
  });

  test('format defaults to short — the panel lets them change it after', () => {
    const { format } = chatIdeaToJobInput({ content: 'idea' });
    expect(format).toBe('short');
  });

  test('an empty idea constrains the job instead of inviting recall', () => {
    const { brief } = chatIdeaToJobInput({ content: '' });
    expect(brief).toMatch(/ask the user what the video should say/i);
  });
});
