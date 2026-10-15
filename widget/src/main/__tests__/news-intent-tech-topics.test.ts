// ── NEWS intent: topic-flavoured asks reach the tech feed ──────────────────
//
// Regression for a real session: "search trending channels" / "the latest in
// AI" carried no source name, fell past every sourceKeywords entry, and hit
// the 'bbc' default — top general headlines for a tech question. AI-flavoured
// asks now route to techcrunch with a topic_filter the feed handler narrows.

describe('NEWS intent — tech topics reach the tech feed', () => {
  let preProcessIntent: (msg: string) => Promise<any>;

  beforeAll(() => {
    ({ preProcessIntent } = require('../message-router'));
  });

  test('"latest AI news" routes to techcrunch, not the bbc default', async () => {
    const r = await preProcessIntent('get me the latest AI news');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('get_news');
    expect(r.calls[0].arguments.source).toBe('techcrunch');
  });

  test('"the latest in AI" routes to techcrunch with an AI topic filter', async () => {
    const r = await preProcessIntent('the latest in AI');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('get_news');
    expect(r.calls[0].arguments.source).toBe('techcrunch');
    expect(String(r.calls[0].arguments.topic_filter || '').toLowerCase()).toMatch(/ai/);
  });

  test('"what is new in artificial intelligence" routes to techcrunch via the topic guard', async () => {
    const r = await preProcessIntent('what is new in artificial intelligence');
    expect(r).not.toBeNull();
    // No NEWS trigger word in this phrasing — the topic guard fires instead of
    // the keyword block, so the source comes pre-set with a topic filter.
    expect(r.calls[0].name).toBe('get_news');
    expect(r.calls[0].arguments.source).toBe('techcrunch');
  });

  test('"OpenAI news" routes to techcrunch', async () => {
    const r = await preProcessIntent('OpenAI news');
    expect(r).not.toBeNull();
    expect(r.calls[0].arguments.source).toBe('techcrunch');
  });

  test('plain "top stories" still falls back to bbc (no tech signal)', async () => {
    const r = await preProcessIntent('top stories');
    expect(r).not.toBeNull();
    expect(r.calls[0].name).toBe('get_news');
    expect(r.calls[0].arguments.source).toBe('bbc');
  });

  test('explicit "techcrunch" still wins its own keyword path', async () => {
    const r = await preProcessIntent('techcrunch headlines');
    expect(r).not.toBeNull();
    expect(r.calls[0].arguments.source).toBe('techcrunch');
  });
});
