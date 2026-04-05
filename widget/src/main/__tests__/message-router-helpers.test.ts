import { looksLikeToolJson } from '../tool-helpers';

describe('message-router helper', () => {
  test('detects tool-like JSON content', () => {
    const json = JSON.stringify({ name: 'nba_scores', parameters: { date: 'last_week' } });
    expect(looksLikeToolJson(json)).toBe(true);
  });

  test('ignores normal text', () => {
    expect(looksLikeToolJson('Hello, I will check that for you')).toBe(false);
    expect(looksLikeToolJson('Just a number: 12345')).toBe(false);
  });

  test('preProcessIntent detects NBA queries', async () => {
    const { preProcessIntent } = require('../message-router');
    const r = await preProcessIntent('Give me a report of this weeks NBA games');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('nba_query');
    expect(r.calls[0].arguments.type).toBe('games');
  });

  test('preProcessIntent routes "draw a cat" to image_generate', async () => {
    const { preProcessIntent } = require('../message-router');
    const r = await preProcessIntent('draw a cat');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('image_generate');
    expect(r.calls[0].arguments.prompt).toBe('cat');
  });

  test('preProcessIntent routes "paint a sunset over the ocean" to image_generate', async () => {
    const { preProcessIntent } = require('../message-router');
    const r = await preProcessIntent('paint a sunset over the ocean');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('image_generate');
    expect(r.calls[0].arguments.prompt).toBe('sunset over the ocean');
  });

  test('preProcessIntent routes "sketch me a dragon" to image_generate', async () => {
    const { preProcessIntent } = require('../message-router');
    const r = await preProcessIntent('sketch me a dragon');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('image_generate');
    expect(r.calls[0].arguments.prompt).toBe('dragon');
  });

  test('preProcessIntent routes "generate an image of a mountain" to image_generate', async () => {
    const { preProcessIntent } = require('../message-router');
    const r = await preProcessIntent('generate an image of a mountain');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('image_generate');
  });
});

// ── NBA over-triggering guard ────────────────────────────────────────────────

describe('NBA intent guard — no false positives on pasted context', () => {
  let preProcessIntent: (msg: string) => Promise<any>;

  beforeAll(() => {
    ({ preProcessIntent } = require('../message-router'));
  });

  test('long message with NBA scores + "give me the links to these songs" does NOT route to nba_query', async () => {
    // Simulate a user pasting the previous SADIE response (which includes NBA game data)
    // along with a new question about songs at the end.
    const longMsg = [
      'Give me the YouTube links to these songs',
      '',
      '--- previous response pasted below ---',
      '🏀 NBA Scoreboard — Wednesday May 7',
      'Oklahoma City Thunder 118 – Memphis Grizzlies 104',
      'Boston Celtics 112 – New York Knicks 99',
      'Golden State Warriors 103 – Los Angeles Lakers 97',
      'Milwaukee Bucks 115 – Miami Heat 108',
      '1. BBB - Juvenile ft. Megan Thee Stallion',
      '2. Back That Azz Up - Juvenile',
    ].join('\n');

    const r = await preProcessIntent(longMsg);
    // Should route to __music_links (YouTube links requested) NOT nba_query
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('__music_links');
  });

  test('short direct NBA team query still routes to nba_query', async () => {
    const r = await preProcessIntent('when do the Warriors play next?');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('nba_query');
  });

  test('"nba games today" still routes to nba_query even without team name', async () => {
    const r = await preProcessIntent('nba games today');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('nba_query');
  });

  test('message about songs that mentions a team word does NOT fire NBA', async () => {
    // "jazz" is both an NBA team and a music genre
    const r = await preProcessIntent('give me YouTube links to these jazz songs');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('__music_links');
  });
});

// ── NBA opinion / analysis guard ─────────────────────────────────────────────

describe('NBA opinion guard — analysis questions skip NBA tool', () => {
  let preProcessIntent: (msg: string) => Promise<any>;

  beforeAll(() => {
    ({ preProcessIntent } = require('../message-router'));
  });

  test('"do you think the warriors can still win the season?" does NOT route to nba_query', async () => {
    const r = await preProcessIntent('do you think the warriors can still win the season?');
    // Should fall through to general LLM chat (null = no tool match)
    expect(r).toBeNull();
  });

  test('"can the lakers make the playoffs?" does NOT route to nba_query', async () => {
    const r = await preProcessIntent('can the lakers make the playoffs?');
    expect(r).toBeNull();
  });

  test('"what are the celtics chances of winning the championship?" does NOT route to nba_query', async () => {
    const r = await preProcessIntent('what are the celtics chances of winning the championship?');
    expect(r).toBeNull();
  });

  test('"will the bucks win it all this year?" does NOT route to nba_query', async () => {
    const r = await preProcessIntent('will the bucks win it all this year?');
    expect(r).toBeNull();
  });

  test('"who do you think will win the NBA championship?" does NOT route to nba_query', async () => {
    const r = await preProcessIntent('who do you think will win the NBA championship?');
    expect(r).toBeNull();
  });

  test('"realistically can the warriors contend?" does NOT route to nba_query', async () => {
    const r = await preProcessIntent('realistically can the warriors contend?');
    expect(r).toBeNull();
  });

  // Ensure factual queries STILL route correctly
  test('"when do the warriors play next?" STILL routes to nba_query', async () => {
    const r = await preProcessIntent('when do the warriors play next?');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('nba_query');
  });

  test('"what were the lakers scores today?" STILL routes to nba_query', async () => {
    const r = await preProcessIntent('what were the lakers scores today?');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('nba_query');
  });

  test('"nba standings" STILL routes to nba_query', async () => {
    const r = await preProcessIntent('nba standings');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('nba_query');
  });
});

