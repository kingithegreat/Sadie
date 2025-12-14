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
});
