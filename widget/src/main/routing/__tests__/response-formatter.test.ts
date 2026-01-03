/**
 * Response Formatter Module Tests
 * ================================
 * Tests for tool result formatting and display logic.
 */

import {
  formatNbaResultDirectly,
  formatWeatherResultDirectly,
  summarizeToolResults,
  formatNetworkError,
  formatPermissionDenied,
  TOOL_ALIASES,
  normalizeToolName,
  shouldFormatDirectly,
  formatToolResultDirectly,
} from '../response-formatter';

describe('Response Formatter Module', () => {

  // ============================================
  // NBA Result Formatting
  // ============================================
  describe('formatNbaResultDirectly', () => {

    test('formats single final game result', () => {
      const result = {
        query: 'warriors',
        events: [{
          competitions: [{
            competitors: [
              { homeAway: 'home', team: { displayName: 'Golden State Warriors' }, score: '120' },
              { homeAway: 'away', team: { displayName: 'Los Angeles Lakers' }, score: '115' }
            ],
            status: { type: { name: 'STATUS_FINAL' } }
          }]
        }]
      };

      const formatted = formatNbaResultDirectly(result);

      expect(formatted).toContain('**NBA Games for warriors:**');
      expect(formatted).toContain('Golden State Warriors');
      expect(formatted).toContain('Los Angeles Lakers');
      expect(formatted).toContain('120');
      expect(formatted).toContain('115');
      expect(formatted).toContain('Final');
      expect(formatted).toContain('🏀');
    });

    test('formats in-progress game', () => {
      const result = {
        query: 'lakers',
        events: [{
          competitions: [{
            competitors: [
              { homeAway: 'home', team: { displayName: 'Los Angeles Lakers' }, score: '58' },
              { homeAway: 'away', team: { displayName: 'Boston Celtics' }, score: '62' }
            ],
            status: { type: { name: 'STATUS_IN_PROGRESS' } }
          }]
        }]
      };

      const formatted = formatNbaResultDirectly(result);

      expect(formatted).toContain('Live');
      expect(formatted).toContain('58');
      expect(formatted).toContain('62');
    });

    test('formats scheduled game with date', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // Tomorrow
      const result = {
        query: 'celtics',
        events: [{
          date: futureDate,
          competitions: [{
            competitors: [
              { homeAway: 'home', team: { displayName: 'Boston Celtics' } },
              { homeAway: 'away', team: { displayName: 'Miami Heat' } }
            ],
            status: { type: { name: 'STATUS_SCHEDULED' } }
          }]
        }]
      };

      const formatted = formatNbaResultDirectly(result);

      // Should not show "Final" or "Live"
      expect(formatted).not.toContain('Final');
      expect(formatted).not.toContain('Live');
      expect(formatted).toContain('Boston Celtics');
      expect(formatted).toContain('Miami Heat');
    });

    test('formats multiple games', () => {
      const result = {
        query: 'nba',
        events: [
          {
            competitions: [{
              competitors: [
                { homeAway: 'home', team: { displayName: 'Team A' }, score: '100' },
                { homeAway: 'away', team: { displayName: 'Team B' }, score: '95' }
              ],
              status: { type: { name: 'STATUS_FINAL' } }
            }]
          },
          {
            competitions: [{
              competitors: [
                { homeAway: 'home', team: { displayName: 'Team C' }, score: '110' },
                { homeAway: 'away', team: { displayName: 'Team D' }, score: '105' }
              ],
              status: { type: { name: 'STATUS_FINAL' } }
            }]
          }
        ]
      };

      const formatted = formatNbaResultDirectly(result);
      const lines = formatted.split('\n').filter(l => l.includes('🏀'));

      expect(lines).toHaveLength(2);
    });

    test('handles empty events array', () => {
      const result = { query: 'warriors', events: [] };
      const formatted = formatNbaResultDirectly(result);

      expect(formatted).toContain('No NBA games found');
      expect(formatted).toContain('warriors');
    });

    test('handles missing events', () => {
      const result = { query: 'test' };
      const formatted = formatNbaResultDirectly(result);

      expect(formatted).toContain('No NBA games found');
    });

    test('handles null result', () => {
      const formatted = formatNbaResultDirectly(null);

      expect(formatted).toContain('No NBA games found');
    });

    test('handles missing team names gracefully', () => {
      const result = {
        query: 'test',
        events: [{
          competitions: [{
            competitors: [
              { homeAway: 'home', score: '100' },
              { homeAway: 'away', score: '95' }
            ],
            status: { type: { name: 'STATUS_FINAL' } }
          }]
        }]
      };

      const formatted = formatNbaResultDirectly(result);

      // Should use fallback names
      expect(formatted).toContain('Home Team');
    });

    test('handles alternative data structure (legacy format)', () => {
      const result = {
        query: 'warriors',
        events: [{
          homeTeam: 'Golden State Warriors',
          awayTeam: 'Los Angeles Lakers',
          homeScore: 120,
          awayScore: 115,
          status: 'Final'
        }]
      };

      const formatted = formatNbaResultDirectly(result);

      expect(formatted).toContain('Golden State Warriors');
      expect(formatted).toContain('Los Angeles Lakers');
    });
  });

  // ============================================
  // Weather Result Formatting
  // ============================================
  describe('formatWeatherResultDirectly', () => {

    test('formats complete weather result', () => {
      const result = {
        location: 'Seattle',
        temperature: 55,
        conditions: 'Cloudy',
        humidity: 75,
        wind: '10 mph'
      };

      const formatted = formatWeatherResultDirectly(result);

      expect(formatted).toContain('**Weather for Seattle:**');
      expect(formatted).toContain('🌡️ Temperature: 55°F');
      expect(formatted).toContain('☁️ Conditions: Cloudy');
      expect(formatted).toContain('💧 Humidity: 75%');
      expect(formatted).toContain('💨 Wind: 10 mph');
    });

    test('handles missing optional fields', () => {
      const result = {
        location: 'Denver',
        temperature: 45,
        conditions: 'Sunny'
      };

      const formatted = formatWeatherResultDirectly(result);

      expect(formatted).toContain('Denver');
      expect(formatted).toContain('45°F');
      expect(formatted).toContain('Sunny');
      expect(formatted).not.toContain('Humidity');
      expect(formatted).not.toContain('Wind');
    });

    test('handles alternative field names', () => {
      const result = {
        city: 'Portland',
        temp: 50,
        description: 'Rainy',
        wind_speed: '15 mph'
      };

      const formatted = formatWeatherResultDirectly(result);

      expect(formatted).toContain('Portland');
      expect(formatted).toContain('50°F');
      expect(formatted).toContain('Rainy');
    });

    test('handles error result', () => {
      const result = { error: 'City not found' };
      const formatted = formatWeatherResultDirectly(result);

      expect(formatted).toContain('Unable to get weather');
      expect(formatted).toContain('City not found');
    });

    test('handles null result', () => {
      const formatted = formatWeatherResultDirectly(null);

      expect(formatted).toContain('Unable to get weather');
    });

    test('handles missing location', () => {
      const result = { temperature: 70, conditions: 'Clear' };
      const formatted = formatWeatherResultDirectly(result);

      expect(formatted).toContain('Unknown location');
    });
  });

  // ============================================
  // Tool Result Summarization
  // ============================================
  describe('summarizeToolResults', () => {

    test('summarizes successful string result', () => {
      const results = [{ success: true, result: 'File contents here' }];
      const summary = summarizeToolResults(results);

      expect(summary).toBe('File contents here');
    });

    test('summarizes multiple results', () => {
      const results = [
        { success: true, result: 'Result 1' },
        { success: true, result: 'Result 2' }
      ];
      const summary = summarizeToolResults(results);

      expect(summary).toContain('Result 1');
      expect(summary).toContain('Result 2');
    });

    test('handles failed results', () => {
      const results = [{ success: false, error: 'Permission denied' }];
      const summary = summarizeToolResults(results);

      expect(summary).toContain('Tool failed');
      expect(summary).toContain('Permission denied');
    });

    test('handles mixed success/failure', () => {
      const results = [
        { success: true, result: 'Success!' },
        { success: false, error: 'Failed' }
      ];
      const summary = summarizeToolResults(results);

      expect(summary).toContain('Success!');
      expect(summary).toContain('Tool failed');
    });

    test('handles object results with summary key', () => {
      const results = [{ success: true, result: { summary: 'Brief summary' } }];
      const summary = summarizeToolResults(results);

      expect(summary).toBe('Brief summary');
    });

    test('handles object results with content key', () => {
      const results = [{ success: true, result: { content: 'Content here' } }];
      const summary = summarizeToolResults(results);

      expect(summary).toBe('Content here');
    });

    test('handles output field', () => {
      const results = [{ output: 'Output text' }];
      const summary = summarizeToolResults(results);

      expect(summary).toBe('Output text');
    });

    test('handles empty array', () => {
      const summary = summarizeToolResults([]);

      expect(summary).toBe('No results returned from tools.');
    });

    test('handles null/undefined', () => {
      expect(summarizeToolResults(null as any)).toBe('No results returned from tools.');
      expect(summarizeToolResults(undefined as any)).toBe('No results returned from tools.');
    });

    test('truncates very long results', () => {
      const longResult = 'x'.repeat(1000);
      const results = [{ success: true, result: { data: longResult } }];
      const summary = summarizeToolResults(results);

      expect(summary.length).toBeLessThanOrEqual(450); // 400 + some overhead
    });

    test('skips null entries in array', () => {
      const results = [null, { success: true, result: 'Valid result' }, undefined];
      const summary = summarizeToolResults(results as any);

      expect(summary).toBe('Valid result');
    });
  });

  // ============================================
  // Error Formatting
  // ============================================
  describe('formatNetworkError', () => {

    test('formats ECONNREFUSED', () => {
      const error = { code: 'ECONNREFUSED', message: 'Connection refused' };
      const formatted = formatNetworkError(error);

      expect(formatted).toContain('⚠️');
      expect(formatted).toContain('Cannot connect');
      expect(formatted).toContain('n8n');
      expect(formatted).toContain('Ollama');
    });

    test('formats ECONNABORTED', () => {
      const error = { code: 'ECONNABORTED', message: 'Timeout' };
      const formatted = formatNetworkError(error);

      expect(formatted).toContain('timed out');
    });

    test('formats ETIMEDOUT', () => {
      const error = { code: 'ETIMEDOUT', message: 'Timeout' };
      const formatted = formatNetworkError(error);

      expect(formatted).toContain('timed out');
    });

    test('formats ENOTFOUND', () => {
      const error = { code: 'ENOTFOUND', message: 'DNS lookup failed' };
      const formatted = formatNetworkError(error);

      expect(formatted).toContain('Could not resolve');
      expect(formatted).toContain('network connection');
    });

    test('formats unknown error with message', () => {
      const error = { code: 'UNKNOWN', message: 'Something went wrong' };
      const formatted = formatNetworkError(error);

      expect(formatted).toContain('⚠️');
      expect(formatted).toContain('Something went wrong');
    });

    test('handles error without message', () => {
      const error = { code: 'UNKNOWN' };
      const formatted = formatNetworkError(error);

      expect(formatted).toContain('Unknown error');
    });
  });

  describe('formatPermissionDenied', () => {

    test('formats single permission', () => {
      const formatted = formatPermissionDenied(['file_write']);

      expect(formatted).toContain('file_write');
      expect(formatted).toContain('permission');
      expect(formatted).toContain('not granted');
    });

    test('formats multiple permissions', () => {
      const formatted = formatPermissionDenied(['file_write', 'file_delete', 'system_access']);

      expect(formatted).toContain('file_write');
      expect(formatted).toContain('file_delete');
      expect(formatted).toContain('system_access');
      expect(formatted).toContain('permissions');
    });

    test('handles empty array', () => {
      const formatted = formatPermissionDenied([]);

      expect(formatted).toContain('not allowed');
    });
  });

  // ============================================
  // Tool Aliases
  // ============================================
  describe('TOOL_ALIASES', () => {

    test('has nba_scores alias', () => {
      expect(TOOL_ALIASES['nba_scores']).toBe('nba_query');
    });

    test('has get_nba_scores alias', () => {
      expect(TOOL_ALIASES['get_nba_scores']).toBe('nba_query');
    });

    test('has weather alias', () => {
      expect(TOOL_ALIASES['weather']).toBe('get_weather');
    });

    test('has time alias', () => {
      expect(TOOL_ALIASES['time']).toBe('get_current_time');
    });

    test('has clipboard alias', () => {
      expect(TOOL_ALIASES['clipboard']).toBe('get_clipboard');
    });

    test('has search alias', () => {
      expect(TOOL_ALIASES['search']).toBe('web_search');
    });
  });

  describe('normalizeToolName', () => {

    test('normalizes known alias', () => {
      expect(normalizeToolName('nba_scores')).toBe('nba_query');
    });

    test('normalizes weather alias', () => {
      expect(normalizeToolName('weather')).toBe('get_weather');
    });

    test('returns original for unknown tool', () => {
      expect(normalizeToolName('custom_tool')).toBe('custom_tool');
    });

    test('returns canonical name unchanged', () => {
      expect(normalizeToolName('nba_query')).toBe('nba_query');
    });
  });

  // ============================================
  // Direct Formatting
  // ============================================
  describe('shouldFormatDirectly', () => {

    test('returns true for nba_query', () => {
      expect(shouldFormatDirectly('nba_query')).toBe(true);
    });

    test('returns true for get_weather', () => {
      expect(shouldFormatDirectly('get_weather')).toBe(true);
    });

    test('returns true for get_current_time', () => {
      expect(shouldFormatDirectly('get_current_time')).toBe(true);
    });

    test('returns true for calculate', () => {
      expect(shouldFormatDirectly('calculate')).toBe(true);
    });

    test('returns true for get_system_info', () => {
      expect(shouldFormatDirectly('get_system_info')).toBe(true);
    });

    test('returns true for aliases', () => {
      expect(shouldFormatDirectly('nba_scores')).toBe(true);
      expect(shouldFormatDirectly('weather')).toBe(true);
    });

    test('returns false for unknown tools', () => {
      expect(shouldFormatDirectly('custom_tool')).toBe(false);
      expect(shouldFormatDirectly('web_search')).toBe(false);
    });
  });

  describe('formatToolResultDirectly', () => {

    test('formats nba_query result', () => {
      const result = { query: 'test', events: [] };
      const formatted = formatToolResultDirectly('nba_query', result);

      expect(formatted).not.toBeNull();
      expect(formatted).toContain('No NBA games');
    });

    test('formats get_weather result', () => {
      const result = { location: 'Seattle', temperature: 55, conditions: 'Cloudy' };
      const formatted = formatToolResultDirectly('get_weather', result);

      expect(formatted).not.toBeNull();
      expect(formatted).toContain('Seattle');
    });

    test('formats get_current_time with time field', () => {
      const result = { time: '2:30 PM' };
      const formatted = formatToolResultDirectly('get_current_time', result);

      expect(formatted).toContain('🕐');
      expect(formatted).toContain('2:30 PM');
    });

    test('formats get_current_time with formatted field', () => {
      const result = { formatted: 'January 3, 2026 2:30 PM' };
      const formatted = formatToolResultDirectly('get_current_time', result);

      expect(formatted).toContain('🕐');
      expect(formatted).toContain('January 3, 2026');
    });

    test('formats get_current_time with string result', () => {
      const formatted = formatToolResultDirectly('get_current_time', '3:45 PM PST');

      expect(formatted).toContain('🕐');
      expect(formatted).toContain('3:45 PM');
    });

    test('formats calculate with result field', () => {
      const result = { result: 42 };
      const formatted = formatToolResultDirectly('calculate', result);

      expect(formatted).toContain('🧮');
      expect(formatted).toContain('42');
    });

    test('formats calculate with answer field', () => {
      const result = { answer: 100 };
      const formatted = formatToolResultDirectly('calculate', result);

      expect(formatted).toContain('🧮');
      expect(formatted).toContain('100');
    });

    test('formats get_system_info with summary', () => {
      const result = { summary: 'Windows 11, 16GB RAM' };
      const formatted = formatToolResultDirectly('get_system_info', result);

      expect(formatted).toContain('💻');
      expect(formatted).toContain('Windows 11');
    });

    test('returns null for unknown tool', () => {
      const formatted = formatToolResultDirectly('unknown_tool', { data: 'test' });

      expect(formatted).toBeNull();
    });

    test('handles alias tool names', () => {
      const result = { query: 'test', events: [] };
      const formatted = formatToolResultDirectly('nba_scores', result);

      expect(formatted).not.toBeNull();
    });

    test('returns null when result lacks expected fields', () => {
      const formatted = formatToolResultDirectly('calculate', { unexpected: 'field' });

      expect(formatted).toBeNull();
    });

    test('returns null for system_info without summary', () => {
      const formatted = formatToolResultDirectly('get_system_info', { os: 'Windows' });

      expect(formatted).toBeNull();
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe('Edge Cases', () => {

    test('formatNbaResultDirectly handles deeply nested null values', () => {
      const result = {
        query: 'test',
        events: [{
          competitions: [{
            competitors: [null, undefined],
            status: null
          }]
        }]
      };

      // Should not throw
      expect(() => formatNbaResultDirectly(result)).not.toThrow();
    });

    test('formatWeatherResultDirectly handles zero values correctly', () => {
      const result = {
        location: 'Antarctica',
        temperature: 0,
        humidity: 0
      };

      const formatted = formatWeatherResultDirectly(result);

      expect(formatted).toContain('0°F');
      expect(formatted).toContain('0%');
    });

    test('normalizeToolName handles empty string', () => {
      expect(normalizeToolName('')).toBe('');
    });

    test('formatToolResultDirectly handles undefined result', () => {
      const formatted = formatToolResultDirectly('get_current_time', undefined);

      // Should return null or handle gracefully
      expect(formatted === null || typeof formatted === 'string').toBe(true);
    });
  });
});
