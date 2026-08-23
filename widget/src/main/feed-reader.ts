/**
 * Reading several feeds at once for the Feeds panel.
 *
 * Built on the parts that already existed — `fetchFeedXml` and
 * `parsePodcastFeed` from podcast-feed.ts, and the named-source catalogue in
 * tools/news.ts. Nothing here re-implements RSS; it fans out, merges, and
 * reports honestly about the ones that failed.
 */

import { fetchFeedXml, parsePodcastFeed } from './podcast-feed';
import { FEED_CATALOGUE } from './tools/news';
import { dedupeFeedItems, parseFeedDate, sortByRecency, type FeedItem } from '../shared/feed-search';

export interface FeedSource {
  /** Catalogue key ('bbc') or a full feed URL the user pasted. */
  idOrUrl: string;
}

export interface FeedFetchResult {
  items: FeedItem[];
  /**
   * Sources that could not be read, and why.
   *
   * Reported rather than swallowed: a reading list quietly missing one of five
   * feeds looks like a slow news day, and the user has no way to tell that
   * something is broken.
   */
  failures: Array<{ source: string; reason: string }>;
}

/** How many items to take from any one feed, so a busy source cannot drown the rest. */
const PER_FEED_LIMIT = 25;

/** Resolve a catalogue key or a URL to { name, url }, or null if unusable. */
export function resolveSource(idOrUrl: string): { name: string; url: string } | null {
  const raw = (idOrUrl || '').trim();
  if (!raw) return null;

  const known = FEED_CATALOGUE[raw.toLowerCase()];
  if (known) return { name: raw.toLowerCase(), url: known.url };

  // Only http(s). A file:// or similar here would be a way to read local files
  // through a text box that looks like it only takes web addresses.
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { name: u.hostname.replace(/^www\./, ''), url: raw };
  } catch {
    return null;
  }
}

/** Every source the catalogue offers, for the panel's default view. */
export function catalogueSources(): Array<{ id: string; description: string }> {
  return Object.entries(FEED_CATALOGUE).map(([id, v]) => ({ id, description: v.description }));
}

/**
 * Fetch and merge a set of feeds.
 *
 * Fans out in parallel — five feeds fetched in sequence is five timeouts deep
 * when the network is bad, and the panel would sit blank for a minute.
 */
export async function fetchFeeds(sources: string[], timeoutMs = 15_000): Promise<FeedFetchResult> {
  const resolved = sources
    .map(s => ({ input: s, resolved: resolveSource(s) }));

  const failures: Array<{ source: string; reason: string }> = [];
  for (const r of resolved) {
    if (!r.resolved) {
      failures.push({
        source: r.input,
        reason: 'Not a feed address, and not one of the named sources.',
      });
    }
  }

  const usable = resolved.filter(r => r.resolved) as Array<{ input: string; resolved: { name: string; url: string } }>;

  const settled = await Promise.all(
    usable.map(async ({ resolved: src }) => {
      try {
        const xml = await fetchFeedXml(src.url, timeoutMs);
        const parsed = parsePodcastFeed(xml, PER_FEED_LIMIT);
        const items: FeedItem[] = parsed.episodes.map(e => ({
          title: e.title,
          summary: e.summary,
          published: e.published,
          link: e.link || '',
          // The feed's own title when it has one — nicer than a hostname.
          source: parsed.showTitle || src.name,
          publishedMs: parseFeedDate(e.published),
        }));
        return { items, failure: null as null | { source: string; reason: string } };
      } catch (err: any) {
        return {
          items: [] as FeedItem[],
          failure: { source: src.name, reason: err?.message || 'Could not be read.' },
        };
      }
    })
  );

  const items: FeedItem[] = [];
  for (const s of settled) {
    items.push(...s.items);
    if (s.failure) failures.push(s.failure);
  }

  return { items: sortByRecency(dedupeFeedItems(items)), failures };
}
