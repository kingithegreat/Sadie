/**
 * Tool Definition Shape Tests
 *
 * Validates that exported ToolDefinition objects from web, system, and memory
 * modules satisfy the contract expected by the tool registry and n8n.
 * Also covers the web tool API key setter/getter functions.
 */
import {
  webSearchDef,
  fetchUrlDef,
  getWeatherDef,
  setTavilyApiKey,
  getTavilyApiKey,
  setSerperApiKey,
  getSerperApiKey,
} from '../tools/web';
import {
  getSystemInfoDef,
  getClipboardDef,
  setClipboardDef,
  openUrlDef,
  launchAppDef,
} from '../tools/system';
import { rememberDef, recallDef, forgetDef } from '../tools/memory';
import type { ToolDefinition } from '../tools/types';

// ---------------------------------------------------------------------------
// Shared shape contract
// ---------------------------------------------------------------------------
const ALL_DEFS: ToolDefinition[] = [
  webSearchDef,
  fetchUrlDef,
  getWeatherDef,
  getSystemInfoDef,
  getClipboardDef,
  setClipboardDef,
  openUrlDef,
  launchAppDef,
  rememberDef,
  recallDef,
  forgetDef,
];

describe('tool definition shapes', () => {
  test.each(ALL_DEFS)(
    '$name — has non-empty name, description, category, and parameters',
    (def) => {
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);

      expect(typeof def.description).toBe('string');
      expect(def.description.length).toBeGreaterThan(0);

      expect(typeof def.category).toBe('string');
      expect((def.category ?? '').length).toBeGreaterThan(0);

      expect(def.parameters).toBeDefined();
      expect(def.parameters.type).toBe('object');
      expect(def.parameters.properties).toBeDefined();
    }
  );

  test('all definition names are unique', () => {
    const names = ALL_DEFS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// Required-parameter contracts
// ---------------------------------------------------------------------------
describe('required parameter contracts', () => {
  test('webSearchDef requires "query"', () => {
    expect(webSearchDef.parameters.required).toContain('query');
  });

  test('fetchUrlDef requires "url"', () => {
    expect(fetchUrlDef.parameters.required).toContain('url');
  });

  test('getWeatherDef requires "location"', () => {
    expect(getWeatherDef.parameters.required).toContain('location');
  });

  test('setClipboardDef requires "text"', () => {
    expect(setClipboardDef.parameters.required).toContain('text');
  });

  test('openUrlDef requires "url"', () => {
    expect(openUrlDef.parameters.required).toContain('url');
  });

  test('rememberDef requires "content"', () => {
    expect(rememberDef.parameters.required).toContain('content');
  });

  test('recallDef requires "query"', () => {
    expect(recallDef.parameters.required).toContain('query');
  });

  test('forgetDef required array is defined', () => {
    expect(Array.isArray(forgetDef.parameters.required)).toBe(true);
  });

  test('getSystemInfoDef optional-only — required is empty or absent', () => {
    const req = getSystemInfoDef.parameters.required ?? [];
    expect(req).toHaveLength(0);
  });

  test('getClipboardDef takes no required params', () => {
    const req = getClipboardDef.parameters.required ?? [];
    expect(req).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Category grouping
// ---------------------------------------------------------------------------
describe('tool categories', () => {
  test('web tools have category "web"', () => {
    expect(webSearchDef.category).toBe('web');
    expect(fetchUrlDef.category).toBe('web');
    expect(getWeatherDef.category).toBe('web');
  });

  test('system tools have category "system"', () => {
    expect(getSystemInfoDef.category).toBe('system');
    expect(getClipboardDef.category).toBe('system');
    expect(setClipboardDef.category).toBe('system');
    expect(openUrlDef.category).toBe('system');
  });

  test('memory tools have category "memory"', () => {
    expect(rememberDef.category).toBe('memory');
    expect(recallDef.category).toBe('memory');
    expect(forgetDef.category).toBe('memory');
  });
});

// ---------------------------------------------------------------------------
// API key storage (web.ts module-level state)
// ---------------------------------------------------------------------------
describe('web tool API key storage', () => {
  afterEach(() => {
    setTavilyApiKey(null);
    setSerperApiKey(null);
  });

  test('getTavilyApiKey returns null by default', () => {
    expect(getTavilyApiKey()).toBeNull();
  });

  test('setTavilyApiKey / getTavilyApiKey round-trip', () => {
    setTavilyApiKey('tavily-test-key-abc123');
    expect(getTavilyApiKey()).toBe('tavily-test-key-abc123');
  });

  test('getSerperApiKey returns null by default', () => {
    expect(getSerperApiKey()).toBeNull();
  });

  test('setSerperApiKey / getSerperApiKey round-trip', () => {
    setSerperApiKey('serper-xyz-789');
    expect(getSerperApiKey()).toBe('serper-xyz-789');
  });

  test('Tavily key can be overwritten', () => {
    setTavilyApiKey('first');
    setTavilyApiKey('second');
    expect(getTavilyApiKey()).toBe('second');
  });

  test('keys are independent (setting one does not affect the other)', () => {
    setTavilyApiKey('tavily-only');
    expect(getSerperApiKey()).toBeNull();
  });

  test('setTavilyApiKey(null) clears the key', () => {
    setTavilyApiKey('temp');
    setTavilyApiKey(null);
    expect(getTavilyApiKey()).toBeNull();
  });
});
