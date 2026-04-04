import { preProcessIntent } from '../message-router';

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
});
