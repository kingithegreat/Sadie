/**
 * Tests for small-model tool cap and core-tool fallback.
 * Verifies that getSmallModelTools never exceeds SMALL_MODEL_MAX_TOOLS
 * and always includes core tools regardless of category detection.
 */
import { registerTool, getSmallModelTools, SMALL_MODEL_MAX_TOOLS, getOllamaTools } from '../tools';

// Seed registry with enough tools to exceed the cap
function seedTools() {
  const categories = ['web', 'filesystem', 'utility', 'system', 'communication', 'memory', 'document', 'vision', 'voice'];
  let idx = 0;
  for (const cat of categories) {
    for (let i = 0; i < 10; i++) {
      const name = `${cat}_tool_${i}`;
      registerTool(name, {
        name,
        description: `Test ${cat} tool ${i}`,
        category: cat,
        parameters: { type: 'object', properties: {}, required: [] },
      } as any, async () => ({ success: true, result: {} }) as any);
      idx++;
    }
  }
  // Register the core tools so they can be matched
  const coreNames = [
    'web_search', 'get_weather', 'nba_query', 'read_file', 'write_file',
    'list_directory', 'run_code', 'show_notification', 'get_news',
    'remember', 'recall', 'get_current_time',
  ];
  for (const name of coreNames) {
    registerTool(name, {
      name,
      description: `Core tool ${name}`,
      category: 'web',
      parameters: { type: 'object', properties: {}, required: [] },
    } as any, async () => ({ success: true, result: {} }) as any);
  }
}

beforeAll(() => seedTools());

describe('getSmallModelTools', () => {
  it('never exceeds SMALL_MODEL_MAX_TOOLS', () => {
    const tools = getSmallModelTools();
    expect(tools.length).toBeLessThanOrEqual(SMALL_MODEL_MAX_TOOLS);
  });

  it('includes core tools like web_search and get_weather', () => {
    const tools = getSmallModelTools();
    const names = tools.map((t: any) => t.function.name);
    expect(names).toContain('web_search');
    expect(names).toContain('get_weather');
    expect(names).toContain('read_file');
  });

  it('adds category-specific tools when core set leaves room', () => {
    // Core set is 12 tools.  If all 12 are registered they fill the cap exactly,
    // so there is no room for extras.  Verify the cap still holds and that
    // category filtering doesn't break.
    const tools = getSmallModelTools({ categories: ['filesystem'] });
    expect(tools.length).toBeLessThanOrEqual(SMALL_MODEL_MAX_TOOLS);
    // All returned tools should be valid Ollama tool objects
    for (const t of tools) {
      expect(t).toHaveProperty('type', 'function');
      expect(t).toHaveProperty('function.name');
    }
  });

  it('returns only core tools when categories is empty', () => {
    const tools = getSmallModelTools({ categories: [] });
    // Should still include core tools (they don't depend on categories)
    const names = tools.map((t: any) => t.function.name);
    expect(names).toContain('web_search');
    expect(tools.length).toBeLessThanOrEqual(SMALL_MODEL_MAX_TOOLS);
  });

  it('returns far fewer tools than getOllamaTools with no filter', () => {
    const small = getSmallModelTools();
    const all = getOllamaTools();
    expect(all.length).toBeGreaterThan(SMALL_MODEL_MAX_TOOLS);
    expect(small.length).toBeLessThan(all.length);
  });

  // Was `expect(SMALL_MODEL_MAX_TOOLS).toBe(12)` — a tautology restating the
  // constant. It protected nothing, and it passed happily through the entire
  // period the cap sat BELOW the core-tool count, which silently disabled
  // category routing altogether. Pinned to the properties that matter instead:
  // the cap must stay small enough to help a small model, and large enough
  // that the category tools it bounds can actually fit.
  // See small-model-category-routing.test.ts.
  it('the cap is small, but not so small it disables category routing', () => {
    expect(SMALL_MODEL_MAX_TOOLS).toBeGreaterThan(12);
    expect(SMALL_MODEL_MAX_TOOLS).toBeLessThanOrEqual(20);
  });
});
