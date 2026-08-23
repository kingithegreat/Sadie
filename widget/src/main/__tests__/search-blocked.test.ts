/**
 * Telling "refused" apart from "found nothing".
 *
 * Measured against live DuckDuckGo on 2026-08-23 from this machine:
 *
 *   query 1  →  HTTP 200,  33,504 chars,  10 results parsed
 *   query 2  →  HTTP 202,  14,199 chars,   0 results, challenge markers
 *   query 3  →  HTTP 202,  14,187 chars,   0 results, challenge markers
 *
 * `lite.duckduckgo.com` and `html.duckduckgo.com` blocked at the same moment
 * and returned near-identical pages, so this is not a parsing bug and no
 * scraper change fixes it.
 *
 * The trap is the status code: **202 is a success**. Every status check passes,
 * the parser finds no result blocks, and the caller reports "no results found,
 * try different search terms" — to a user whose search terms were never the
 * problem, and for whom every retry will fail the same way. Since DuckDuckGo is
 * last in the provider chain, that is the entire keyless search experience.
 */

import { isSearchBlockPage, SearchBlockedError } from '../tools/web';

// Shape taken from the real 202 body: short, and carrying challenge wording.
const BLOCK_PAGE =
  '<!DOCTYPE html><html><head><title>DuckDuckGo</title></head><body>' +
  '<div class="anomaly-modal__title">Unusual traffic has been detected</div>' +
  '<p>Please try again later.</p></body></html>' +
  'x'.repeat(13_000);

describe('isSearchBlockPage', () => {
  test('recognises the 202 challenge page that has no result blocks', () => {
    expect(isSearchBlockPage(BLOCK_PAGE)).toBe(true);
  });

  test('a large real results page is not a block page', () => {
    // The measured good response was 33.5 KB. Length alone must not decide it,
    // but a full page must never be mistaken for a challenge.
    const realPage = '<div class="result results_links">…</div>'.repeat(50) + 'y'.repeat(33_000);
    expect(isSearchBlockPage(realPage)).toBe(false);
  });

  test('a genuinely empty result page is NOT reported as blocked', () => {
    // This is the case the whole change exists to separate. A short page with
    // no results and no challenge wording means the search really did match
    // nothing, and different search terms ARE the right advice.
    const emptyPage =
      '<!DOCTYPE html><html><body><div class="no-results">No results.</div></body></html>';
    expect(isSearchBlockPage(emptyPage)).toBe(false);
  });

  test('the word "captcha" alone in a big page does not trip it', () => {
    // An article about captchas is a legitimate result, and 33 KB of content
    // with results in it is not a challenge page.
    const article = 'captcha ' + 'z'.repeat(40_000);
    expect(isSearchBlockPage(article)).toBe(false);
  });

  test('markers are matched case-insensitively', () => {
    expect(isSearchBlockPage('UNUSUAL TRAFFIC detected' + 'q'.repeat(100))).toBe(true);
  });
});

describe('SearchBlockedError', () => {
  test('names the provider, so the message can say which one refused', () => {
    const err = new SearchBlockedError('DuckDuckGo');

    expect(err).toBeInstanceOf(Error);
    expect(err.provider).toBe('DuckDuckGo');
    expect(err.name).toBe('SearchBlockedError');
    expect(err.message).toContain('DuckDuckGo');
  });

  test('is distinguishable from an ordinary failure by instanceof', () => {
    // The provider loop catches everything; it can only record a block if the
    // block is a distinct type rather than a string it has to pattern-match.
    expect(new SearchBlockedError('X') instanceof SearchBlockedError).toBe(true);
    expect(new Error('network down') instanceof SearchBlockedError).toBe(false);
  });
});
