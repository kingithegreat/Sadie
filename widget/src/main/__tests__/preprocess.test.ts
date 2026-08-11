// preProcessIntent now reads settings (default weather location), and
// getSettings() → app.getPath throws under plain Jest where electron's `app`
// is undefined. Third test suite broken by this exact shape: a handler grows
// a getSettings() call after its tests were written, and the suite fails on
// environment, not logic.
jest.mock('electron', () => ({
  app: { getPath: () => require('os').tmpdir() },
}));

import { preProcessIntent, clearHistory, setLastIntent, clearLastIntent, bumpLastIntentAge, getCannedResponse, isGarbageOutput, isSmallModel } from '../message-router';

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
      clearLastIntent(CONV_ID);
    });

    test('routes vague follow-up to web_search when prior intent was web_search', async () => {
      // Seed: prior intent was a web search about Iran
      setLastIntent(CONV_ID,
        { calls: [{ name: 'web_search', arguments: { query: 'tell me about the war in iran', maxResults: 5, fetchTopResult: true } }] },
        'tell me about the war in iran');

      const res = await preProcessIntent('how many have died?', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('web_search');
      expect(res!.calls[0].arguments.query).toContain('how many have died?');
      expect(res!.calls[0].arguments.query).toContain('war in iran');
    });

    test('routes "give me more detail" to web_search when prior intent was web_search', async () => {
      setLastIntent(CONV_ID,
        { calls: [{ name: 'web_search', arguments: { query: 'what is happening in ukraine', maxResults: 5, fetchTopResult: true } }] },
        'what is happening in ukraine');

      const res = await preProcessIntent('give me more detail', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('web_search');
      expect(res!.calls[0].arguments.query).toContain('ukraine');
    });

    test('does NOT trigger follow-up when no lastIntent exists', async () => {
      const res = await preProcessIntent('how many have died?', CONV_ID);
      expect(res).toBeNull();
    });

    test('does NOT trigger follow-up when no conversationId is provided', async () => {
      const res = await preProcessIntent('how many have died?');
      expect(res).toBeNull();
    });

    test('explicit intent still takes priority over follow-up routing', async () => {
      setLastIntent(CONV_ID,
        { calls: [{ name: 'web_search', arguments: { query: 'tell me about the war in iran', maxResults: 5, fetchTopResult: true } }] },
        'tell me about the war in iran');

      // "search for" is an explicit web_search intent — should match that pattern
      // directly, not the follow-up heuristic
      const res = await preProcessIntent('search for latest iran casualties', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('web_search');
      // The query should be the raw message, not the "— context:" version
      expect(res!.calls[0].arguments.query).not.toContain('— context:');
    });

    test('re-invokes nba_query for vague follow-up when prior intent was NBA', async () => {
      setLastIntent(CONV_ID,
        { calls: [{ name: 'nba_query', arguments: { type: 'games', date: '20260406', perPage: 10, query: 'lakers' } }] },
        'who do the lakers play today');

      const res = await preProcessIntent('how did they do', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
      expect(res!.calls[0].arguments.query).toBe('lakers');
    });

    test('re-invokes get_weather for vague follow-up when prior intent was weather', async () => {
      setLastIntent(CONV_ID,
        { calls: [{ name: 'get_weather', arguments: { location: 'London' } }] },
        'what is the weather in london');

      const res = await preProcessIntent('what about tomorrow', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('get_weather');
      expect(res!.calls[0].arguments.location).toBe('London');
    });

    // ── Context bleed prevention ─────────────────────────────────────────

    test('does NOT inject Curry context into "give me the history of philosophy"', async () => {
      setLastIntent(CONV_ID,
        { calls: [{ name: 'web_search', arguments: { query: 'is curry playing?', maxResults: 5, fetchTopResult: true } }] },
        'is curry playing?');

      const res = await preProcessIntent('give me the history of philosophy', CONV_ID);
      // Should either be null (LLM handles) or a fresh web_search without Curry context
      if (res) {
        expect(res.calls[0].arguments.query).not.toContain('curry');
      }
    });

    test('does NOT route "is this true" to NBA after NBA query', async () => {
      setLastIntent(CONV_ID,
        { calls: [{ name: 'nba_query', arguments: { type: 'games', date: '20260407', perPage: 10, query: 'warriors' } }] },
        'who do the warriors play next');

      const res = await preProcessIntent('is this true', CONV_ID);
      expect(res).toBeNull(); // No NBA keywords or referential language
    });

    test('does NOT inject NBA context into "steph curry was not a philosopher"', async () => {
      setLastIntent(CONV_ID,
        { calls: [{ name: 'nba_query', arguments: { type: 'games', date: '20260407', perPage: 10, query: 'warriors' } }] },
        'who do the warriors play next');

      const res = await preProcessIntent('steph curry was not a philosopher', CONV_ID);
      // "curry" is an NBA keyword but domain mismatch should catch this
      // (message is about philosophy, not basketball)
      // Either null or not nba_query
      if (res) {
        expect(res.calls[0].name).not.toBe('nba_query');
      }
    });

    // ── Staleness guards ──────────────────────────────────────────────────

    test('expires lastIntent after too many user turns', async () => {
      setLastIntent(CONV_ID,
        { calls: [{ name: 'web_search', arguments: { query: 'iran war', maxResults: 5, fetchTopResult: true } }] },
        'tell me about the war in iran');

      // Simulate 5 user messages (exceeds LAST_INTENT_MAX_TURNS = 4)
      for (let i = 0; i < 5; i++) bumpLastIntentAge(CONV_ID);

      const res = await preProcessIntent('how many have died?', CONV_ID);
      expect(res).toBeNull();
    });

    // ── Topic-shift guard ─────────────────────────────────────────────────

    test('does NOT re-invoke lastIntent when user asks a clearly new question', async () => {
      setLastIntent(CONV_ID,
        { calls: [{ name: 'nba_query', arguments: { type: 'games', date: '20260406', perPage: 10, query: 'lakers' } }] },
        'who do the lakers play today');

      // A full new question — should NOT re-invoke NBA
      const res = await preProcessIntent('what is the population of New Zealand', CONV_ID);
      // Should match "what is" → web_search, NOT fall through to lastIntent
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('web_search');
    });

    // ── NBA date re-parsing ───────────────────────────────────────────────

    test('re-parses "tomorrow" in NBA follow-up instead of repeating old date', async () => {
      // Use a clearly old date so timezone differences can't cause a false match
      setLastIntent(CONV_ID,
        { calls: [{ name: 'nba_query', arguments: { type: 'games', date: '20250101', perPage: 10, query: 'warriors' } }] },
        'who do the warriors play today');

      const res = await preProcessIntent('what about tomorrow', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
      expect(res!.calls[0].arguments.query).toBe('warriors');
      // Date must have been re-parsed — not the stale '20250101'
      expect(res!.calls[0].arguments.date).not.toBe('20250101');
    });

    test('re-parses "yesterday" in NBA follow-up', async () => {
      setLastIntent(CONV_ID,
        { calls: [{ name: 'nba_query', arguments: { type: 'games', date: '20250101', perPage: 10, query: 'lakers' } }] },
        'lakers games today');

      const res = await preProcessIntent('what about yesterday', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
      expect(res!.calls[0].arguments.date).not.toBe('20250101');
    });
  });

  // ── NBA player availability routing ─────────────────────────────────────
  // Player availability questions ("is X playing?") route to web_search
  // because nba_query only returns game schedules, not injury/lineup data.

  describe('NBA player availability routing', () => {
    test('routes "is curry playing" to web_search', async () => {
      const res = await preProcessIntent('is curry playing');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('web_search');
    });

    test('routes "is lebron playing tonight" to web_search', async () => {
      const res = await preProcessIntent('is lebron playing tonight');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('web_search');
    });

    test('routes "is giannis playing tonight" to web_search', async () => {
      const res = await preProcessIntent('is giannis playing tonight');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('web_search');
    });

    test('routes "iscurry playing" (typo, no word boundary) to nba_query', async () => {
      // "iscurry" is one word — misses the player-availability pattern,
      // falls through to NBA fuzzy match as a game schedule query
      const res = await preProcessIntent('iscurry playing');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
    });
  });

  // ── NBA conversation context carry-over ─────────────────────────────────

  describe('NBA context-aware follow-up', () => {
    const CONV_ID = 'test-nba-followup';

    beforeEach(() => {
      clearHistory(CONV_ID);
      clearLastIntent(CONV_ID);
    });

    test('inherits Warriors team via player map even without lastIntent', async () => {
      const res = await preProcessIntent('iscurry playing?', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
      expect(res!.calls[0].arguments.query).toBe('warriors');
    });

    test('inherits team from prior NBA intent in the NBA block', async () => {
      // Prior conversation was about Warriors
      setLastIntent(CONV_ID,
        { calls: [{ name: 'nba_query', arguments: { type: 'games', date: '20260406', perPage: 10, query: 'warriors' } }] },
        'who do the warriors play today');

      // "are they playing tonight" has NBA keyword 'playing' → enters NBA block → no team → inherits from lastIntent
      const res = await preProcessIntent('are they playing tonight', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
      expect(res!.calls[0].arguments.query).toBe('warriors');
    });

    test('does NOT inherit NBA context when no prior intent exists', async () => {
      // "how did they do" has no NBA keywords and no lastIntent → null
      const res = await preProcessIntent('how did they do', CONV_ID);
      expect(res).toBeNull();
    });
  });

  // ── Canned responses ────────────────────────────────────────────────────

  describe('canned responses', () => {
    test('returns __canned for "what time is it"', async () => {
      const res = await preProcessIntent('what time is it?');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('__canned');
      expect(res!.calls[0].arguments.response).toMatch(/It's/);
    });

    test('returns __canned for "what is the date"', async () => {
      const res = await preProcessIntent('what is the date?');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('__canned');
      expect(res!.calls[0].arguments.response).toMatch(/Today is/);
    });

    test('returns __canned for "who are you"', async () => {
      const res = await preProcessIntent('who are you?');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('__canned');
      expect(res!.calls[0].arguments.response).toContain('HomeBot');
    });

    test('returns __canned for "are you a bot"', async () => {
      const res = await preProcessIntent('are you a bot?');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('__canned');
      expect(res!.calls[0].arguments.response).toContain('HomeBot');
    });

    test('returns __canned for "are you real"', async () => {
      const res = await preProcessIntent('are you real?');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('__canned');
      expect(res!.calls[0].arguments.response).toContain('AI');
    });

    test('does NOT return __canned for a normal question', async () => {
      const res = await preProcessIntent('what is the weather in London?');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).not.toBe('__canned');
    });

    test('getCannedResponse returns null for non-trivial queries', () => {
      expect(getCannedResponse('tell me about the war in iran')).toBeNull();
      expect(getCannedResponse('search for python tutorials')).toBeNull();
      expect(getCannedResponse('how is the weather')).toBeNull();
    });
  });

  // ── Playoffs routing ─────────────────────────────────────────────────────

  describe('playoffs routing', () => {
    test('routes "NBA playoffs" to standings', async () => {
      const res = await preProcessIntent('who is in the NBA playoffs?');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
      expect(res!.calls[0].arguments.type).toBe('standings');
    });

    test('routes "playoff schedule" to games', async () => {
      const res = await preProcessIntent('NBA playoff schedule');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
      expect(res!.calls[0].arguments.type).toBe('games');
    });

    test('routes "playoff games" to games', async () => {
      const res = await preProcessIntent('show me the playoff games tonight');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
      expect(res!.calls[0].arguments.type).toBe('games');
    });

    test('routes "play offs bracket" to standings', async () => {
      const res = await preProcessIntent('show me the NBA play offs bracket');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
      expect(res!.calls[0].arguments.type).toBe('standings');
    });
  });

  // ── Standings negation guard ───────────────────────────────────────────

  describe('standings negation guard', () => {
    test('"not standings" does NOT route to standings', async () => {
      const res = await preProcessIntent('NBA not standings, show me the games');
      expect(res).not.toBeNull();
      if (res!.calls[0].arguments.type) {
        expect(res!.calls[0].arguments.type).not.toBe('standings');
      }
    });

    test('"don\'t show standings" does NOT route to standings', async () => {
      const res = await preProcessIntent("NBA scores don't show standings");
      expect(res).not.toBeNull();
      if (res!.calls[0].arguments.type) {
        expect(res!.calls[0].arguments.type).not.toBe('standings');
      }
    });
  });

  // ── Weather default location ──────────────────────────────────────────

  describe('weather default location', () => {
    test('weather query without location still returns get_weather', async () => {
      const res = await preProcessIntent('what is the weather?');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('get_weather');
      expect(res!.calls[0].arguments.location).toBeDefined();
    });

    test('weather query with location extracts location', async () => {
      const res = await preProcessIntent('weather in Tokyo');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('get_weather');
      expect(res!.calls[0].arguments.location.toLowerCase()).toBe('tokyo');
    });

    test('non-weather follow-up after weather does NOT re-invoke weather', async () => {
      const CONV_ID = 'test-weather-followup';
      clearHistory(CONV_ID);
      clearLastIntent(CONV_ID);
      setLastIntent(CONV_ID,
        { calls: [{ name: 'get_weather', arguments: { location: 'Auckland' } }] },
        'what is the weather');
      const res = await preProcessIntent('what the petrol price in nz?', CONV_ID);
      // Should NOT route to get_weather
      if (res) {
        expect(res.calls[0].name).not.toBe('get_weather');
      }
    });

    test('weather follow-up with weather keyword does re-invoke', async () => {
      const CONV_ID = 'test-weather-followup-2';
      clearHistory(CONV_ID);
      clearLastIntent(CONV_ID);
      setLastIntent(CONV_ID,
        { calls: [{ name: 'get_weather', arguments: { location: 'Auckland' } }] },
        'what is the weather');
      const res = await preProcessIntent('what about tomorrow', CONV_ID);
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('get_weather');
    });

    test('"shedule" typo routes to NBA', async () => {
      const res = await preProcessIntent('NBA shedule');
      expect(res).not.toBeNull();
      expect(res!.calls[0].name).toBe('nba_query');
    });
  });

  // ── Word boundary on location extraction ──────────────────────────────

  describe('word boundary on location extraction', () => {
    test('"what is the weather" does not extract "at" as location', async () => {
      const res = await preProcessIntent('what is the weather?');
      expect(res).not.toBeNull();
      expect(res!.calls[0].arguments.location).not.toBe('her');
    });

    test('surf conditions "in Raglan" extracts Raglan', async () => {
      const res = await preProcessIntent('surf conditions in Raglan');
      expect(res).not.toBeNull();
      expect(res!.calls[0].arguments).toHaveProperty('query');
      expect(res!.calls[0].arguments.query.toLowerCase()).toContain('raglan');
    });
  });

  // ── Garbage output detection ────────────────────────────────────────────

  describe('isGarbageOutput', () => {
    test('detects empty output', () => {
      expect(isGarbageOutput('')).toBe('empty');
      expect(isGarbageOutput('   ')).toBe('empty');
    });

    test('detects too-short output', () => {
      expect(isGarbageOutput('ok')).toBe('too-short');
      expect(isGarbageOutput('...')).toBe('too-short');
    });

    test('detects repetition loops', () => {
      const repeated = 'I can help you with that. '.repeat(4);
      expect(isGarbageOutput(repeated)).toBe('repetition-loop');
    });

    test('detects prompt echo-back', () => {
      expect(isGarbageOutput('Here is the text: [Prior conversation context — older turns compressed for brevity]')).toBe('prompt-echo');
      expect(isGarbageOutput('[SEARCH RESULTS] some data [/SEARCH RESULTS]')).toBe('prompt-echo');
    });

    test('passes normal output', () => {
      expect(isGarbageOutput('The weather in London is 15°C with cloudy skies.')).toBeNull();
      expect(isGarbageOutput('Here are the NBA scores for today:\n- Lakers 110 vs Celtics 105')).toBeNull();
    });

    test('passes short but valid output', () => {
      expect(isGarbageOutput('Yes, it is.')).toBeNull();
      expect(isGarbageOutput("I'm not sure about that.")).toBeNull();
    });
  });

  // ── Small model detection ───────────────────────────────────────────────

  describe('isSmallModel', () => {
    test('detects llama3.2:3b as small', () => {
      expect(isSmallModel('llama3.2:3b')).toBe(true);
    });

    test('detects phi3-mini as small', () => {
      expect(isSmallModel('phi3-mini')).toBe(true);
    });

    test('detects gpt-4o-mini as small', () => {
      expect(isSmallModel('gpt-4o-mini')).toBe(true);
    });

    test('detects llama3.1:8b as small — contract changed 2026-08-11', () => {
      // Was asserting 8B is large. The bound moved 3B -> 9B because every
      // local model in use is 7B, so the compact prompt, 12-tool cap and
      // 12-turn history never applied to anything actually running.
      expect(isSmallModel('llama3.1:8b')).toBe(true);
    });

    test('does NOT detect a genuinely large local model as small', () => {
      expect(isSmallModel('codellama:13b')).toBe(false);
      expect(isSmallModel('llama3.1:70b')).toBe(false);
    });

    test('does NOT detect gpt-4 as small', () => {
      expect(isSmallModel('gpt-4')).toBe(false);
    });
  });
});
