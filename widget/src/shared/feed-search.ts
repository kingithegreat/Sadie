/**
 * Searching across RSS/Atom items.
 *
 * HomeBot could already read feeds — `fetchFeedXml` and `parsePodcastFeed` have
 * worked for a while, and `tools/news.ts` carries a catalogue of named sources —
 * but the only way in was the model calling a tool, or a "paste a podcast feed"
 * box inside Media Studio. There was no way for a person to look through their
 * feeds and find something.
 *
 * Kept pure and in `shared/` so the ranking is testable without network, and so
 * the same function can filter a list the renderer already holds without a
 * round trip to main on every keystroke.
 */

export interface FeedItem {
  title: string;
  /** Description/summary, entity-decoded and tag-stripped upstream. */
  summary: string;
  /** Publication date as the feed gave it — display only. */
  published: string;
  /** Article URL. Empty when a feed omits it, which some do. */
  link: string;
  /** Which feed this came from, for display and grouping. */
  source: string;
  /** Parsed publication time for sorting, or null when unparseable. */
  publishedMs: number | null;
}

/**
 * Feeds date things in whatever format they please, and a bad parse must not
 * reorder someone's reading list — so anything unrecognised sorts as unknown
 * rather than as 1970 or as now.
 */
export function parseFeedDate(published: string): number | null {
  if (!published || !published.trim()) return null;
  const ms = Date.parse(published.trim());
  return Number.isFinite(ms) ? ms : null;
}

/** Newest first. Items with no usable date sink to the bottom, in feed order. */
export function sortByRecency(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => {
    if (a.publishedMs === null && b.publishedMs === null) return 0;
    if (a.publishedMs === null) return 1;
    if (b.publishedMs === null) return -1;
    return b.publishedMs - a.publishedMs;
  });
}

/** Split a query into meaningful terms. */
function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9']+/i)
    .filter(t => t.length > 0);
}

/**
 * Score one item against the query terms.
 *
 * Every term must appear somewhere, so "climate policy" does not return every
 * item mentioning only "policy" — an AND search is what people expect from a
 * search box, and an OR search over a news feed returns everything.
 *
 * A title hit outranks a summary hit because headlines are what the reader is
 * scanning. Returns 0 when the item does not match at all.
 */
export function scoreItem(item: FeedItem, query: string): number {
  const ts = terms(query);
  if (ts.length === 0) return 1; // no query = everything matches equally

  const title = (item.title || '').toLowerCase();
  const summary = (item.summary || '').toLowerCase();
  const source = (item.source || '').toLowerCase();

  let score = 0;
  for (const t of ts) {
    const inTitle = title.includes(t);
    const inSummary = summary.includes(t);
    // Matching the source name counts — "bbc climate" is a reasonable way to
    // ask for climate stories from one feed.
    const inSource = source.includes(t);

    if (!inTitle && !inSummary && !inSource) return 0; // AND: one miss is a miss

    if (inTitle) score += 10;
    if (inSummary) score += 3;
    if (inSource) score += 1;
  }

  // A whole-phrase hit in the title beats the same words scattered around.
  if (ts.length > 1 && title.includes(query.trim().toLowerCase())) score += 15;

  return score;
}

/**
 * Filter and rank items for a query.
 *
 * An empty query returns everything, newest first — the search box starts empty
 * and an empty result there would look broken.
 */
export function searchFeedItems(items: FeedItem[], query: string): FeedItem[] {
  if (!query || !query.trim()) return sortByRecency(items);

  const scored = items
    .map(item => ({ item, score: scoreItem(item, query) }))
    .filter(s => s.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Same relevance — prefer the newer story.
    const am = a.item.publishedMs;
    const bm = b.item.publishedMs;
    if (am === null && bm === null) return 0;
    if (am === null) return 1;
    if (bm === null) return -1;
    return bm - am;
  });

  return scored.map(s => s.item);
}

/**
 * Remove the same story arriving from two feeds.
 *
 * Keyed on link where there is one, falling back to a normalised title —
 * aggregators and a publisher's own feed routinely carry identical items, and
 * seeing each twice makes a reading list feel broken.
 */
export function dedupeFeedItems(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];

  for (const item of items) {
    const key = (item.link || '').trim().toLowerCase()
      || (item.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) { out.push(item); continue; } // nothing to key on; keep it
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}
