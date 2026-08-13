/**
 * Category routing for small models was dead code, and nothing said so.
 *
 * SMALL_MODEL_CORE_TOOLS held 14 names while SMALL_MODEL_MAX_TOOLS was 12.
 * The core loop pushed all 14 unconditionally, so the category loop's
 * `if (selected.length >= SMALL_MODEL_MAX_TOOLS) break` fired on its first
 * iteration — every request, every category, every small model. A CRM request
 * on a 7B model was handed zero CRM tools, so the model answered from
 * imagination; that reads as "the local model is weak", not as "the tool was
 * never offered". slice(0, 12) also silently discarded two core tools.
 *
 * The existing suite checked only that the result never EXCEEDS the cap, which
 * a permanently-truncated list satisfies perfectly. Bounds tests pass hardest
 * when the feature is off. These assert the other direction: that the tools a
 * request needs are actually present.
 *
 * Seeds the registry directly rather than calling initializeTools(), which
 * reaches for Electron's app.getPath.
 */

import {
  registerTool,
  getSmallModelTools,
  getAllToolDefinitions,
  SMALL_MODEL_MAX_TOOLS,
  SMALL_MODEL_CATEGORY_SLOTS,
} from '../tools';

/** Core tool names, mirroring SMALL_MODEL_CORE_TOOLS (not exported). */
const CORE_NAMES = [
  'web_search', 'get_weather', 'nba_query', 'read_file', 'write_file',
  'list_directory', 'run_terminal_command', 'grep_code', 'show_notification',
  'get_news', 'remember', 'recall', 'get_system_info', 'list_processes',
];

const CATEGORIES = ['web', 'filesystem', 'utility', 'system', 'communication',
  'memory', 'document', 'vision', 'voice', 'crm'];

function seed() {
  for (const cat of CATEGORIES) {
    for (let i = 0; i < 6; i++) {
      const name = `${cat}_tool_${i}`;
      registerTool(name, {
        name, description: `Test ${cat} tool ${i}`, category: cat,
        parameters: { type: 'object', properties: {}, required: [] },
      } as any, async () => ({ success: true, result: {} }) as any);
    }
  }
  for (const name of CORE_NAMES) {
    registerTool(name, {
      name, description: `Core ${name}`, category: 'utility',
      parameters: { type: 'object', properties: {}, required: [] },
    } as any, async () => ({ success: true, result: {} }) as any);
  }
}

beforeAll(seed);

const namesOf = (tools: any[]) => tools.map(t => t.function?.name ?? t.name);
const toolsInCategory = (cat: string) =>
  getAllToolDefinitions().filter(t => (t as any).category === cat).map(t => t.name);

describe('the budget leaves room for the feature it bounds', () => {
  it('the cap exceeds the core set, or categories can never be added', () => {
    // The arithmetic that would have caught this on day one: 14 core names
    // against a cap of 12 meant the category loop could never run.
    expect(CORE_NAMES.length).toBeLessThan(SMALL_MODEL_MAX_TOOLS);
  });

  it('reserves fewer slots than the cap', () => {
    expect(SMALL_MODEL_CATEGORY_SLOTS).toBeGreaterThan(0);
    expect(SMALL_MODEL_CATEGORY_SLOTS).toBeLessThan(SMALL_MODEL_MAX_TOOLS);
  });

  it('still never exceeds the cap', () => {
    expect(getSmallModelTools().length).toBeLessThanOrEqual(SMALL_MODEL_MAX_TOOLS);
    expect(getSmallModelTools({ categories: ['crm', 'web', 'vision'] }).length)
      .toBeLessThanOrEqual(SMALL_MODEL_MAX_TOOLS);
  });
});

describe('a detected category actually reaches the model', () => {
  it.each(['crm', 'vision', 'memory', 'communication'])(
    'a %s request receives at least one tool of that category',
    (category) => {
      const selected = namesOf(getSmallModelTools({ categories: [category] }));
      const got = selected.filter(n => toolsInCategory(category).includes(n));
      // The regression this file exists for: got.length was always 0.
      expect(got.length).toBeGreaterThan(0);
    },
  );

  it('asking for a category changes the tool set at all', () => {
    const plain = namesOf(getSmallModelTools()).join(',');
    const withCrm = namesOf(getSmallModelTools({ categories: ['crm'] })).join(',');
    expect(withCrm).not.toEqual(plain);
  });

  it('core tools survive alongside category tools', () => {
    // Reserving slots must not evict the essentials.
    const selected = namesOf(getSmallModelTools({ categories: ['crm'] }));
    const coreCount = selected.filter(n => CORE_NAMES.includes(n)).length;
    expect(coreCount).toBeGreaterThanOrEqual(SMALL_MODEL_MAX_TOOLS - SMALL_MODEL_CATEGORY_SLOTS);
  });

  it('a category request is never shorter than a plain one', () => {
    // Unused category slots go back to core rather than shrinking the list.
    expect(getSmallModelTools({ categories: ['voice'] }).length)
      .toBeGreaterThanOrEqual(getSmallModelTools().length);
  });
});

/**
 * Synonyms are looked up before stemming, or they do not fire at all.
 *
 * rankToolsByQuery expanded tokenise(query), which had ALREADY stemmed. The
 * stemmer strips a trailing "e", so "make" arrived as "mak" and
 * QUERY_SYNONYMS["make"] was never consulted. The cost was that a pipeline
 * could not be started from its most natural request: "Make me a short video
 * about Jonah" offered media_write_script and media_narrate and NOT
 * media_create_job — every media tool except the one that starts a job.
 *
 * Two of the original entries were dead the same way: "meeting" stems to
 * "meet", "picture" to "pictur".
 */
describe('query synonyms survive the stemmer', () => {
  const { rankToolsByQuery } = require('../tools');

  const tool = (name: string, description = ''): any => ({
    name, description, category: 'test', parameters: { type: 'object', properties: {} },
  });

  it('maps "make" onto the tools named "create"', () => {
    const ranked = rankToolsByQuery(
      [tool('thing_write_script'), tool('thing_narrate'), tool('thing_create_job')],
      'Make me a short video about Jonah and the storm.',
    ).map((t: any) => t.name);
    expect(ranked[0]).toBe('thing_create_job');
  });

  it.each(['build', 'start', 'add', 'new'])('and "%s" as well', (verb) => {
    const ranked = rankToolsByQuery(
      [tool('thing_list'), tool('thing_create')],
      `${verb} a thing`,
    ).map((t: any) => t.name);
    expect(ranked[0]).toBe('thing_create');
  });

  it('revives "meeting", which stemmed to "meet" and never matched', () => {
    const ranked = rankToolsByQuery(
      [tool('list_processes'), tool('add_calendar_event')],
      'what meetings do I have tomorrow',
    ).map((t: any) => t.name);
    expect(ranked[0]).toBe('add_calendar_event');
  });

  it('still ranks on the words actually used when no synonym applies', () => {
    const ranked = rankToolsByQuery(
      [tool('thing_create'), tool('thing_delete')],
      'delete the thing',
    ).map((t: any) => t.name);
    expect(ranked[0]).toBe('thing_delete');
  });
});
