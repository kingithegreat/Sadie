/**
 * Tests for Google snippet extraction.
 *
 * The shipped code had `const snippet = '';` under a comment saying "try to
 * find snippet near this result" — every Google result carried no text at all.
 * That mattered because when page fetches fail, snippets are the only thing
 * left for the model to reason over.
 */

import { extractSnippetNear } from '../tools/web';

describe('extractSnippetNear', () => {
  it('pulls the descriptive text following a result link', () => {
    const html =
      '<a href="/url?q=https://espn.com/nba">NBA Power Rankings</a>' +
      '<div><span>Our NBA Insiders projected where all 30 NBA teams rank heading into next season.</span></div>';
    expect(extractSnippetNear(html, 0)).toContain('30 NBA teams rank heading into next season');
  });

  it('returns the longest prose block, not the first scrap', () => {
    const html =
      '<div>Cached</div>' +
      '<div>A much longer description that actually explains what the linked page is about.</div>';
    const out = extractSnippetNear(html, 0);
    expect(out).toContain('actually explains what the linked page');
    expect(out).not.toBe('Cached');
  });

  it('skips short UI furniture', () => {
    expect(extractSnippetNear('<div>Cached</div><div>Similar</div>', 0)).toBe('');
  });

  it('skips bare URLs, which are breadcrumbs rather than descriptions', () => {
    const html = '<div>https://www.example.com/some/very/long/breadcrumb/path/here/ok</div>';
    expect(extractSnippetNear(html, 0)).toBe('');
  });

  it('strips nested tags out of the text', () => {
    const html = '<div>Real <b>description</b> text that is definitely long enough to count here.</div>';
    const out = extractSnippetNear(html, 0);
    expect(out).not.toMatch(/<[^>]+>/);
    expect(out).toContain('Real description text');
  });

  it('caps very long text so one result cannot flood a small model', () => {
    const html = `<div>${'x'.repeat(5000)}</div>`;
    expect(extractSnippetNear(html, 0).length).toBeLessThanOrEqual(301);
  });

  it('only looks after the match position, not at the whole page', () => {
    // Text before the link belongs to a different result.
    const earlier = '<div>Text belonging to an entirely different search result up above.</div>';
    const html = earlier + '<div>The description for the result we actually matched on.</div>';
    const out = extractSnippetNear(html, earlier.length);
    expect(out).toContain('result we actually matched');
    expect(out).not.toContain('entirely different search result');
  });

  it('returns empty rather than wrong text when markup is unrecognised', () => {
    expect(extractSnippetNear('', 0)).toBe('');
    expect(extractSnippetNear('<div></div>', 0)).toBe('');
  });

  it('collapses whitespace so the model sees one clean line', () => {
    const html = '<div>Lots\n\n   of\t\tirregular   whitespace in this particular description.</div>';
    expect(extractSnippetNear(html, 0)).toBe('Lots of irregular whitespace in this particular description.');
  });
});
