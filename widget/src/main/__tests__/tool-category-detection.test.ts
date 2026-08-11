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

describe('vision covers the OPEN PAGE, not just image files', () => {
  // look_at_browser is category 'vision'. The original vision pattern matched
  // image/picture/photo/screenshot — none of which appear in "what does this
  // page say?", so the tool would have shipped unreachable, exactly as the
  // CRM tools were.
  const cases = [
    'what does this page say',
    'summarise the page I have open',
    'read this website for me',
    'what is on screen right now',
    'look at the browser',
  ];
  for (const m of cases) {
    it(`routes "${m}" to vision`, () => {
      expect(detectToolCategories(m)).toContain('vision');
    });
  }

  it('still routes plain image questions to vision', () => {
    expect(detectToolCategories('describe this picture')).toContain('vision');
  });
});

describe('memory category was unreachable too', () => {
  // remember/recall are in SMALL_MODEL_CORE_TOOLS so they always shipped, but
  // forget, list_memories, get_conversation_history, save_conversation and
  // clear_conversation_history are category 'memory' — which nothing produced.
  const cases = ['forget what I told you', 'what do you remember about me', 'list my memories', 'make a note to self'];
  for (const m of cases) {
    it(`routes "${m}" to memory`, () => {
      expect(detectToolCategories(m)).toContain('memory');
    });
  }

  it('does not claim memory for unrelated messages', () => {
    expect(detectToolCategories('what is the weather') ?? []).not.toContain('memory');
  });
});

describe('no tool category may be unreachable (the gate)', () => {
  /**
   * The bug class this whole file exists for: a tool declares a category, no
   * message can produce that category, getSmallModelTools therefore never adds
   * it, and the feature is invisible to a 7B model forever. It shipped twice —
   * CRM (found only because Aden tried it) and memory (found only by auditing).
   *
   * Reading the source rather than importing the registry is deliberate:
   * initializeTools() drags Electron and the whole tool graph into the test
   * process and hangs it. Regex over the source is crude but it cannot hang,
   * and it fails loudly the moment someone adds a category with no route.
   */
  const fs = require('fs');
  const path = require('path');

  const toolsDir = path.resolve(__dirname, '..', 'tools');
  const routerFile = path.resolve(__dirname, '..', 'message-router.ts');

  /** Categories NOT expected to be reachable by intent, with the reason. */
  const EXEMPT = new Map<string, string>([
    // Nothing here yet. Add an entry only with a real justification — an empty
    // map is the healthy state.
  ]);

  it('every category a tool declares can be produced by detectToolCategories', () => {
    const declared = new Set<string>();
    for (const f of fs.readdirSync(toolsDir)) {
      if (!f.endsWith('.ts')) continue;
      const src = fs.readFileSync(path.join(toolsDir, f), 'utf-8');
      for (const m of src.matchAll(/category:\s*'([a-z-]+)'/g)) declared.add(m[1]);
    }

    const router = fs.readFileSync(routerFile, 'utf-8');
    const producible = new Set(
      [...router.matchAll(/cats\.add\('([a-z-]+)'\)/g)].map(m => m[1]),
    );

    const unreachable = [...declared].filter(c => !producible.has(c) && !EXEMPT.has(c));

    expect(unreachable).toEqual([]);
  });
});

/**
 * The Automation Center's headline feature — "build me an automation in the
 * chat" — had no routing pattern. create_automation is category 'utility',
 * reachable only via calendar/clipboard/git words, so a local model was never
 * offered it unless the user happened to say "schedule".
 */
describe('automation requests reach the automation tools', () => {
  const PROMPTS = [
    'create an automation that summarises my email every morning',
    'set up an automation to check the news daily',
    'automate my morning routine',
    'make a workflow that backs up my notes',
    'something that runs every hour',
  ];

  it.each(PROMPTS)('"%s" routes to utility', (prompt) => {
    expect(detectToolCategories(prompt)).toContain('utility');
  });
});
