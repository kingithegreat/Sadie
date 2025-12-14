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
});
