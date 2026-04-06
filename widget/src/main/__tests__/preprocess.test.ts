import { preProcessIntent, addToHistory, clearHistory } from '../message-router';

describe('preProcessIntent', () => {
  test('identifies NBA queries as nba_query', async () => {
    const res = await preProcessIntent("What's the NBA scores for Lakers this week?");
    expect(res).not.toBeNull();
    expect(Array.isArray(res!.calls)).toBe(true);
    expect(res!.calls[0].name).toBe('nba_query');
  });

  test('identifies weather queries as get_weather when location present', async () => {
    const res = await preProcessIntent('What is the weather in London today?');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('get_weather');
    expect(res!.calls[0].arguments.location).toBeDefined();
  });

  test('identifies search intents as web_search', async () => {
    const res = await preProcessIntent('Search for Python tutorials');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('web_search');
  });

  // ── File creation with "called X" filename ──────────────────────────────

  test('extracts explicit filename from "called wilt"', async () => {
    const res = await preProcessIntent('make a file on desktop called wilt and fill with wilt chamberlains facts and all his stats');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('__compound_search_file');
    expect(res!.calls[0].arguments.filename).toBe('wilt');
  });

  test('extracts explicit filename from "named report"', async () => {
    const res = await preProcessIntent('create a file named report with information about TypeScript');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('__compound_search_file');
    expect(res!.calls[0].arguments.filename).toBe('report');
  });

  test('does not set filename when no "called/named" pattern is present', async () => {
    const res = await preProcessIntent('create a file about TypeScript best practices');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('__compound_search_file');
    expect(res!.calls[0].arguments.filename).toBeUndefined();
  });

  test('extracts topic from "fill with" pattern', async () => {
    const res = await preProcessIntent('make a file on desktop called wilt and fill with wilt chamberlains facts and all his stats');
    expect(res).not.toBeNull();
    expect(res!.calls[0].arguments.topic).toContain('wilt chamberlain');
  });

  // ── NBA table format ────────────────────────────────────────────────────

  test('passes format=table when user asks "in a table"', async () => {
    const res = await preProcessIntent('give me a list of the remaining NBA games in a table');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('nba_query');
    expect(res!.calls[0].arguments.format).toBe('table');
  });

  test('passes format=table when user asks "as a table"', async () => {
    const res = await preProcessIntent('show me NBA scores as a table');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('nba_query');
    expect(res!.calls[0].arguments.format).toBe('table');
  });

  test('does not set format when "table" is not requested', async () => {
    const res = await preProcessIntent('NBA games today');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('nba_query');
    expect(res!.calls[0].arguments.format).toBeUndefined();
  });

  // ── NBA season file intent ──────────────────────────────────────────────

  test('routes "all this seasons nba results" to compound NBA file with season dateRange', async () => {
    const res = await preProcessIntent('give me file with all this seasons nba results');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('__compound_nba_file');
    expect(res!.calls[0].arguments.dateRange).toBe('season');
  });

  test('routes "allthis seasons nba results" (typo) to compound NBA file with season dateRange', async () => {
    const res = await preProcessIntent('give me file with allthis seasons nba results');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('__compound_nba_file');
    expect(res!.calls[0].arguments.dateRange).toBe('season');
  });

  test('routes "nba season results" to compound NBA file with season dateRange', async () => {
    const res = await preProcessIntent('give me a file with the nba season results');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('__compound_nba_file');
    expect(res!.calls[0].arguments.dateRange).toBe('season');
  });

  test('routes "file with nba games" (no season keyword) to compound NBA file without season', async () => {
    const res = await preProcessIntent('give me a file with nba games');
    expect(res).not.toBeNull();
    expect(res!.calls[0].name).toBe('__compound_nba_file');
    expect(res!.calls[0].arguments.dateRange).toBe('');
  });

  // ── Context-aware follow-up routing ─────────────────────────────────────

  describe('context-aware follow-up', () => {
    const CONV_ID = 'test-followup-ctx';

    beforeEach(() => {
      clearHistory(CONV_ID);
    });

    test('routes vague follow-up to web_search when prior response has source markers', async () => {
      // Seed: user asked about Iran war, assistant replied with source citations
      addToHistory(CONV_ID, 'user', 'tell me about the war in iran');
      addToHistory(CONV_ID, 'assistant',
        'The Iran war began in late February 2026... (source: [1])');
      // Now the follow-up is vague — no tool keywords at all
      addToHistory(CONV_ID, 'user', 'how many have died?');

      const res = await preProcessIntent('how many have died?', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('web_search');
      expect(res!.calls[0].arguments.query).toContain('how many have died?');
      expect(res!.calls[0].arguments.query).toContain('war in iran');
    });

    test('routes "give me more detail" to web_search when prior response has URLs', async () => {
      addToHistory(CONV_ID, 'user', 'what is happening in ukraine');
      addToHistory(CONV_ID, 'assistant',
        'Fighting continues in eastern Ukraine. For more updates visit https://example.com/news');
      addToHistory(CONV_ID, 'user', 'give me more detail');

      const res = await preProcessIntent('give me more detail', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('web_search');
      expect(res!.calls[0].arguments.query).toContain('ukraine');
    });

    test('does NOT trigger follow-up when no conversation history exists', async () => {
      const res = await preProcessIntent('how many have died?', CONV_ID);
      expect(res).toBeNull();
    });

    test('does NOT trigger follow-up when prior response has no source markers', async () => {
      addToHistory(CONV_ID, 'user', 'hello');
      addToHistory(CONV_ID, 'assistant', 'Hi there! How can I help?');
      addToHistory(CONV_ID, 'user', 'how many have died?');

      const res = await preProcessIntent('how many have died?', CONV_ID);
      expect(res).toBeNull();
    });

    test('does NOT trigger follow-up when no conversationId is provided', async () => {
      const res = await preProcessIntent('how many have died?');
      expect(res).toBeNull();
    });

    test('explicit intent still takes priority over follow-up routing', async () => {
      addToHistory(CONV_ID, 'user', 'tell me about the war in iran');
      addToHistory(CONV_ID, 'assistant', 'The war... (source: [1])');
      addToHistory(CONV_ID, 'user', 'search for latest iran casualties');

      // "search for" is an explicit web_search intent — should match that pattern
      // directly, not the follow-up heuristic
      const res = await preProcessIntent('search for latest iran casualties', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('web_search');
      // The query should be the raw message, not the "— context:" version
      expect(res!.calls[0].arguments.query).not.toContain('— context:');
    });
  });
});
