/**
 * Searching a reading list.
 *
 * The behaviours worth pinning are the ones that make a search box feel broken
 * when they are wrong: an empty query showing nothing, a two-word query
 * behaving like OR, a bad date shuffling the order, and the same story
 * appearing twice from two feeds.
 */

import {
  searchFeedItems,
  scoreItem,
  sortByRecency,
  dedupeFeedItems,
  parseFeedDate,
  type FeedItem,
} from '../feed-search';

const item = (over: Partial<FeedItem>): FeedItem => ({
  title: 'Untitled',
  summary: '',
  published: 'Sat, 23 Aug 2026 09:00:00 GMT',
  link: '',
  source: 'BBC',
  publishedMs: Date.parse('2026-08-23T09:00:00Z'),
  ...over,
});

const ITEMS: FeedItem[] = [
  item({ title: 'Climate policy shifts in Europe', link: 'https://a/1', publishedMs: 3 }),
  item({ title: 'Local sport roundup', summary: 'Climate was mild for the match', link: 'https://a/2', publishedMs: 2 }),
  item({ title: 'Tech layoffs continue', link: 'https://a/3', source: 'TechCrunch', publishedMs: 1 }),
];

describe('an empty query', () => {
  test('returns everything rather than nothing', () => {
    // The box starts empty. Returning [] there reads as "search is broken".
    expect(searchFeedItems(ITEMS, '')).toHaveLength(3);
    expect(searchFeedItems(ITEMS, '   ')).toHaveLength(3);
  });

  test('and orders it newest first', () => {
    expect(searchFeedItems(ITEMS, '').map(i => i.publishedMs)).toEqual([3, 2, 1]);
  });
});

describe('ranking', () => {
  test('a title hit outranks a summary hit', () => {
    // Both items mention "climate"; the headline is what someone is scanning.
    const results = searchFeedItems(ITEMS, 'climate');
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Climate policy shifts in Europe');
  });

  test('matching is case-insensitive', () => {
    expect(searchFeedItems(ITEMS, 'CLIMATE')).toHaveLength(2);
  });

  test('the source name is searchable', () => {
    // "techcrunch layoffs" is a reasonable way to ask.
    expect(searchFeedItems(ITEMS, 'techcrunch').map(i => i.source)).toEqual(['TechCrunch']);
  });
});

describe('multiple words are AND, not OR', () => {
  test('every term must appear somewhere', () => {
    // OR over a news feed returns the whole feed, which is useless.
    const results = searchFeedItems(ITEMS, 'climate policy');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Climate policy shifts in Europe');
  });

  test('a term that matches nothing yields nothing', () => {
    expect(searchFeedItems(ITEMS, 'climate zebra')).toHaveLength(0);
  });

  test('the exact phrase in a title beats the words scattered about', () => {
    const scattered = item({ title: 'Policy news', summary: 'climate mentioned here', publishedMs: 9 });
    const exact = item({ title: 'Climate policy explained', publishedMs: 1 });
    const results = searchFeedItems([scattered, exact], 'climate policy');
    expect(results[0].title).toBe('Climate policy explained');
  });
});

describe('dates', () => {
  test('an unparseable date is null, not zero and not now', () => {
    // Either wrong value would silently reorder someone's reading list.
    expect(parseFeedDate('not a date')).toBeNull();
    expect(parseFeedDate('')).toBeNull();
    expect(parseFeedDate('Sat, 23 Aug 2026 09:00:00 GMT')).toBe(Date.parse('2026-08-23T09:00:00Z'));
  });

  test('undated items sink to the bottom instead of jumping to the top', () => {
    const undated = item({ title: 'No date', publishedMs: null });
    const sorted = sortByRecency([undated, ...ITEMS]);
    expect(sorted[sorted.length - 1].title).toBe('No date');
  });

  test('sorting does not mutate the input', () => {
    const input = [...ITEMS];
    sortByRecency(input);
    expect(input.map(i => i.publishedMs)).toEqual([3, 2, 1]);
  });
});

describe('the same story from two feeds', () => {
  test('is shown once, keyed on the link', () => {
    const a = item({ title: 'Shared story', link: 'https://x/1', source: 'BBC' });
    const b = item({ title: 'Shared story (syndicated)', link: 'https://x/1', source: 'Reuters' });
    expect(dedupeFeedItems([a, b])).toHaveLength(1);
  });

  test('falls back to the title when a feed omits the link', () => {
    const a = item({ title: 'Same headline', link: '' });
    const b = item({ title: 'Same  headline ', link: '' });
    expect(dedupeFeedItems([a, b])).toHaveLength(1);
  });

  test('keeps items that have nothing to key on rather than dropping them', () => {
    const blank = item({ title: '', link: '' });
    expect(dedupeFeedItems([blank, blank])).toHaveLength(2);
  });

  test('genuinely different stories both survive', () => {
    expect(dedupeFeedItems(ITEMS)).toHaveLength(3);
  });
});

describe('scoreItem', () => {
  test('a non-match scores zero', () => {
    expect(scoreItem(ITEMS[0], 'zebra')).toBe(0);
  });

  test('no query matches everything equally', () => {
    expect(scoreItem(ITEMS[0], '')).toBe(1);
  });
});
