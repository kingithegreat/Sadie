/**
 * podcast-feed.ts — turn a podcast RSS/Atom feed into Media Studio job material.
 *
 * Ported from ideamake ("The Idea Thief"), which proved this pipeline: feed →
 * episode → 60-second recap video. What is ported is the *ingest* only. The
 * rest of ideamake's pipeline is not needed here, because Media Studio already
 * has the halves ideamake lacked — a state machine, a human approval gate, the
 * publish kill switch, and narration — and this module's output enters that
 * pipeline at `idea` like any other job.
 *
 * Two deliberate simplifications against the original:
 *
 * - No DOM, no XML library. Podcast feeds in the wild are frequently invalid
 *   XML (unescaped ampersands in titles are practically a genre convention), so
 *   ideamake parsed with regex over the raw text and survived feeds a strict
 *   parser rejects. That approach is kept, as pure functions over a string.
 * - No Gemini calls in here. ideamake called @google/genai directly with its
 *   own key handling; in HomeBot the script stage already routes through
 *   generateText(), which uses whichever provider the user configured — Gemini
 *   via the existing google-ai-studio provider when set, the local model when
 *   not. Same "works with no key" behaviour, one key store instead of two.
 *
 * Parsing is pure (string in, episodes out) and fetching is a separate thin
 * function, so the parser is testable without any network.
 */

import axios from 'axios';

export interface PodcastEpisode {
  title: string;
  /** Episode description/show notes, entity-decoded, tags stripped, capped. */
  summary: string;
  /** Publication date as the feed gave it — display only, not parsed. */
  published: string;
  /** itunes:duration as the feed gave it (e.g. "34:12" or "2052"). */
  duration: string;
}

export interface ParsedFeed {
  showTitle: string;
  showDescription: string;
  episodes: PodcastEpisode[];
}

/** Feeds routinely exceed a megabyte of show notes; nobody needs more than this. */
const MAX_SUMMARY_CHARS = 2000;
const MAX_TITLE_CHARS = 200;

// ---- small text helpers -----------------------------------------------------

/** `<![CDATA[...]]>` wrappers off, then the usual five entities plus numeric. */
function cleanXmlText(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Show notes are usually HTML. Keep the words, drop the markup.
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** First `<tag>` content in a fragment, namespace-tolerant on the closing side. */
function extractTag(fragment: string, tag: string): string {
  // Escape ':' etc. for the itunes: namespaced tags.
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = fragment.match(new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc}>`, 'i'));
  return m ? cleanXmlText(m[1]) : '';
}

function extractFirstOfTags(fragment: string, tags: string[]): string {
  for (const t of tags) {
    const v = extractTag(fragment, t);
    if (v) return v;
  }
  return '';
}

// ---- the parser -------------------------------------------------------------

/**
 * Parse RSS 2.0 or Atom text into episodes, newest-first as feeds are ordered.
 *
 * Throws with a plain-language message when nothing parseable is found — the
 * caller shows this to a person, so it says what to try, not what went wrong
 * internally.
 */
export function parsePodcastFeed(xmlText: string, limit = 10): ParsedFeed {
  const text = String(xmlText || '');
  if (!text.trim()) {
    throw new Error('That address returned an empty page — check the link is the podcast feed itself.');
  }

  const isAtom = /<feed[\s>]/i.test(text) && /<entry[\s>]/i.test(text);
  const itemRegex = isAtom
    ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi
    : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;

  // The channel/show header is everything before the first item.
  const firstItem = text.search(isAtom ? /<entry[\s>]/i : /<item[\s>]/i);
  const head = firstItem > 0 ? text.slice(0, firstItem) : text;

  const showTitle = extractTag(head, 'title').slice(0, MAX_TITLE_CHARS) || 'Podcast';
  const showDescription = extractFirstOfTags(head, [
    'description', 'itunes:summary', 'subtitle', 'summary',
  ]).slice(0, MAX_SUMMARY_CHARS);

  const episodes: PodcastEpisode[] = [];
  const cappedLimit = Math.max(1, Math.min(50, Math.floor(limit) || 10));
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(text)) !== null && episodes.length < cappedLimit) {
    const item = m[1];
    const title = extractTag(item, 'title').slice(0, MAX_TITLE_CHARS);
    if (!title) continue; // an untitled item is unusable as a job title
    episodes.push({
      title,
      summary: extractFirstOfTags(item, [
        'description', 'itunes:summary', 'content:encoded', 'summary', 'content',
      ]).slice(0, MAX_SUMMARY_CHARS),
      published: extractFirstOfTags(item, ['pubDate', 'published', 'updated']),
      duration: extractFirstOfTags(item, ['itunes:duration', 'duration']),
    });
  }

  if (episodes.length === 0) {
    throw new Error(
      'No episodes found at that address. It may be a normal web page rather than ' +
      'a podcast feed — look for a link labelled "RSS" on the podcast\'s site.',
    );
  }

  return { showTitle, showDescription, episodes };
}

// ---- job material -----------------------------------------------------------

// The episode→job composition lives in shared/podcast-recap.ts, because the
// renderer's "Make a recap" button needs the identical words — two copies of a
// safety contract drift. Re-exported here so main-process callers (chat
// intents, scheduled automations) find it next to the parser.
export { episodeToJobInput } from '../shared/podcast-recap';

// ---- fetching ---------------------------------------------------------------

/**
 * Fetch feed XML. Some hosts refuse requests without a browser user-agent, so
 * one is sent — ideamake learned that the hard way. 15s cap: a feed host
 * slower than that is down for practical purposes.
 */
export async function fetchFeedXml(url: string, timeoutMs = 15_000): Promise<string> {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) {
    throw new Error('That does not look like a web address — it should start with http:// or https://.');
  }
  const res = await axios.get(clean, {
    timeout: timeoutMs,
    responseType: 'text',
    maxContentLength: 5 * 1024 * 1024,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HomeBot/1.0',
      Accept: 'application/rss+xml, application/xml, text/xml, */*;q=0.8',
    },
    validateStatus: (s) => s >= 200 && s < 300,
    // transformResponse identity: axios would otherwise try JSON.parse first.
    transformResponse: [(d) => d],
  });
  return String(res.data ?? '');
}
