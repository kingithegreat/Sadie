/**
 * Sharpening a draft request without inventing anything.
 *
 * The behaviours worth pinning are the ones that make this feature harmful
 * rather than merely useless: rewriting a two-word draft (which means guessing
 * at intent), pasting a model's "Here is the improved prompt:" label into the
 * user's box, and reporting success when nothing changed.
 */

import {
  checkImprovable,
  cleanImprovedPrompt,
  isUsefulImprovement,
  buildImproveUserPrompt,
  IMPROVE_SYSTEM_PROMPT,
  MIN_IMPROVABLE_WORDS,
} from '../prompt-improve';

describe('what is worth improving', () => {
  test('a real request is', () => {
    expect(checkImprovable('fetch and sumerize the bbc front page').ok).toBe(true);
  });

  test('empty is refused, and says so plainly', () => {
    const r = checkImprovable('   ');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty');
    expect(r.message).toMatch(/type something/i);
  });

  test('a two-word draft is refused rather than guessed at', () => {
    // The whole risk of this feature: "fix it" rewritten into a confident
    // request for something the user never asked for.
    const r = checkImprovable('fix it');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_short');
    expect(r.message).toMatch(/guessing/i);
  });

  test('the threshold is a word count, not a character count', () => {
    expect(checkImprovable('a b c').ok).toBe(true);
    expect(MIN_IMPROVABLE_WORDS).toBe(3);
  });

  test('a whole document is refused — rewriting it would lose detail', () => {
    const r = checkImprovable('word '.repeat(1200));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_long');
  });
});

describe('the instruction given to the model', () => {
  test('forbids inventing requirements first, because that is the real risk', () => {
    expect(IMPROVE_SYSTEM_PROMPT).toMatch(/NEVER invent requirements/);
  });

  test('asks for the request only, with no preamble', () => {
    expect(IMPROVE_SYSTEM_PROMPT).toMatch(/Output ONLY the rewritten request/);
  });

  test('the user payload carries the draft verbatim', () => {
    expect(buildImproveUserPrompt('  summarise this  ')).toContain('summarise this');
  });
});

describe('cleaning what the model returns', () => {
  // Every fixture here is a shape small local models actually produce despite
  // being told not to.

  test('strips a "Here is the improved prompt:" label', () => {
    expect(cleanImprovedPrompt('Here is the improved prompt: Summarise the BBC front page.'))
      .toBe('Summarise the BBC front page.');
  });

  test('strips a bare "Improved prompt:" label', () => {
    expect(cleanImprovedPrompt('Improved prompt: Summarise the article.'))
      .toBe('Summarise the article.');
  });

  test('strips a markdown-emphasised label', () => {
    expect(cleanImprovedPrompt('**Rewritten request:** Summarise the article.'))
      .toBe('Summarise the article.');
  });

  test('drops a trailing explanation paragraph', () => {
    const raw = 'Summarise the BBC front page.\n\nNote: I added a target so the request is actionable.';
    expect(cleanImprovedPrompt(raw)).toBe('Summarise the BBC front page.');
  });

  test('unwraps surrounding quotes', () => {
    expect(cleanImprovedPrompt('"Summarise the BBC front page."'))
      .toBe('Summarise the BBC front page.');
  });

  test('but keeps quotes that are PART of the request', () => {
    // Unwrapping blindly would mangle a rewrite that legitimately quotes text.
    const raw = 'Find the article titled "Climate policy shifts" and summarise it.';
    expect(cleanImprovedPrompt(raw)).toBe(raw);
  });

  test('unwraps a fenced block', () => {
    expect(cleanImprovedPrompt('```\nSummarise the article.\n```'))
      .toBe('Summarise the article.');
  });

  test('an ordinary rewrite passes through untouched', () => {
    const raw = 'Summarise the BBC front page and list the three biggest stories.';
    expect(cleanImprovedPrompt(raw)).toBe(raw);
  });

  test('the word "changes" inside a sentence is not treated as an explanation', () => {
    const raw = 'Explain what changes were made to the deployment script.';
    expect(cleanImprovedPrompt(raw)).toBe(raw);
  });

  test('empty in, empty out — no throwing', () => {
    expect(cleanImprovedPrompt('')).toBe('');
    expect(cleanImprovedPrompt('   ')).toBe('');
  });
});

describe('is the result worth showing', () => {
  test('an unchanged rewrite is not', () => {
    // Otherwise the user clicks, waits, and the box looks identical with no
    // explanation — which reads as broken.
    expect(isUsefulImprovement('summarise the article', 'summarise the article')).toBe(false);
  });

  test('a case-only change is not', () => {
    expect(isUsefulImprovement('summarise the article', 'Summarise the article')).toBe(false);
  });

  test('a rewrite that lost half the draft is not', () => {
    expect(isUsefulImprovement(
      'fetch the bbc front page and summarise the top three stories',
      'summarise'
    )).toBe(false);
  });

  test('a genuine sharpening is', () => {
    expect(isUsefulImprovement(
      'fetch and sumerize',
      'Fetch the BBC front page and summarise its main stories.'
    )).toBe(true);
  });

  test('an empty result is not', () => {
    expect(isUsefulImprovement('summarise the article', '')).toBe(false);
  });
});
