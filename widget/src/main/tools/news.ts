/**
 * HomeBot News Feed Tool
 *
 * Fetches RSS/Atom headlines from popular news sources.
 * No API key required — uses public RSS endpoints.
 */

import * as https from 'https';
import * as http from 'http';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

// ---- Feeds ----
// The built-in catalogue moved to feed-library.ts, which merges it with the
// feeds the user has added. Re-exported here so existing imports still resolve,
// but nothing in this file should read it directly any more: the whole point of
// the library is that a feed the panel shows is a feed chat can fetch, and
// reading the raw constant is how that stops being true.
import { FEED_CATALOGUE, findFeed, listFeeds, noteFetched } from '../feed-library';

export { FEED_CATALOGUE };

// ============= TOOL DEFINITIONS =============

export const getNewsDef: ToolDefinition = {
  name: 'get_news',
  description:
    'Fetch the latest headlines from a news RSS feed. ' +
    `Available sources: ${Object.keys(FEED_CATALOGUE).join(', ')}. ` +
    'You can also pass a custom RSS URL.',
  category: 'web',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description:
          `News source key (${Object.keys(FEED_CATALOGUE).join(', ')}) or a full RSS URL`,
        default: 'bbc'
      },
      limit: {
        type: 'number',
        description: 'Max headlines to return (default: 10, max: 30)',
        default: 10
      },
      topic_filter: {
        type: 'string',
        description: 'Optional keyword to filter headlines by (case-insensitive)'
      }
    },
    required: []
  }
};

export const listNewsFeedsDef: ToolDefinition = {
  name: 'list_news_feeds',
  description: 'List all built-in news feed sources and their descriptions.',
  category: 'web',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  }
};

// ============= HELPERS =============

const MAX_FEED_SIZE = 2 * 1024 * 1024; // 2 MB cap for RSS feeds

function httpGet(url: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'HomeBot-News/1.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpGet(res.headers.location, timeoutMs));
        return;
      }
      let data = '';
      let bytes = 0;
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > MAX_FEED_SIZE) {
          req.destroy();
          resolve(data);
          return;
        }
        data += c.toString();
      });
      res.on('end', () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Feed request timed out'));
    });
    req.on('error', reject);
  });
}

interface NewsItem {
  title: string;
  link: string;
  published: string;
  description: string;
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  // Simple regex-based RSS/Atom parser (no external dependency)
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;

  const decodeEntities = (s: string): string =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
     .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
     .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

  const extractTag = (block: string, tag: string): string => {
    const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
    return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()) : '';
  };

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] || match[2];
    items.push({
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link') || extractTag(block, 'id'),
      published: extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated'),
      description: extractTag(block, 'description') || extractTag(block, 'summary')
    });
  }
  return items;
}

// ============= TOOL HANDLERS =============

export const getNewsHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const source = String(args.source || 'bbc').trim();
    const limit = Math.min(Math.max(1, Number(args.limit) || 10), 30);
    const filter = String(args.topic_filter || '').toLowerCase();

    // Through the library, so a feed the user added is a feed chat can read.
    // Looking the key up in the raw catalogue is what made "my feeds" and "the
    // feeds chat knows about" two different lists.
    const feedEntry = findFeed(source);
    const feedUrl = feedEntry ? feedEntry.url : source;

    if (!feedUrl.startsWith('http')) {
      return {
        success: false,
        error:
          `Unknown source "${source}". Use a full RSS URL, or one of: ` +
          `${listFeeds().map((f) => f.key).join(', ')}.`
      };
    }

    const xml = await httpGet(feedUrl);
    let items = parseRss(xml);

    if (filter) {
      items = items.filter(
        (i) => i.title.toLowerCase().includes(filter) || i.description.toLowerCase().includes(filter)
      );
    }

    // Record the fetch before slicing, so the count reflects what the feed
    // actually carried rather than what this call asked for. Best-effort: it
    // never throws, and a failed note must not fail the fetch.
    if (feedEntry) noteFetched(feedEntry.key, items.length);

    items = items.slice(0, limit);

    return {
      success: true,
      result: {
        source: feedEntry?.description || feedUrl,
        count: items.length,
        items: items.map((i) => ({
          title: i.title,
          link: i.link,
          published: i.published,
          summary: i.description.slice(0, 300)
        })),
        _topicFilter: filter || undefined
      }
    };
  } catch (err: any) {
    return { success: false, error: `get_news failed: ${err.message}` };
  }
};

export const listNewsFeedsHandler: ToolHandler = async (): Promise<ToolResult> => {
  return {
    success: true,
    result: listFeeds().map((f) => ({
      key: f.key,
      description: f.description,
      builtin: f.builtin
    }))
  };
};

// ============= EXPORTS =============

export const newsToolDefs: ToolDefinition[] = [getNewsDef, listNewsFeedsDef];

export const newsToolHandlers: Record<string, ToolHandler> = {
  get_news: getNewsHandler,
  list_news_feeds: listNewsFeedsHandler
};
