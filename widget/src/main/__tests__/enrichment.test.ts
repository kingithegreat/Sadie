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

  test('shows "no results" when web search returns nothing', async () => {
    const result = await enrichGenericQuery('obscure topic xyz');
    expect(result.summary).toContain('No results found');
  });

  test('handles topContent from web search', async () => {
    mockWebSearch.mockResolvedValue({
      success: true,
      result: {
        results: [],
        topResultContent: { content: 'This is detailed content about the topic.' },
      },
    } as any);
    const result = await enrichGenericQuery('some topic');
    expect(result.summary).toContain('detailed content');
  });

  test('survives web search failure', async () => {
    mockWebSearch.mockRejectedValue(new Error('DNS failure'));
    const result = await enrichGenericQuery('anything');
    expect(result.structured).toBeNull();
    expect(result.webContext).toBeUndefined();
  });
});
