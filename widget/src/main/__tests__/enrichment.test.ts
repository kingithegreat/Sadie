/**
 * enrichment.test.ts
 * Tests for src/main/tools/enrichment.ts
 */

// Mock web search so tests run offline
jest.mock('../tools/web', () => ({
  webSearchHandler: jest.fn(),
}));

import { enrichNbaGames, enrichWeather, enrichGenericQuery } from '../tools/enrichment';
import { webSearchHandler } from '../tools/web';

const mockWebSearch = webSearchHandler as jest.MockedFunction<typeof webSearchHandler>;

const NO_RESULTS = {
  success: true,
  result: { results: [], topResultContent: null },
};

const WITH_RESULTS = {
  success: true,
  result: {
    results: [
      { title: 'Lakers win', url: 'https://nba.com/1', snippet: 'Great game last night' },
      { title: 'Celtics recap', url: 'https://nba.com/2', snippet: 'Celtics win by 10' },
    ],
    topResultContent: null,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWebSearch.mockResolvedValue(NO_RESULTS as any);
});

// ── enrichNbaGames ─────────────────────────────────────────────────────────

describe('enrichNbaGames', () => {
  test('returns EnrichedResult with structured events', async () => {
    const events = [{ id: '1', name: { shortDisplayName: 'GSW vs LAL' } }];
    const result = await enrichNbaGames(events);
    expect(result.structured).toBe(events);
    expect(result.summary).toBeDefined();
  });

  test('returns empty-games message when events array is empty', async () => {
    const result = await enrichNbaGames([]);
    expect(result.summary).toContain('No games found');
  });

  test('includes web results in summary when available', async () => {
    mockWebSearch.mockResolvedValue(WITH_RESULTS as any);
    const events = [{ id: '1' }];
    const result = await enrichNbaGames(events, 'lakers');
    // Web context is attached even if topContent is absent
    expect(result.webContext).toBeDefined();
    expect(result.webContext!.results.length).toBeGreaterThan(0);
  });

  test('survives web search failure gracefully', async () => {
    mockWebSearch.mockRejectedValue(new Error('network error'));
    const result = await enrichNbaGames([{ id: '1' }]);
    expect(result.structured).toBeDefined();
    expect(result.webContext).toBeUndefined();
  });

  test('uses customQuery when provided', async () => {
    await enrichNbaGames([], '', { customQuery: 'NBA finals recap' });
    expect(mockWebSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'NBA finals recap' }),
      expect.anything()
    );
  });

  test('marks all-scheduled games with "No games have finished" message', async () => {
    const scheduledEvents = [
      { id: '1', status: { type: { state: 'pre' } }, date: new Date().toISOString() },
      { id: '2', status: { type: { state: 'pre' } }, date: new Date().toISOString() },
    ];
    const result = await enrichNbaGames(scheduledEvents);
    expect(result.summary).toMatch(/no games have finished/i);
  });

  test('does not add scheduled banner when some games are in-progress', async () => {
    const events = [
      { id: '1', status: { type: { state: 'pre' } } },
      { id: '2', status: { type: { state: 'in' } } },
    ];
    const result = await enrichNbaGames(events);
    expect(result.summary).not.toMatch(/no games have finished/i);
  });
});

// ── enrichWeather ──────────────────────────────────────────────────────────

describe('enrichWeather', () => {
  test('returns EnrichedResult with structured weather data', async () => {
    const weather = { text: 'Sunny, 72°F' };
    const result = await enrichWeather(weather, 'Auckland');
    expect(result.structured).toBe(weather);
    expect(result.summary).toContain('Auckland');
    expect(result.summary).toContain('Sunny, 72°F');
  });

  test('handles string weather data', async () => {
    const result = await enrichWeather('Partly cloudy', 'Sydney');
    expect(result.summary).toContain('Partly cloudy');
  });

  test('handles structured current_condition data', async () => {
    const weather = {
      current_condition: [
        {
          temp_F: '68',
          temp_C: '20',
          weatherDesc: [{ value: 'Clear' }],
          windspeedMiles: '10',
          winddir16Point: 'NW',
          humidity: '60',
        },
      ],
    };
    const result = await enrichWeather(weather, 'London');
    expect(result.summary).toContain('68');
    expect(result.summary).toContain('Clear');
  });

  test('survives web search failure gracefully', async () => {
    mockWebSearch.mockRejectedValue(new Error('timeout'));
    const result = await enrichWeather({ text: 'Warm' }, 'Paris');
    expect(result.structured).toBeDefined();
    expect(result.webContext).toBeUndefined();
  });
});

