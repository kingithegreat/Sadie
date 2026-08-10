/**
 * Intent -> tool-category routing for small models.
 *
 * This matters more than it looks. getSmallModelTools() gives a 7B model the
 * fixed core set PLUS tools whose category matched the message — and NOTHING
 * else, because the budget is 12 tools. So a family of tools with no pattern
 * here is not merely deprioritised, it is unreachable: the model never sees it
 * and can only apologise or ask questions.
 *
 * Found live: "add a company called Test Ltd" produced "would you like to add
 * details?" because no CRM tool was ever offered.
 */

jest.mock('electron', () => ({
  app: { getPath: () => require('os').tmpdir() },
}));

import { detectToolCategories } from '../message-router';

describe('CRM intent detection', () => {
  const cases: Array<[string, string]> = [
    ['add a company called Test Ltd', 'company'],
    ['create a contact for Jane', 'contact'],
    ['show me my deals', 'deal'],
    ['what is in my crm', 'crm'],
    ['log this client call', 'client'],
    ['add a new customer', 'customer'],
    ['move that lead to won', 'lead'],
    ['show the pipeline', 'pipeline'],
  ];

  for (const [message, why] of cases) {
    it(`routes "${message}" to crm (matches "${why}")`, () => {
      expect(detectToolCategories(message)).toContain('crm');
    });
  }

  it('is case-insensitive', () => {
    expect(detectToolCategories('Add A COMPANY called X')).toContain('crm');
  });

  it('does not claim crm for unrelated messages', () => {
    // Over-matching costs a small model part of its 12-tool budget.
    for (const m of ['what is the weather', 'summarise this file', 'hello there']) {
      expect(detectToolCategories(m) ?? []).not.toContain('crm');
    }
  });

  it('word-boundaried — "accompany" must not trigger crm', () => {
    expect(detectToolCategories('can you accompany this with a chart') ?? []).not.toContain('crm');
  });
});

describe('the category contract small models depend on', () => {
  it('a matched category is returned so its tools get offered', () => {
    // The whole mechanism: no category -> core tools only -> feature invisible.
    const cats = detectToolCategories('add a company called Test Ltd');
    expect(Array.isArray(cats)).toBe(true);
    expect(cats!.length).toBeGreaterThan(0);
  });
});

/*
 * NOT tested here: that crm_create_company literally appears in the 12 tools
 * getSmallModelTools() returns. Asserting that requires initializeTools(),
 * which pulls the entire registry (and Electron) into the test process and
 * hangs it — the same heavyweight-import problem noted in skills.test.ts.
 *
 * The wiring is instead guaranteed by construction: getSmallModelTools adds
 * `t.category && cats.has(t.category)`, and every CRM tool declares
 * category: 'crm'. The gap this file closes is the one that actually broke —
 * the category was never DETECTED, so the branch never ran.
 *
 * Real confirmation is a live run: ask "add a company called Test Ltd" on a
 * 7B model and check that it creates one instead of asking for details.
 */