// ── Weather opinion guard ────────────────────────────────────────────────────

describe('Weather opinion guard — subjective questions skip weather tool', () => {
  let preProcessIntent: (msg: string) => Promise<any>;

  beforeAll(() => {
    ({ preProcessIntent } = require('../message-router'));
  });

  test('"do you think it will rain tomorrow?" does NOT route to get_weather', async () => {
    const r = await preProcessIntent('do you think it will rain tomorrow?');
    expect(r).toBeNull();
  });

  test('"what are the chances of sunny weather this weekend?" does NOT route to get_weather', async () => {
    const r = await preProcessIntent('what are the chances of sunny weather this weekend?');
    expect(r).toBeNull();
  });

  test('"weather in Auckland" STILL routes to get_weather', async () => {
    const r = await preProcessIntent('weather in Auckland');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('get_weather');
  });

  test('"forecast for London tomorrow" STILL routes to get_weather', async () => {
    const r = await preProcessIntent('forecast for London tomorrow');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('get_weather');
  });
});

// ── Surf opinion guard ──────────────────────────────────────────────────────

describe('Surf opinion guard — subjective questions skip surf tool', () => {
  let preProcessIntent: (msg: string) => Promise<any>;

  beforeAll(() => {
    ({ preProcessIntent } = require('../message-router'));
  });

  test('"do you think the swell will be good?" does NOT route to __surf_conditions', async () => {
    const r = await preProcessIntent('do you think the swell will be good?');
    expect(r).toBeNull();
  });

  test('"what are the chances the waves will be decent?" does NOT route to __surf_conditions', async () => {
    const r = await preProcessIntent('what are the chances the waves will be decent?');
    expect(r).toBeNull();
  });

  test('"surf report for Raglan" STILL routes to __surf_conditions', async () => {
    const r = await preProcessIntent('surf report for Raglan');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('__surf_conditions');
  });
});

// ── Compound file + opinion guard ───────────────────────────────────────────

describe('Compound file intent — opinion questions fall through to LLM', () => {
  let preProcessIntent: (msg: string) => Promise<any>;

  beforeAll(() => {
    ({ preProcessIntent } = require('../message-router'));
  });

  test('"do you think the warriors will win? save your opinion to a file" does NOT route to compound NBA file', async () => {
    const r = await preProcessIntent('do you think the warriors will win the season? save your opinion to a file');
    // Should fall through — opinion overrides compound file+nba
    expect(r === null || r.calls[0].name !== '__compound_nba_file').toBe(true);
  });

  test('"create a file with this weeks NBA games" STILL routes to compound NBA file', async () => {
    const r = await preProcessIntent('create a file with this weeks NBA games');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('__compound_nba_file');
  });
});

// ── Music links intent ───────────────────────────────────────────────────────

describe('__music_links intent detection', () => {
  let preProcessIntent: (msg: string) => Promise<any>;
  let buildMusicLinksResponse: (songs: string[]) => string;

  beforeAll(() => {
    ({ preProcessIntent, buildMusicLinksResponse } = require('../message-router'));
  });

  test('routes "give me YouTube links to these songs" to __music_links', async () => {
    const r = await preProcessIntent('give me YouTube links to these songs');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('__music_links');
  });

  test('routes "YouTube links for these tracks" to __music_links', async () => {
    const r = await preProcessIntent('YouTube links for these tracks');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('__music_links');
  });

  test('routes "spotify links for these songs" to __music_links', async () => {
    const r = await preProcessIntent('spotify links for these songs');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('__music_links');
  });

  test('extracts songs from numbered list in message', async () => {
    const msg = [
      'Give me YouTube links for these songs:',
      '1. BBB - Juvenile',
      '2. Savage Remix - Megan Thee Stallion ft. Beyoncé',
      '3. Back That Azz Up - Juvenile',
    ].join('\n');
    const r = await preProcessIntent(msg);
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('__music_links');
    expect(r.calls[0].arguments.songs).toContain('BBB - Juvenile');
    expect(r.calls[0].arguments.songs).toContain('Back That Azz Up - Juvenile');
  });

  test('buildMusicLinksResponse returns YouTube search URLs', () => {
    const result = buildMusicLinksResponse(['BBB - Juvenile', 'Savage Remix - Megan Thee Stallion']);
    expect(result).toContain('youtube.com/results?search_query=');
    expect(result).toContain('BBB');
    expect(result).toContain('Savage');
  });

  test('buildMusicLinksResponse with empty list returns helpful message', () => {
    const result = buildMusicLinksResponse([]);
    expect(result).toMatch(/couldn't find|list the songs/i);
  });

  test('YouTube search URLs are properly encoded', () => {
    const result = buildMusicLinksResponse(['Back That Azz Up - Juvenile']);
    expect(result).toContain(encodeURIComponent('Back That Azz Up - Juvenile'));
  });
});