// ── enrichGenericQuery ─────────────────────────────────────────────────────

describe('enrichGenericQuery', () => {
  test('returns summary with topic title', async () => {
    const result = await enrichGenericQuery('TypeScript best practices');
    expect(result.summary).toContain('TypeScript best practices');
  });

  test('uses snippet-based summary when no topContent', async () => {
    mockWebSearch.mockResolvedValue(WITH_RESULTS as any);
    const result = await enrichGenericQuery('NBA standings');
    expect(result.summary).toContain('Lakers win');
  });

  test('returns "No results found" when search returns nothing', async () => {
    mockWebSearch.mockResolvedValue(NO_RESULTS as any);
    const result = await enrichGenericQuery('obscure query xyz');
    expect(result.summary).toContain('No results found');
  });

  test('uses topContent when available in search result', async () => {
    mockWebSearch.mockResolvedValue({
      success: true,
      result: {
        results: [],
        topResultContent: { content: 'TypeScript is a typed superset of JavaScript.' },
      },
    } as any);
    const result = await enrichGenericQuery('TypeScript intro');
    expect(result.summary).toContain('TypeScript is a typed superset');
  });

  test('passes existingData through to structured field', async () => {
    const existing = { foo: 'bar' };
    const result = await enrichGenericQuery('test topic', existing);
    expect(result.structured).toBe(existing);
  });

  test('survives web search failure gracefully', async () => {
    mockWebSearch.mockRejectedValue(new Error('network failure'));
    const result = await enrichGenericQuery('anything');
    expect(result.summary).toContain('No results found');
    expect(result.webContext).toBeUndefined();
  });
});

// ── enrichWeather — surf mode ─────────────────────────────────────────────

describe('enrichWeather — surf mode', () => {
  test('surf mode header contains "Surf & Marine"', async () => {
    const result = await enrichWeather({ text: '3ft waves' }, 'Malibu', { customQuery: 'surf report malibu' });
    expect(result.summary).toContain('Surf & Marine');
  });

  test('surf topContent appended under Detailed Forecast heading', async () => {
    mockWebSearch.mockResolvedValue({
      success: true,
      result: {
        results: [],
        topResultContent: {
          content: 'Wave height 4ft. Swell period 12s. Wind direction NW. Tide is high.',
        },
      },
    } as any);
    const result = await enrichWeather({ text: '3ft waves' }, 'Malibu', { customQuery: 'surf report malibu' });
    expect(result.summary).toContain('Detailed Forecast');
  });

  test('weather topContent appended under Detailed Forecast heading', async () => {
    mockWebSearch.mockResolvedValue({
      success: true,
      result: {
        results: [],
        topResultContent: {
          content: 'High temperature 72F. Expect rain in the afternoon. Wind 10mph.',
        },
      },
    } as any);
    const result = await enrichWeather('Sunny', 'Auckland');
    expect(result.summary).toContain('Detailed Forecast');
  });
});

// ── enrichNbaGames — topContent highlights ────────────────────────────────

