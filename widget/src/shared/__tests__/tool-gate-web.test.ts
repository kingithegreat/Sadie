/**
 * Whether the model is offered web tools at all.
 *
 * Reported from real use: asked to "fetch and sumerize", HomeBot printed a
 * `curl` command and reported "Done" without fetching anything. It had not
 * failed to fetch — it had been handed no tools, and a model with no fetch tool
 * has nothing left to offer but a description of fetching.
 *
 * Measured before the fix, nine of ten plainly web-shaped requests got nothing:
 *
 *     NONE  | search the web for the best laptop
 *     NONE  | google how to bake bread
 *     NONE  | fetch https://example.com
 *     TOOLS | what is the weather today
 *
 * The rule required a web word AND a live-data word in the SAME message, so
 * only requests that happened to mention weather or sport qualified.
 */

import { shouldOfferToolsForMessage } from '../model-advisor';

describe('web requests are offered web tools', () => {
  it.each([
    ['a literal URL alone', 'https://example.com/article'],
    ['fetch with a URL', 'fetch https://example.com'],
    ['summarise with a URL', 'summarise https://example.com/article'],
    ['search the web', 'search the web for the best laptop'],
    ['look up', 'look up the capital of Peru'],
    ['google', 'google how to bake bread'],
    ['browse', 'browse to example.com'],
    ['find online', 'find online reviews of the Sony WH-1000XM5'],
  ])('%s', (_name, message) => {
    expect(shouldOfferToolsForMessage(message)).toBe(true);
  });

  test('live-data questions still work — that path was never broken', () => {
    expect(shouldOfferToolsForMessage('what is the weather today')).toBe(true);
  });
});

describe('a follow-up about a link from an earlier turn', () => {
  // "Summarise that" carries no URL of its own. Judging each message alone is
  // what made the follow-up impossible.
  test('offers tools when a link is in recent context', () => {
    expect(shouldOfferToolsForMessage('fetch and sumerize', { contextHasUrl: true })).toBe(true);
    expect(shouldOfferToolsForMessage('summarise that', { contextHasUrl: true })).toBe(true);
    expect(shouldOfferToolsForMessage('read it', { contextHasUrl: true })).toBe(true);
  });

  test('the same words without a link in context do NOT summon tools', () => {
    // "Summarise that" about the conversation itself needs no web tool.
    expect(shouldOfferToolsForMessage('summarise that')).toBe(false);
    expect(shouldOfferToolsForMessage('read it')).toBe(false);
  });

  test('context alone is not enough — the message must ask for something', () => {
    expect(shouldOfferToolsForMessage('what do you think', { contextHasUrl: true })).toBe(false);
    expect(shouldOfferToolsForMessage('thanks', { contextHasUrl: true })).toBe(false);
  });
});

describe('ordinary chat is still left alone', () => {
  // The gate exists because a 7B chooses badly from a long tool list. Opening
  // it wider must not mean opening it always.
  it.each([
    'hello there',
    'what is 2 + 2',
    'explain recursion',
  ])('%s', (message) => {
    expect(shouldOfferToolsForMessage(message)).toBe(false);
  });

  /**
   * Known and deliberately left alone: LIVE_DATA_PATTERN matches bare "today",
   * "rain" and "snow", so "how are you today" and "write me a poem about rain"
   * are offered tools they will never use. That predates this change — verified
   * against origin/main — and it is the opposite failure to the one being fixed
   * here: over-offering costs a little prompt space, under-offering cost the
   * user a curl command labelled "Done".
   *
   * Not folded in because narrowing LIVE_DATA risks the weather path, which
   * works. Asserted here so it is recorded rather than merely absent.
   */
  test('a known over-trigger, unchanged by this fix', () => {
    expect(shouldOfferToolsForMessage('how are you today')).toBe(true);
    expect(shouldOfferToolsForMessage('write me a poem about rain')).toBe(true);
  });

  test('an image request never gets tools, regardless of wording', () => {
    expect(shouldOfferToolsForMessage('search this image', { hasImages: true })).toBe(false);
  });
});
