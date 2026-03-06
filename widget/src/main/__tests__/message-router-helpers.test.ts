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
