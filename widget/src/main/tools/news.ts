/**
 * HomeBot News Feed Tool
 *
 * Fetches RSS/Atom headlines from popular news sources.
 * No API key required — uses public RSS endpoints.
 */

import * as https from 'https';
import * as http from 'http';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

// ---- Built-in feed catalogue ----
const FEED_CATALOGUE: Record<string, { url: string; description: string }> = {
  bbc: { url: 'https://feeds.bbci.co.uk/news/rss.xml', description: 'BBC News top stories' },
  reuters: { url: 'https://feeds.reuters.com/reuters/topNews', description: 'Reuters top news' },
  techcrunch: { url: 'https://techcrunch.com/feed/', description: 'TechCrunch tech news' },
  hacker_news: { url: 'https://hnrss.org/frontpage', description: 'Hacker News front page' },
  ars_technica: { url: 'https://feeds.arstechnica.com/arstechnica/index', description: 'Ars Technica' },
  npr: { url: 'https://feeds.npr.org/1001/rss.xml', description: 'NPR News' },
  guardian: { url: 'https://www.theguardian.com/world/rss', description: 'The Guardian world news' },
  espn: { url: 'https://www.espn.com/espn/rss/news', description: 'ESPN sports news' }
};

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

    const feedEntry = FEED_CATALOGUE[source.toLowerCase()];
    const feedUrl = feedEntry ? feedEntry.url : source;

    if (!feedUrl.startsWith('http')) {
      return { success: false, error: `Unknown source "${source}". Use a key or full RSS URL.` };
    }

    const xml = await httpGet(feedUrl);
    let items = parseRss(xml);

    if (filter) {
      items = items.filter(
        (i) => i.title.toLowerCase().includes(filter) || i.description.toLowerCase().includes(filter)
      );
    }

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
    result: Object.entries(FEED_CATALOGUE).map(([key, val]) => ({ key, description: val.description }))
  };
};

// ============= EXPORTS =============

export const newsToolDefs: ToolDefinition[] = [getNewsDef, listNewsFeedsDef];

export const newsToolHandlers: Record<string, ToolHandler> = {
  get_news: getNewsHandler,
  list_news_feeds: listNewsFeedsHandler
};