describe('enrichNbaGames — topContent highlights', () => {
  test('appends "Latest Updates" section when topContent has basketball sentences', async () => {
    mockWebSearch.mockResolvedValue({
      success: true,
      result: {
        results: [],
        topResultContent: {
          content: 'LeBron James scored 30 points to lead the Lakers to a win. The final score was 110-104.',
        },
      },
    } as any);
    const events = [{ id: '1' }];
    const result = await enrichNbaGames(events, 'lakers');
    expect(result.summary).toContain('Latest Updates');
  });

  test('appends "Related Coverage" when results available but no topContent', async () => {
    mockWebSearch.mockResolvedValue(WITH_RESULTS as any);
    const result = await enrichNbaGames([{ id: '1' }], 'recap');
    expect(result.summary).toContain('Related Coverage');
  });

  test('formats game with scores when status is not pre (live game)', async () => {
    const events = [{
      id: 'g1',
      competitions: [{
        competitors: [
          { homeAway: 'away', team: { displayName: 'Miami Heat' }, score: '88', records: [{ summary: '20-10' }] },
          { homeAway: 'home', team: { displayName: 'Boston Celtics' }, score: '92', records: [{ summary: '22-8' }] },
        ],
        venue: { fullName: 'TD Garden' },
        leaders: [],
      }],
      status: { type: { state: 'in', description: 'In Progress', shortDetail: 'Q3 8:12' } },
      date: new Date().toISOString(),
      name: { shortDisplayName: 'MIA vs BOS' },
    }];
    const result = await enrichNbaGames(events, '');
    expect(result.summary).toContain('Heat');
    expect(result.summary).toContain('Celtics');
    expect(result.summary).toContain('88');
  });

  test('builds query from team names when no custom query given', async () => {
    const events = [{
      id: 'g1',
      competitions: [{
        competitors: [
          { homeAway: 'away', team: { displayName: 'Golden State Warriors' }, score: '110', records: [] },
          { homeAway: 'home', team: { displayName: 'LA Clippers' }, score: '99', records: [] },
        ],
        venue: {},
        leaders: [],
      }],
      status: { type: { state: 'post', description: 'Final', shortDetail: 'Final' } },
      date: new Date().toISOString(),
    }];
    await enrichNbaGames(events, '');
    expect(mockWebSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining('NBA') }),
      expect.anything()
    );
  });
});

// ── enrichNbaGames — table format ──────────────────────────────────────────

describe('enrichNbaGames — table format', () => {
  test('produces markdown table when format is "table"', async () => {
    const events = [{
      id: 'g1',
      competitions: [{
        competitors: [
          { homeAway: 'away', team: { displayName: 'Miami Heat' }, score: '88', records: [{ summary: '20-10' }] },
          { homeAway: 'home', team: { displayName: 'Boston Celtics' }, score: '92', records: [{ summary: '22-8' }] },
        ],
        venue: { fullName: 'TD Garden' },
        leaders: [],
      }],
      status: { type: { state: 'in', description: 'In Progress', shortDetail: 'Q3 8:12' } },
      date: new Date().toISOString(),
    }];
    const result = await enrichNbaGames(events, '', { format: 'table' });
    expect(result.summary).toContain('| Away |');
    expect(result.summary).toContain('| Home |');
    expect(result.summary).toContain('Miami Heat');
    expect(result.summary).toContain('Boston Celtics');
    expect(result.summary).toContain('88–92');
    expect(result.summary).toContain('TD Garden');
  });

  test('table format shows "—" for scores on scheduled games', async () => {
    const events = [{
      id: 'g1',
      competitions: [{
        competitors: [
          { homeAway: 'away', team: { displayName: 'Lakers' }, records: [] },
          { homeAway: 'home', team: { displayName: 'Warriors' }, records: [] },
        ],
        venue: { fullName: 'Chase Center' },
        leaders: [],
      }],
      status: { type: { state: 'pre', description: 'Scheduled' } },
      date: new Date().toISOString(),
    }];
    const result = await enrichNbaGames(events, '', { format: 'table' });
    expect(result.summary).toContain('| Away |');
    // Score column should show dash for scheduled
    expect(result.summary).toMatch(/\| — \|/);
  });

  test('default format (no format option) does not produce table', async () => {
    const events = [{
      id: 'g1',
      competitions: [{
        competitors: [
          { homeAway: 'away', team: { displayName: 'Lakers' }, records: [] },
          { homeAway: 'home', team: { displayName: 'Warriors' }, records: [] },
        ],
        venue: {},
        leaders: [],
      }],
      status: { type: { state: 'pre' } },
      date: new Date().toISOString(),
    }];
    const result = await enrichNbaGames(events, '');
    expect(result.summary).not.toContain('| Away |');
  });
});

