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

  test('does not trigger tools for document payloads', async () => {
    const docMessage = '=== Document: test.txt ===\nThis document mentions results and scores but should not trigger nba query.\n=== End of test.txt ===';
    const res = await preProcessIntent(docMessage);
    expect(res).toBeNull();
  });

  test('pre-processor ignores messages marked by policy', async () => {
    const policyMessage = '[POLICY:FORCE_DOCUMENT]\n=== Document: test.txt ===\ncontent here\n=== End of test.txt ===';
    const res = await preProcessIntent(policyMessage);
    expect(res).toBeNull();
  });
});
