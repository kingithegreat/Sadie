/**
 * HomeBot Browser Automation Tools
 *
 * Open URLs and web searches in the system's default browser via
 * PowerShell's Start-Process.  Only http/https URLs to public hosts
 * are allowed; file://, local IPs, and localhost are blocked.
 *
 * Tools:
 *   open_in_browser    — open a URL in the default browser
 *   browser_search     — open a web-search query in the default browser
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as http from 'http';
import * as zlib from 'zlib';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execAsync = promisify(exec);

// ----- URL security -----

/** Returns true only for safe http/https public URLs */
function isSafeUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  // Block loopback and private ranges
  if (
    host === 'localhost' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^::1$/.test(host) ||
    /^0\./.test(host) ||
    host === '' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return false;
  }
  return true;
}

/** Escape a URL for use inside a PowerShell single-quoted string */
function sanitizeUrlForPS(url: string): string {
  // Only allow safe chars — strip single-quotes and backticks
  return url.replace(/'/g, '%27').replace(/`/g, '').replace(/[\x00-\x1F]/g, '');
}

// ----- Definitions -----

export const openInBrowserDef: ToolDefinition = {
  name: 'open_in_browser',
  description:
    'Open a URL in the system default browser (Windows). ' +
    'Only public http/https URLs are allowed — localhost and private IPs are blocked.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Full URL to open (must start with http:// or https://)',
      },
    },
    required: ['url'],
  },
};

export const browserSearchDef: ToolDefinition = {
  name: 'browser_search',
  description: 'Open a web-search query in the system default browser (Google search).',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search terms to look up',
      },
      engine: {
        type: 'string',
        description: 'Search engine: "google" (default), "bing", "duckduckgo"',
        default: 'google',
      },
    },
    required: ['query'],
  },
};

// ----- Helpers -----

const SEARCH_URLS: Record<string, string> = {
  google:     'https://www.google.com/search?q=',
  bing:       'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
};

async function openUrl(url: string): Promise<void> {
  const safe = sanitizeUrlForPS(url);
  await execAsync(
    `powershell -NoProfile -NonInteractive -Command "Start-Process '${safe}'"`,
    { timeout: 8000 }
  );
}

// ----- Handlers -----

export const openInBrowserHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const url = String(args.url ?? '').trim();
  if (!url) return { success: false, error: 'url is required' };

  if (!isSafeUrl(url)) {
    return {
      success: false,
      error: `URL blocked: only public http/https URLs are allowed. Got: ${url}`,
    };
  }

  try {
    await openUrl(url);
    return {
      success: true,
      result: {
        opened: true,
        url,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to open browser: ${(err as any)?.message}` };
  }
};

export const browserSearchHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const query = String(args.query ?? '').trim();
  if (!query) return { success: false, error: 'query is required' };

  const engineKey = String(args.engine ?? 'google').toLowerCase();
  const baseUrl = SEARCH_URLS[engineKey] ?? SEARCH_URLS.google;
  const url = baseUrl + encodeURIComponent(query);

  if (!isSafeUrl(url)) {
    return { success: false, error: 'Constructed URL failed safety check' };
  }

  try {
    await openUrl(url);
    return {
      success: true,
      result: {
        opened: true,
        query,
        url,
        engine: engineKey,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to open browser: ${(err as any)?.message}` };
  }
};

// ----- Page content extraction -----

export const fetchPageContentDef: ToolDefinition = {
  name: 'fetch_page_content',
  description:
    'Fetch a web page and extract its text content (HTML tags stripped). ' +
    'Only public http/https URLs are allowed. Returns up to ~8000 characters of page text.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Full URL to fetch (must start with http:// or https://)',
      },
      max_length: {
        type: 'number',
        description: 'Maximum characters to return (default: 8000)',
        default: 8000,
      },
    },
    required: ['url'],
  },
};

/** Minimal HTML-to-text: strip tags, decode common entities, collapse whitespace */
export function htmlToText(html: string): string {
  return html
    // Remove script/style/noscript blocks entirely
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Add newlines for block elements
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article|header|footer)[\s>]/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Fetch raw HTML from a URL with redirect following (max 3 hops) */
export function fetchHtml(url: string, redirectsLeft = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HomeBot/1.0',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
      },
      timeout: 10000,
    }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        const next = new URL(res.headers.location, url).toString();
        return resolve(fetchHtml(next, redirectsLeft - 1));
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          let buf = Buffer.concat(chunks);
          const enc = (res.headers['content-encoding'] || '').toLowerCase();
          if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
          resolve(buf.toString('utf8'));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

export const fetchPageContentHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const url = String(args.url ?? '').trim();
  if (!url) return { success: false, error: 'url is required' };
  if (!isSafeUrl(url)) {
    return { success: false, error: `URL blocked: only public http/https URLs are allowed. Got: ${url}` };
  }

  const maxLen = Math.min(Math.max(100, Number(args.max_length) || 8000), 20000);

  try {
    const html = await fetchHtml(url);
    const text = htmlToText(html);
    const truncated = text.length > maxLen;
    const content = truncated ? text.slice(0, maxLen) + '\n\n[...truncated]' : text;
    return {
      success: true,
      result: { url, length: content.length, truncated, content },
    };
  } catch (err) {
    return { success: false, error: `Failed to fetch page: ${(err as any)?.message}` };
  }
};

// ----- Exports -----

export const browserToolDefs: ToolDefinition[] = [openInBrowserDef, browserSearchDef, fetchPageContentDef];

export const browserToolHandlers: Record<string, ToolHandler> = {
  open_in_browser: openInBrowserHandler,
  browser_search:  browserSearchHandler,
  fetch_page_content: fetchPageContentHandler,
};
