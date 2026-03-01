import {
  extractBalancedBraceObjects,
  extractToolCallsFromText,
  extractProseToolCalls,
  looksLikeToolJson,
} from '../tool-helpers';

// ---------------------------------------------------------------------------
// looksLikeToolJson (extended beyond message-router-helpers.test.ts)
// ---------------------------------------------------------------------------
describe('looksLikeToolJson - edge cases', () => {
  test('returns false for null / undefined / non-string', () => {
    expect(looksLikeToolJson(null as any)).toBe(false);
    expect(looksLikeToolJson(undefined as any)).toBe(false);
    expect(looksLikeToolJson(42 as any)).toBe(false);
  });

  test('detects embedded JSON inside prose (mistral-style)', () => {
    const prose =
      'Sure, I will search for you. {"name":"web_search","arguments":{"query":"test"}}';
    expect(looksLikeToolJson(prose)).toBe(true);
  });

  test('detects top-level array with arguments', () => {
    const arr = '[{"name":"read_file","arguments":{"path":"a.txt"}}]';
    expect(looksLikeToolJson(arr)).toBe(true);
  });

  test('returns false for whitespace-only string', () => {
    expect(looksLikeToolJson('   ')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractBalancedBraceObjects
// ---------------------------------------------------------------------------
describe('extractBalancedBraceObjects', () => {
  test('extracts a single tool-call object', () => {
    const text =
      'OK: {"name":"write_file","arguments":{"path":"out.txt","content":"hi"}}';
    const results = extractBalancedBraceObjects(text);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('write_file');
    expect(results[0].arguments.path).toBe('out.txt');
  });

  test('handles deeply nested argument objects', () => {
    const text =
      '{"name":"web_search","arguments":{"query":"NBA","options":{"safe":true,"count":5}}}';
    const results = extractBalancedBraceObjects(text);
    expect(results).toHaveLength(1);
    expect(results[0].arguments.options.count).toBe(5);
  });

  test('handles arguments with escaped quotes in strings', () => {
    const text =
      '{"name":"write_file","arguments":{"content":"line \\"quoted\\" word"}}';
    const results = extractBalancedBraceObjects(text);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('write_file');
  });

  test('extracts multiple tool-call objects from prose', () => {
    const text = [
      'First: {"name":"read_file","arguments":{"path":"a.txt"}}',
      'Then: {"name":"write_file","arguments":{"path":"b.txt","content":"x"}}',
    ].join(' ');
    const results = extractBalancedBraceObjects(text);
    expect(results).toHaveLength(2);
    expect(results.map((r: any) => r.name)).toEqual(['read_file', 'write_file']);
  });

  test('extracts a top-level JSON array of tool calls', () => {
    const text =
      '[{"name":"read_file","arguments":{"path":"c.txt"}},{"name":"delete_file","arguments":{"path":"c.txt"}}]';
    const results = extractBalancedBraceObjects(text);
    // The function iterates the outer array AND each inner object, so we get >=2 entries.
    expect(results.length).toBeGreaterThanOrEqual(2);
    const names = results.map((r: any) => r.name);
    expect(names).toContain('read_file');
    expect(names).toContain('delete_file');
  });

  test('returns empty array for plain text', () => {
    expect(extractBalancedBraceObjects('Just some text')).toHaveLength(0);
  });

  test('skips JSON objects that look like data (no name/arguments)', () => {
    const text = '{"foo":"bar","count":42}';
    expect(extractBalancedBraceObjects(text)).toHaveLength(0);
  });

  test('skips malformed / unclosed JSON', () => {
    const text = '{"name":"broken","arguments":{"unclosed":';
    expect(extractBalancedBraceObjects(text)).toHaveLength(0);
  });

  test('returns empty array for empty string', () => {
    expect(extractBalancedBraceObjects('')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractToolCallsFromText
// ---------------------------------------------------------------------------
describe('extractToolCallsFromText', () => {
  test('returns null for null / empty string', () => {
    expect(extractToolCallsFromText(null as any)).toBeNull();
    expect(extractToolCallsFromText('')).toBeNull();
  });

  test('returns null for plain conversational text', () => {
    expect(extractToolCallsFromText('Hello, how can I help you today?')).toBeNull();
  });

  test('extracts tool call embedded in prose', () => {
    const content =
      'Sure, let me look that up.\n{"name":"get_system_info","arguments":{"detailed":false}}\nDone.';
    const result = extractToolCallsFromText(content);
    expect(result).not.toBeNull();
    expect(result![0].name).toBe('get_system_info');
  });

  test('extracts tool call with "parameters" key variant', () => {
    const content = '{"name":"nba_query","parameters":{"type":"scores"}}';
    const result = extractToolCallsFromText(content);
    expect(result).not.toBeNull();
    expect(result![0].name).toBe('nba_query');
  });

  test('extracts multiple tool calls from a JSON array string', () => {
    const content =
      '[{"name":"read_file","arguments":{"path":"x.txt"}},{"name":"write_file","arguments":{"path":"y.txt","content":"abc"}}]';
    const result = extractToolCallsFromText(content);
    expect(result).not.toBeNull();
    // extractBalancedBraceObjects may return each item more than once (array + individual objects)
    const names = result!.map((r: any) => r.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
  });

  test('filters out objects without a name field', () => {
    const content = '{"arguments":{"path":"x.txt"}}'; // no name
    // Should return null since there are no valid tool calls
    const result = extractToolCallsFromText(content);
    // either null or empty (no tool calls with a name)
    expect(!result || result.length === 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractProseToolCalls
// ---------------------------------------------------------------------------
describe('extractProseToolCalls', () => {
  test('returns null for null / empty input', () => {
    expect(extractProseToolCalls(null as any)).toBeNull();
    expect(extractProseToolCalls('')).toBeNull();
  });

  test('returns null when no known tool name is present', () => {
    expect(extractProseToolCalls('unknown_tool path="foo"')).toBeNull();
  });

  test('extracts write_file with key=value pairs', () => {
    const result = extractProseToolCalls(
      'write_file path="output.txt" content="hello world"'
    );
    expect(result).not.toBeNull();
    expect(result![0].name).toBe('write_file');
    expect(result![0].arguments.path).toBe('output.txt');
    expect(result![0].arguments.content).toBe('hello world');
  });

  test('extracts read_file from inside a markdown code block', () => {
    const result = extractProseToolCalls(
      'Here you go:\n```\nread_file path="config.json"\n```'
    );
    expect(result).not.toBeNull();
    expect(result![0].name).toBe('read_file');
    expect(result![0].arguments.path).toBe('config.json');
  });

  test('extracts web_search with unquoted value', () => {
    const result = extractProseToolCalls('web_search query=NBA_scores');
    expect(result).not.toBeNull();
    expect(result![0].name).toBe('web_search');
    expect(result![0].arguments.query).toBe('NBA_scores');
  });

  test('returns null when prose has tool name but no key=value args', () => {
    // "web_search" with nothing after it should return null
    const result = extractProseToolCalls('You can use web_search for that.');
    expect(!result || result.length === 0).toBe(true);
  });

  test('extracts multiple tools from same string', () => {
    const text =
      'read_file path="a.txt" then write_file path="b.txt" content="result"';
    const result = extractProseToolCalls(text);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(2);
  });
});
