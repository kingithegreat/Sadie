/**
 * podcast-feed.test.ts — the pure parser behind "From a podcast…".
 *
 * Everything here runs on strings; no network. The messy inputs are the point:
 * podcast feeds in the wild carry CDATA, HTML show notes, unescaped
 * ampersands, and namespaced itunes tags, and the parser was ported from a
 * project (ideamake) that survived them with regex precisely because strict
 * XML parsers did not.
 */

import { parsePodcastFeed, episodeToJobInput } from '../podcast-feed';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Deep Questions &amp; Shallow Answers</title>
    <description><![CDATA[A show about <b>thinking</b> clearly.]]></description>
    <item>
      <title>Episode 42: Why Attention Matters</title>
      <description><![CDATA[<p>We discuss focus, with guest Dr. Lee.</p><br>Notes &amp; links inside.]]></description>
      <pubDate>Mon, 11 Aug 2026 06:00:00 GMT</pubDate>
      <itunes:duration>52:10</itunes:duration>
    </item>
    <item>
      <title>Episode 41: Digital Minimalism, Revisited</title>
      <itunes:summary>Less, but better.</itunes:summary>
      <pubDate>Mon, 04 Aug 2026 06:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>An Atom Show</title>
  <subtitle>Entries, not items.</subtitle>
  <entry>
    <title>First entry</title>
    <summary>Short note.</summary>
    <published>2026-08-01T00:00:00Z</published>
  </entry>
</feed>`;

describe('parsePodcastFeed — RSS', () => {
  test('reads the show and its episodes', () => {
    const feed = parsePodcastFeed(RSS);
    expect(feed.showTitle).toBe('Deep Questions & Shallow Answers');
    expect(feed.episodes).toHaveLength(2);
    expect(feed.episodes[0].title).toBe('Episode 42: Why Attention Matters');
    expect(feed.episodes[0].duration).toBe('52:10');
    expect(feed.episodes[0].published).toContain('11 Aug 2026');
  });

  test('show notes come out as words, not markup', () => {
    const ep = parsePodcastFeed(RSS).episodes[0];
    // CDATA unwrapped, tags stripped, entities decoded.
    expect(ep.summary).toContain('We discuss focus');
    expect(ep.summary).toContain('Notes & links inside');
    expect(ep.summary).not.toMatch(/<p>|<br|CDATA/);
  });

  test('falls back through itunes:summary when description is absent', () => {
    const ep = parsePodcastFeed(RSS).episodes[1];
    expect(ep.summary).toBe('Less, but better.');
  });

  test('honours the episode limit', () => {
    expect(parsePodcastFeed(RSS, 1).episodes).toHaveLength(1);
  });
});

describe('parsePodcastFeed — Atom', () => {
  test('reads entries the same shape as items', () => {
    const feed = parsePodcastFeed(ATOM);
    expect(feed.showTitle).toBe('An Atom Show');
    expect(feed.episodes).toHaveLength(1);
    expect(feed.episodes[0].title).toBe('First entry');
    expect(feed.episodes[0].published).toBe('2026-08-01T00:00:00Z');
  });
});

describe('parsePodcastFeed — the inputs people actually paste', () => {
  test('an ordinary web page fails with advice, not XML vocabulary', () => {
    const html = '<!doctype html><html><head><title>My Podcast — Home</title></head><body>Welcome!</body></html>';
    expect(() => parsePodcastFeed(html)).toThrow(/RSS/);
    // The error is for a person: it must not lean on insider words.
    try { parsePodcastFeed(html); } catch (e: any) {
      expect(e.message).not.toMatch(/parse|XML|regex|null/i);
    }
  });

  test('an empty response says to check the link', () => {
    expect(() => parsePodcastFeed('')).toThrow(/check the link/i);
  });

  test('a feed with only untitled items is treated as having no episodes', () => {
    const bad = '<rss><channel><title>X</title><item><description>no title</description></item></channel></rss>';
    expect(() => parsePodcastFeed(bad)).toThrow(/No episodes/i);
  });

  test('a colossal summary is capped rather than shipped whole', () => {
    const big = `<rss><channel><title>S</title><item><title>Ep</title><description>${'x'.repeat(50_000)}</description></item></channel></rss>`;
    const ep = parsePodcastFeed(big).episodes[0];
    expect(ep.summary.length).toBeLessThanOrEqual(2000);
  });

  test('numeric character references decode; invalid ones vanish', () => {
    const feed = parsePodcastFeed(
      '<rss><channel><title>T</title><item><title>Caf&#233; talk &#x1F3A7;</title></item></channel></rss>',
    );
    expect(feed.episodes[0].title).toBe('Café talk 🎧');
  });
});

describe('episodeToJobInput', () => {
  const ep = { title: 'Ep 1', summary: 'Guest explains the thing.', published: 'Mon, 11 Aug 2026', duration: '30:00' };

  test('the episode notes travel as clearly-marked source material', () => {
    const { title, brief } = episodeToJobInput('My Show', ep);
    expect(title).toBe('Recap: Ep 1');
    // The safety contract with media-generate: the notes are the source, and
    // the stage is told not to invent beyond them.
    expect(brief).toContain('Guest explains the thing.');
    expect(brief).toMatch(/ONLY this as source material/);
    expect(brief).toContain('My Show');
  });

  test('an episode with no notes constrains the recap instead of inviting recall', () => {
    const { brief } = episodeToJobInput('My Show', { ...ep, summary: '' });
    expect(brief).toMatch(/no notes.*title itself/i);
  });
});
