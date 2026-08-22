/**
 * Reading a page through a rendering proxy, when nothing local can.
 *
 * The tiers below it, and why each runs out:
 *
 *   plain https.get   fastest and fully private, but a great many sites answer
 *                     403 to any non-browser client regardless of user-agent.
 *   BrowserWindow     a real browser, so it beats simple blocks — measured:
 *                     wikipedia 8,000 chars, bbc 7,519. But it does NOT beat a
 *                     JS challenge (realgm.com timed out at 30s) or a paywall
 *                     shell (espn.com yielded 139 characters of navigation).
 *
 * Jina Reader fetches and renders server-side and returns clean markdown.
 * Measured against the same two sites that defeated the browser:
 *
 *   realgm.com   403 / timed out  ->  90,007 chars, with the actual depth chart
 *   espn.com     202 / 139 chars  ->  87,099 chars
 *
 * THE TRADE, stated plainly because it is the whole reason this is switchable:
 * the URL is sent to a third party. HomeBot is local-first, and while the
 * search query already reaches DuckDuckGo, "which page you opened" is a
 * separate disclosure. Off unless allowed; never silent.
 *
 * No account and no key for ordinary use. A key raises the rate limit and is
 * the only thing that would ever be worth adding here.
 */

import * as https from 'https';

/** Jina's own endpoint. The page URL is appended to it verbatim. */
const READER_PREFIX = 'https://r.jina.ai/';

/** It renders the page before answering, so it is slower than a GET. */
const DEFAULT_TIMEOUT_MS = 25_000;

const DEFAULT_MAX_CHARS = 8000;

export interface ReaderFetchResult {
  text: string;
  /** Present when the reader reports one; markdown output leads with it. */
  title: string;
}

/**
 * Only public http/https pages. A loopback or private-range URL must never be
 * handed to an external service — it would ask a third party to reach into a
 * network it can see and the user did not intend to expose. Callers run their
 * own guard too; this is the second one, deliberately.
 */
export function isReaderEligible(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

    // URL keeps IPv6 hosts in their brackets — `new URL('http://[::1]/')`
    // reports the hostname as "[::1]", so comparing against "::1" silently
    // matches nothing. A guard that matches nothing looks exactly like a guard
    // that passed.
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local')) return false;
    // 127/8 entire, not just 127.0.0.1 — 127.0.0.2 is equally loopback.
    if (/^127\./.test(h)) return false;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return false;
    // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
    if (/^::ffff:/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip the reader's own preamble.
 *
 * Its markdown opens with `Title:`, `URL Source:` and sometimes
 * `Published Time:` before `Markdown Content:`. Keeping those wastes context on
 * every fetch and reads as noise inside a summary.
 */
export function parseReaderOutput(raw: string): ReaderFetchResult {
  const text = String(raw || '');
  const titleMatch = /^Title:\s*(.+)$/m.exec(text);
  const marker = text.indexOf('Markdown Content:');
  const body = marker >= 0 ? text.slice(marker + 'Markdown Content:'.length) : text;
  return {
    title: titleMatch ? titleMatch[1].trim() : '',
    text: body.trim(),
  };
}

/** Fetch one page through the reader. Rejects rather than returning empty. */
export function fetchViaReader(
  url: string,
  opts: { timeoutMs?: number; maxChars?: number; apiKey?: string } = {},
): Promise<ReaderFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  if (!isReaderEligible(url)) {
    return Promise.reject(new Error('Only public http/https pages can be read this way'));
  }

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: 'text/plain, text/markdown, */*',
      'User-Agent': 'HomeBot/1.0',
    };
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

    const req = https.get(READER_PREFIX + url, { headers, timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`Reader returned HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        data += chunk;
        // Bail once there is more than enough — a long article should not be
        // downloaded in full only to be sliced.
        if (data.length > maxChars * 4) {
          res.destroy();
        }
      });
      const done = () => {
        const parsed = parseReaderOutput(data);
        resolve({ title: parsed.title, text: parsed.text.slice(0, maxChars) });
      };
      res.on('end', done);
      res.on('close', done);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Reader timed out after ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on('error', (e) => reject(new Error(`Reader request failed: ${e.message}`)));
  });
}
