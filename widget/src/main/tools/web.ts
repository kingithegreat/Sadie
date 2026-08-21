/**
 * HomeBot Web Tools
 * 
 * Provides web search and URL fetching capabilities.
 * Uses DuckDuckGo for search (no API key required).
 */

import { ToolDefinition, ToolHandler, ToolResult } from './types';
import * as https from 'https';
import * as http from 'http';
import * as dns from 'dns';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { app } from 'electron';
import { isE2E } from '../env';

// Keep-alive agents — reuse TCP+TLS connections across requests
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 6, timeout: 60000 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 6, timeout: 60000 });

// Response body size limits (bytes)
const MAX_TEXT_RESPONSE = 2 * 1024 * 1024;   // 2 MB for HTML/text fetches
const MAX_BINARY_RESPONSE = 10 * 1024 * 1024; // 10 MB for image buffers
const MAX_API_RESPONSE = 5 * 1024 * 1024;     // 5 MB for API JSON responses

// Search/image API keys — loaded from settings on first use
let _tavilyApiKey: string | null = null;
let _serperApiKey: string | null = null;
let _openaiApiKey: string | null = null;
let _stableHordeApiKey: string | null = null;

export function setTavilyApiKey(key: string | null) {
  _tavilyApiKey = key;
}

export function setStableHordeApiKey(key: string | null) {
  _stableHordeApiKey = key;
}

export function getTavilyApiKey(): string | null {
  return _tavilyApiKey;
}

export function setSerperApiKey(key: string | null) {
  _serperApiKey = key;
}

export function getSerperApiKey(): string | null {
  return _serperApiKey;
}

export function setOpenaiApiKey(key: string | null) {
  _openaiApiKey = key;
}

export function getOpenaiApiKey(): string | null {
  return _openaiApiKey;
}

// ============= TOOL DEFINITIONS =============

export const webSearchDef: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web and get results. Automatically fetches and summarises content from multiple top sources to provide accurate, up-to-date answers. Use this when the user asks about current events, sports, news, facts you\'re unsure about, or anything that requires up-to-date information.',
  category: 'web',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        // The description carries this rule because the observed failure was a
        // raw follow-up passed straight through: "but who is likely to make the
        // playoffs?" searched verbatim returns NFL results, because the phrase
        // is dominated by NFL content and the conversation's subject was never
        // in the query. The model is the only place that knows the subject.
        description:
          'A STANDALONE search query. The user\'s message is often a follow-up that makes no ' +
          'sense on its own — rewrite it so a stranger who has not read the conversation would ' +
          'understand it. Carry the subject over from earlier turns, and include the year or ' +
          'season. Drop filler like "but", "so", "I\'m talking about". ' +
          'Example: after discussing basketball, "but who is likely to make the playoffs?" must ' +
          'become "NBA 2026-27 season playoff predictions", NOT "who is likely to make the playoffs".'
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of search results to return (default: 5, max: 10)',
        default: 5
      },
      fetchResultCount: {
        type: 'number',
        description: 'Number of top results to fetch full content from and summarise (default: 3, max: 5). Higher values give more complete answers but take slightly longer.',
        default: 3
      },
      fetchTopResult: {
        type: 'boolean',
        description: 'Automatically fetch content from top results (default: true)',
        default: true
      }
    },
    required: ['query']
  }
};

export const fetchUrlDef: ToolDefinition = {
  name: 'fetch_url',
  description: 'Fetch and extract the main text content from a URL. Useful for reading articles, documentation, or any web page. Returns cleaned text without HTML tags.',
  category: 'web',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (must start with http:// or https://)'
      },
      maxLength: {
        type: 'number',
        description: 'Maximum characters to return (default: 5000)',
        default: 5000
      }
    },
    required: ['url']
  }
};

export const getWeatherDef: ToolDefinition = {
  name: 'get_weather',
  description: 'Get current weather information for a location using wttr.in (no API key needed).',
  category: 'web',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or location (e.g., "London", "New York", "Tokyo")'
      }
    },
    required: ['location']
  }
};

// ============= HELPER FUNCTIONS =============

function httpGet(url: string, headers: Record<string, string> = {}, redirectsLeft = 5): Promise<string> {
  return new Promise(async (resolve, reject) => {
    if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
    // Validate the URL before attempting any network request to mitigate SSRF/local access
    try {
      const safe = await isUrlSafe(url);
      if (!safe.ok) {
        return reject(new Error('Blocked unsafe URL'));
      }
    } catch (err) {
      return reject(new Error('Blocked unsafe URL'));
    }
    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;
    
    const options = {
      agent: isHttps ? httpsAgent : httpAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...headers
      }
    };

    const req = client.get(url, options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return httpGet(redirectUrl, headers, redirectsLeft - 1).then(resolve).catch(reject);
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      let bytes = 0;
      res.setEncoding('utf8');
      res.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_TEXT_RESPONSE) {
          req.destroy();
          resolve(data); // return what we have so far
          return;
        }
        data += chunk;
      });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// ============= URL SAFETY CHECKS =============
async function isUrlSafe(urlString: string): Promise<{ ok: boolean; message?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch (e) {
    return { ok: false, message: 'Invalid URL' };
  }

  const protocol = parsed.protocol.replace(':', '');
  if (protocol !== 'http' && protocol !== 'https') {
    return { ok: false, message: 'Unsupported protocol' };
  }

  if (parsed.protocol === 'file:') {
    return { ok: false, message: 'file protocol blocked' };
  }

  const hostname = parsed.hostname;
  // quick hostname checks
  if (!hostname) return { ok: false, message: 'Empty hostname' };

  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1') {
    return { ok: false, message: 'Loopback hostname blocked' };
  }

  // If hostname is an IP literal, validate directly
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    if (isPrivateIPv4(hostname)) return { ok: false, message: 'IPv4 private range' };
    return { ok: true };
  }
  if (ipVersion === 6) {
    // block IPv6 loopback
    if (hostname === '::1') return { ok: false, message: 'IPv6 loopback blocked' };
    return { ok: true };
  }

  // Resolve DNS and check all addresses
  try {
    const records = await dns.promises.lookup(hostname, { all: true });
    for (const rec of records) {
      if (rec.family === 4) {
        if (isPrivateIPv4(rec.address)) return { ok: false, message: 'Resolved to private IPv4' };
        if (rec.address.startsWith('127.')) return { ok: false, message: 'Resolved to loopback' };
      }
      if (rec.family === 6) {
        if (rec.address === '::1') return { ok: false, message: 'Resolved to IPv6 loopback' };
      }
    }
  } catch (err) {
    // If DNS resolution fails, be conservative and allow the request to proceed
    // (failure to resolve does not imply safety issues). Return ok here so callers
    // will receive the network error instead of a blocked error.
    return { ok: true };
  }

  return { ok: true };
}

function isPrivateIPv4(ip: string): boolean {
  // convert to 32-bit number
  const parts = ip.split('.').map(s => parseInt(s, 10));
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p))) return false;
  const num = ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);

  const inRange = (start: string, maskBits: number) => {
    const sp = start.split('.').map(s => parseInt(s, 10));
    const startNum = ((sp[0] << 24) >>> 0) + ((sp[1] << 16) >>> 0) + ((sp[2] << 8) >>> 0) + (sp[3] >>> 0);
    const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
    return (num & mask) === (startNum & mask);
  };

  // 10.0.0.0/8
  if (inRange('10.0.0.0', 8)) return true;
  // 172.16.0.0/12
  if (inRange('172.16.0.0', 12)) return true;
  // 192.168.0.0/16
  if (inRange('192.168.0.0', 16)) return true;
  // 127.0.0.0/8 (loopback)
  if (inRange('127.0.0.0', 8)) return true;

  return false;
}

// ============= SIMPLE IN-MEMORY CACHE =============
type CacheEntry = { data: any; expires: number };
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const webCache: Map<string, CacheEntry> = new Map();

function getFromCache(key: string): any | null {
  if (isE2E) return null;
  const entry = webCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    webCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any) {
  if (isE2E) return;
  webCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

function stripHtml(html: string): string {
  // Remove script and style tags with content
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&apos;/g, "'");
  
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

function extractMainContent(html: string): string {
  // Try to find main content areas
  const mainPatterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  
  for (const pattern of mainPatterns) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      // Return the longest match (likely the main content)
      const longest = matches.reduce((a, b) => a.length > b.length ? a : b);
      return stripHtml(longest);
    }
  }
  
  // Fallback: strip all HTML
  return stripHtml(html);
}

// ============= SEARCH HELPERS =============

// Filter out search-engine pages (not content sources) from scraper results.
// Wikipedia is intentionally NOT blocked here — it's one of the best free
// sources of factual and current-events content.
/** Exported so the allow-list can be verified in unit tests. */
export function isAllowedDomain(url: string): boolean {
  const blockedDomains = [
    'duckduckgo.com',
    'google.com/search',
    'bing.com/search',
    'brave.com',
    'account.brave.com',
    'search.brave.com'
  ];
  return !blockedDomains.some(domain => url.includes(domain));
}

// Search using Google (most reliable)
/**
 * Pull the descriptive text that follows a Google result link.
 *
 * Google's class names are obfuscated and change often, so matching on them is
 * a losing game. Instead take the markup just after the link, strip tags, and
 * keep the longest run of plain prose — that is reliably the snippet, and it
 * degrades to '' rather than to wrong text when the layout changes.
 */
export function extractSnippetNear(html: string, fromIndex: number): string {
  const WINDOW = 1200;
  const region = html.slice(fromIndex, fromIndex + WINDOW);

  const candidates = region
    .split(/<\/?(?:div|span|td|br|p)[^>]*>/i)
    .map(chunk => stripHtml(chunk).replace(/\s+/g, ' ').trim())
    // Drop UI furniture ("Cached", "Similar", breadcrumbs) and anything too
    // short to be a real description.
    .filter(text => text.length >= 40 && /[a-z]{3}/i.test(text) && !/^https?:\/\//i.test(text));

  if (candidates.length === 0) return '';
  const best = candidates.reduce((a, b) => (b.length > a.length ? b : a));
  return best.length > 300 ? best.slice(0, 300) + '…' : best;
}

async function searchGoogle(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://www.google.com/search?q=${encodedQuery}&num=${maxResults + 5}&hl=en`;
  
  console.log('[HomeBot Web] Searching Google for:', query);
  const html = await httpGet(searchUrl);
  console.log('[HomeBot Web] Google response length:', html.length);
  
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  
  // Google wraps results in <div class="g"> or similar patterns
  // Look for links with /url?q= redirect pattern
  const urlPattern = /href="\/url\?q=([^&"]+)&[^"]*"[^>]*>([^<]+)/gi;
  let match;
  
  while ((match = urlPattern.exec(html)) !== null && results.length < maxResults) {
    try {
      const url = decodeURIComponent(match[1]);
      const title = stripHtml(match[2]).trim();
      
      if (!url || !title || url.length < 10) continue;
      if (!isAllowedDomain(url)) continue;
      if (!url.startsWith('http')) continue;
      
      // Google's snippet sits in the markup after the result link. This was
      // hardcoded to '' under a "try to find snippet" comment, so every Google
      // result arrived with no text at all — and when page fetches also fail,
      // the snippet fallback below has nothing to fall back to.
      const snippet = extractSnippetNear(html, match.index);

      results.push({ title, url, snippet });
    } catch (e) {
      continue;
    }
  }
  
  // Alternative parsing: look for direct links in search results
  if (results.length === 0) {
    const directLinkPattern = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
    while ((match = directLinkPattern.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = stripHtml(match[2]).trim();
      
      if (!url || !title || title.length < 5) continue;
      if (!isAllowedDomain(url)) continue;
      if (url.includes('google.com')) continue;
      
      // Avoid duplicates
      if (results.some(r => r.url === url)) continue;
      
      results.push({ title, url, snippet: '' });
    }
  }
  
  return results;
}

// Search using DuckDuckGo HTML (fallback — scraper, brittle)
async function searchDuckDuckGo(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
  
  console.log('[HomeBot Web] Searching DuckDuckGo for:', query);
  const html = await httpGet(searchUrl);
  console.log('[HomeBot Web] DDG response length:', html.length);
  
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // DDG HTML structure as of 2024–2025: result items use class="result results_links"
  // Try splitting on the result container class patterns
  const blockSplitters = [
    /<div class="result\s+results_links/gi,
    /<div class="results_links/gi,
    /<div class="web-result/gi,
  ];

  for (const splitter of blockSplitters) {
    const resultBlocks = html.split(splitter);
    if (resultBlocks.length < 2) continue;

    for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
      const block = resultBlocks[i];
      if (block.includes('result--ad')) continue;

      // Title + URL: <a class="result__a" href="...">Title</a>
      //   OR newer: <h2 class="result__title"><a href="...">Title</a></h2>
      const titleMatch =
        block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i);
      if (!titleMatch) continue;

      const rawUrl = titleMatch[1];
      const title = stripHtml(titleMatch[2]).trim();

      // Snippet: <a class="result__snippet" ...> or <div class="result__snippet">
      const snippetMatch =
        block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/<div[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : '';

      if (!rawUrl || !title) continue;

      // Decode DDG redirect URL (/url?uddg=...)
      let finalUrl = rawUrl;
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try { finalUrl = decodeURIComponent(uddgMatch[1]); } catch { finalUrl = rawUrl; }
      }

      if (!isAllowedDomain(finalUrl)) continue;
      results.push({ title, url: finalUrl, snippet });
    }

    if (results.length > 0) break; // found results with this splitter, stop trying
  }

  // Last-resort: extract any external https links with meaningful anchor text
  if (results.length === 0) {
    const linkPat = /<a[^>]*href="(https?:\/\/(?!(?:www\.)?duckduckgo\.com)[^"]+)"[^>]*>([^<]{10,100})<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkPat.exec(html)) !== null && results.length < maxResults) {
      const url = m[1];
      const title = stripHtml(m[2]).trim();
      if (!isAllowedDomain(url)) continue;
      if (results.some(r => r.url === url)) continue;
      results.push({ title, url, snippet: '' });
    }
  }
  
  return results;
}

// Search using DuckDuckGo Lite (simpler HTML, more reliable than full DDG)
async function searchDDGLite(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`;

  console.log('[HomeBot Web] Searching DDG Lite for:', query);
  const html = await httpGet(searchUrl, {
    'Accept': 'text/html',
    'Accept-Language': 'en-US,en;q=0.5',
  });
  console.log('[HomeBot Web] DDG Lite response length:', html.length);

  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // DDG Lite uses simple table rows:
  //   <a rel="nofollow" href="URL" class="result-link">Title</a>
  //   followed by <td class="result-snippet">Snippet text</td>
  const linkPat = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPat = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkPat.exec(html)) !== null) {
    const url = m[1].trim();
    const title = stripHtml(m[2]).trim();
    if (url.startsWith('http') && title.length > 3 && isAllowedDomain(url)) {
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((m = snippetPat.exec(html)) !== null) {
    snippets.push(stripHtml(m[1]).trim());
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || '',
    });
  }

  return results;
}

// Search using Brave Search (another fallback)
async function searchBrave(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://search.brave.com/search?q=${encodedQuery}`;
  
  console.log('[HomeBot Web] Searching Brave for:', query);
  const html = await httpGet(searchUrl);
  console.log('[HomeBot Web] Brave response length:', html.length);
  
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  
  // Brave uses data attributes for results
  const linkPattern = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result-header[^"]*"[^>]*>([^<]*)<\/a>/gi;
  let match;
  
  while ((match = linkPattern.exec(html)) !== null && results.length < maxResults) {
    const url = match[1];
    const title = stripHtml(match[2]).trim();
    
    if (!url || !title) continue;
    if (!isAllowedDomain(url)) continue;
    
    results.push({ title, url, snippet: '' });
  }
  
  // Alternative pattern for Brave
  if (results.length === 0) {
    const altPattern = /<a[^>]*href="(https?:\/\/(?!search\.brave)[^"]+)"[^>]*>([^<]{10,})<\/a>/gi;
    while ((match = altPattern.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = stripHtml(match[2]).trim();
      
      if (!url || !title || title.length < 5) continue;
      if (!isAllowedDomain(url)) continue;
      if (results.some(r => r.url === url)) continue;
      
      results.push({ title, url, snippet: '' });
    }
  }
  
  return results;
}

// ============= DUCKDUCKGO INSTANT ANSWER API (free, no key) =============
// Uses DDG's structured JSON endpoint — not HTML scraping. Returns instant
// answers, abstracts (usually from Wikipedia), and related topic links.
// Reliable for factual and current-events queries without any API key.

async function searchDDGInstant(query: string): Promise<{
  results: Array<{ title: string; url: string; snippet: string }>;
  sources: Array<{ url: string; title: string; content: string }>;
  answer?: string;
} | null> {
  const encodedQuery = encodeURIComponent(query);
  const apiUrl = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

  console.log('[HomeBot Web] Querying DDG Instant Answer API for:', query);
  const raw = await httpGet(apiUrl, { 'Accept': 'application/json' });
  const json = JSON.parse(raw);

  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const sources: Array<{ url: string; title: string; content: string }> = [];
  let answer: string | undefined;

  // Direct answer (e.g. "What is 2+2?")
  if (json.Answer) answer = String(json.Answer);

  // Abstract — usually sourced from Wikipedia or other authoritative sources
  if (json.AbstractText && json.AbstractURL) {
    const content = String(json.AbstractText);
    const url = String(json.AbstractURL);
    const title = String(json.Heading || json.AbstractSource || query);
    results.push({ title, url, snippet: content.slice(0, 300) });
    if (content.length > 50) {
      sources.push({ url, title, content });
    }
    if (!answer && content) answer = content;
  }

  // Related topics — each has a text snippet and link
  if (Array.isArray(json.RelatedTopics)) {
    for (const topic of json.RelatedTopics) {
      // Some entries are sub-groups ({Topics: [...]}), skip them
      if (!topic.FirstURL || !topic.Text) continue;
      const url = String(topic.FirstURL);
      const text = String(topic.Text);
      const title = text.split(' - ')[0]?.trim() || text.slice(0, 80);
      results.push({ title, url, snippet: text.slice(0, 300) });
      if (text.length > 50) {
        sources.push({ url, title, content: text });
      }
      if (results.length >= 8) break;
    }
  }

  // Results block (less common but used for some queries)
  if (Array.isArray(json.Results)) {
    for (const r of json.Results) {
      if (!r.FirstURL || !r.Text) continue;
      results.push({ title: r.Text.slice(0, 80), url: r.FirstURL, snippet: r.Text });
    }
  }

  if (results.length === 0 && !answer) return null;
  console.log(`[HomeBot Web] DDG Instant returned ${results.length} results, answer=${!!answer}`);
  return { results, sources, answer };
}

// ============= TAVILY SEARCH (AI-optimized, structured JSON) =============

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  raw_content?: string;
}

interface TavilyResponse {
  query: string;
  answer?: string;
  results: TavilyResult[];
  response_time: number;
}

async function searchTavily(query: string, maxResults: number): Promise<{
  results: Array<{ title: string; url: string; snippet: string }>;
  sources: Array<{ url: string; title: string; content: string }>;
  answer?: string;
}> {
  const apiKey = getTavilyApiKey();
  if (!apiKey) throw new Error('Tavily API key not configured');

  const body = JSON.stringify({
    query,
    max_results: maxResults,
    include_answer: true,
    include_raw_content: false,
    search_depth: 'basic'
  });

  console.log('[HomeBot Web] Searching Tavily for:', query);

  const data = await new Promise<string>((resolve, reject) => {
    const req = https.request('https://api.tavily.com/search', {
      method: 'POST',
      agent: httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let errBody = '';
        res.on('data', (c: Buffer) => errBody += c.toString());
        res.on('end', () => reject(new Error(`Tavily HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`)));
        return;
      }
      let d = '';
      let bytes = 0;
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > MAX_API_RESPONSE) { req.destroy(); resolve(d); return; }
        d += c.toString();
      });
      res.on('end', () => resolve(d));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Tavily timeout')); });
    req.write(body);
    req.end();
  });

  const json: TavilyResponse = JSON.parse(data);
  console.log(`[HomeBot Web] Tavily returned ${json.results?.length || 0} results in ${json.response_time}s`);

  const results = (json.results || []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.content || ''
  }));

  // Collect clean content from ALL results Tavily returned (it already pre-cleans them)
  const sources: Array<{ url: string; title: string; content: string }> = (json.results || [])
    .filter(r => r.content && r.content.length > 50)
    .map(r => ({
      url: r.url,
      title: r.title,
      content: r.content
    }));

  return { results, sources, answer: json.answer };
}

/**
 * Search using Serper.dev Google Search API (secondary paid provider).
 * POST https://google.serper.dev/search
 * Header: X-API-KEY
 * Returns structured Google results as JSON — no HTML scraping.
 */
async function searchSerper(
  query: string,
  maxResults: number
): Promise<{ results: Array<{ title: string; url: string; snippet: string }>; topContent?: { url: string; title: string; content: string } }> {
  const apiKey = getSerperApiKey();
  if (!apiKey) throw new Error('Serper API key not configured');

  const body = JSON.stringify({
    q: query,
    num: maxResults
  });

  const raw = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'google.serper.dev',
        path: '/search',
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 15000
      },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString()));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Serper API ${res.statusCode}: ${data.substring(0, 200)}`));
          } else {
            resolve(data);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Serper request timed out')); });
    req.write(body);
    req.end();
  });

  const json = JSON.parse(raw);

  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Serper returns { organic: [{ title, link, snippet, ... }], answerBox?, knowledgeGraph?, ... }
  if (json.organic && Array.isArray(json.organic)) {
    for (const item of json.organic.slice(0, maxResults)) {
      results.push({
        title: item.title || '',
        url: item.link || '',
        snippet: item.snippet || ''
      });
    }
  }

  // Build topContent from answer box or knowledge graph if available
  let topContent: { url: string; title: string; content: string } | undefined;

  if (json.answerBox) {
    const ab = json.answerBox;
    topContent = {
      url: ab.link || results[0]?.url || '',
      title: ab.title || 'Answer',
      content: ab.answer || ab.snippet || ab.snippetHighlighted || ''
    };
  } else if (json.knowledgeGraph) {
    const kg = json.knowledgeGraph;
    const kgParts: string[] = [];
    if (kg.description) kgParts.push(kg.description);
    if (kg.attributes) {
      for (const [k, v] of Object.entries(kg.attributes)) {
        kgParts.push(`${k}: ${v}`);
      }
    }
    if (kgParts.length > 0) {
      topContent = {
        url: kg.descriptionLink || results[0]?.url || '',
        title: kg.title || 'Knowledge Graph',
        content: kgParts.join('\n')
      };
    }
  }

  return { results, topContent };
}

// ============= SEARCH PROVIDER REGISTRY =============
// Unified return shape for every provider.
interface SearchProviderResult {
  results: Array<{ title: string; url: string; snippet: string }>;
  sources: Array<{ url: string; title: string; content: string }>;
  answer?: string;
}

// Common strategy interface — each provider implements search() and reports
// whether it is currently available (e.g. API key present).
interface SearchProvider {
  name: string;
  available(): boolean;
  search(query: string, maxResults: number, fetchCount: number): Promise<SearchProviderResult | null>;
}

const SEARCH_PROVIDERS: SearchProvider[] = [
  {
    name: 'Tavily',
    available: () => !!getTavilyApiKey(),
    search: async (query, max, fetchCount) => {
      const r = await searchTavily(query, max);
      return { results: r.results, sources: r.sources.slice(0, fetchCount), answer: r.answer };
    }
  },
  {
    name: 'Serper',
    available: () => !!getSerperApiKey(),
    search: async (query, max) => {
      const r = await searchSerper(query, max);
      const sources = (r.topContent && r.topContent.content.length > 50) ? [r.topContent] : [];
      return { results: r.results, sources };
    }
  },
  {
    name: 'DDG Instant',
    available: () => true,
    search: async (query, _max, fetchCount) => {
      const r = await searchDDGInstant(query);
      if (!r) return null;
      // Instant answer with no related topics — synthesise a single result so
      // the payload always has something for the LLM to work with.
      const results = r.results.length > 0
        ? r.results
        : r.answer
          ? [{ title: 'Instant Answer', url: 'https://duckduckgo.com', snippet: r.answer }]
          : [];
      if (results.length === 0) return null;
      return { results, sources: r.sources.slice(0, fetchCount), answer: r.answer };
    }
  },
  {
    name: 'DuckDuckGo',
    available: () => true,
    search: async (query, max) => {
      const r = await searchDuckDuckGo(query, max);
      return r.length > 0 ? { results: r, sources: [] } : null;
    }
  },
  {
    name: 'DDG Lite',
    available: () => true,
    search: async (query, max) => {
      const r = await searchDDGLite(query, max);
      return r.length > 0 ? { results: r, sources: [] } : null;
    }
  },
  {
    name: 'Google',
    available: () => true,
    search: async (query, max) => {
      const r = await searchGoogle(query, max);
      return r.length > 0 ? { results: r, sources: [] } : null;
    }
  },
  {
    name: 'Brave',
    available: () => true,
    search: async (query, max) => {
      const r = await searchBrave(query, max);
      return r.length > 0 ? { results: r, sources: [] } : null;
    }
  }
];

// ============= TOOL HANDLERS =============

export const webSearchHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const query = args.query;
    if (!query || typeof query !== 'string') {
      return { success: false, error: 'Search query is required' };
    }
    
    const maxResults = Math.min(Math.max(1, args.maxResults || 5), 10);
    const cacheKey = `web_search:${query}:${maxResults}:${String(args.fetchTopResult)}`;

    const cached = getFromCache(cacheKey);
    if (cached) {
      return { success: true, result: { ...cached }, fromCache: true } as any;
    }

    const fetchResultCount = Math.min(Math.max(1, args.fetchResultCount || 3), 5);

    // Read once per search rather than per source. Defaults to OFF: this is
    // the one fallback that sends a URL to a third party, and a local-first
    // app does not opt the user into that quietly.
    let readerAllowed = false;
    try {
      const { getSettings: getWebSettings } = await import('../config-manager');
      readerAllowed = !!(getWebSettings() as any)?.webReaderFallbackEnabled;
    } catch { /* settings unavailable (tests) — stay off */ }

    // Try each provider in order until one returns results.
    let results: Array<{ title: string; url: string; snippet: string }> = [];
    let tavilyAnswer: string | undefined;
    let tavilySources: Array<{ url: string; title: string; content: string }> = [];
    let searchProvider = 'none';

    for (const provider of SEARCH_PROVIDERS) {
      if (!provider.available()) continue;
      try {
        console.log(`[HomeBot Web] Trying ${provider.name}...`);
        const providerResult = await provider.search(query, maxResults, fetchResultCount);
        if (providerResult && providerResult.results.length > 0) {
          results = providerResult.results;
          tavilySources = providerResult.sources;
          if (providerResult.answer) tavilyAnswer = providerResult.answer;
          searchProvider = provider.name;
          console.log(`[HomeBot Web] ${provider.name} returned ${results.length} results`);
          break;
        }
      } catch (err: any) {
        console.log(`[HomeBot Web] ${provider.name} failed: ${err.message}`);
      }
    }
    
    if (results.length === 0) {
      return {
        success: true,
        result: { 
          query, 
          message: 'No results found across multiple search engines. Try different search terms.',
          results: [],
          suggestion: 'For sports schedules, try searching for "[team name] schedule [year]" or visit official league websites like nba.com, nfl.com, etc.'
        }
      };
    }
    
    // Fetch full content from top N results
    const fetchTop = args.fetchTopResult !== false; // Default to true
    let sources: Array<{ url: string; title: string; content: string }> = [];
    // Whether `sources` are real page text or just search-result previews. The
    // note below used to claim "Fetched content from N sources" either way, so
    // the model could not tell a two-line preview from a fetched page — and
    // answered "the snippet doesn't specify" instead of opening the page.
    let usedSnippetFallback = false;

    if (tavilySources.length > 0) {
      // Tavily already provides clean pre-extracted text — use all of them directly
      sources = tavilySources;
      console.log(`[HomeBot Web] Using ${sources.length} Tavily pre-cleaned source(s)`);
    } else if (fetchTop && results.length > 0) {
      // Fallback: fetch top N URLs in parallel
      const toFetch = results.slice(0, fetchResultCount);
      console.log(`[HomeBot Web] Parallel-fetching ${toFetch.length} result(s)...`);
      const fetchResults = await Promise.allSettled(
        toFetch.map(async (r) => {
          let title = r.title;
          let content = '';
          let httpError: string | null = null;

          // Cheap path first: a plain GET costs a fraction of a browser window.
          try {
            const html = await httpGet(r.url);
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) title = stripHtml(titleMatch[1]).trim();
            content = extractMainContent(html);
          } catch (e: any) {
            httpError = e?.message || String(e);
          }

          // Then the browser we already ship.
          //
          // Measured on a live search before this existed: 3 results, two HTTP
          // 403 and one too thin, 0 of 3 read — so the answer came from search
          // snippets and never saw an article. The user-agent was already a
          // current Chrome string; those sites check TLS fingerprints and JS
          // challenges, which no header satisfies. A hidden BrowserWindow is a
          // real browser, so it simply gets the page.
          if (content.length < 200) {
            try {
              const { fetchViaBrowser, isBrowserFetchAvailable } = await import('../browser-fetch');
              if (isBrowserFetchAvailable()) {
                console.log(`[HomeBot Web] HTTP gave ${httpError || `${content.length} chars`} for ${r.url} — retrying in the browser`);
                // Shorter than the module default. This is a fallback running
                // across several sources at once, and a site behind a JS
                // challenge never resolves — measured: realgm.com burns the
                // whole budget and still fails. Better to lose one source than
                // to hold the answer up for everyone.
                const page = await fetchViaBrowser(r.url, { maxChars: 4000, timeoutMs: 12_000 });
                if (page.text.length >= 200) {
                  content = page.text;
                  if (page.title) title = page.title;
                }
              }
            } catch (e: any) {
              console.log(`[HomeBot Web] Browser fetch also failed for ${r.url}: ${e?.message || e}`);
            }
          }

          // Last tier: a rendering proxy.
          //
          // The browser beats a plain block but not a JS challenge or a
          // paywall shell — measured, realgm.com timed out at 30s and espn.com
          // returned 139 characters of navigation. Jina Reader renders
          // server-side and returned 90,007 and 87,099 characters for those
          // same two pages.
          //
          // OFF unless the user allows it, because this is the only tier that
          // sends the URL off the machine. The search query already reaches a
          // search engine, but "which page you opened" is a separate
          // disclosure and HomeBot is local-first. Never silent.
          if (content.length < 200 && readerAllowed) {
            try {
              const { fetchViaReader } = await import('../reader-fetch');
              console.log(`[HomeBot Web] Falling back to the reading service for ${r.url}`);
              const page = await fetchViaReader(r.url, { maxChars: 4000, timeoutMs: 20_000 });
              if (page.text.length >= 200) {
                content = page.text;
                if (page.title) title = page.title;
              }
            } catch (e: any) {
              console.log(`[HomeBot Web] Reading service also failed for ${r.url}: ${e?.message || e}`);
            }
          }

          // Both routes exhausted. Report the ORIGINAL HTTP reason when there
          // was one — "Too little content" after a 403 hides why it failed.
          if (content.length < 200) throw new Error(httpError || 'Too little content');
          if (content.length > 2500) content = content.substring(0, 2500) + '... [truncated]';
          return { url: r.url, title, content };
        })
      );
      for (const res of fetchResults) {
        if (res.status === 'fulfilled') {
          sources.push(res.value);
        } else {
          console.log(`[HomeBot Web] Fetch failed: ${(res as PromiseRejectedResult).reason?.message}`);
        }
      }
      console.log(`[HomeBot Web] Got content from ${sources.length}/${toFetch.length} source(s)`);
    }

    // When page fetches all failed but we have snippets from the search results,
    // use snippets as lightweight source content so the LLM has real data to work with.
    if (sources.length === 0 && results.length > 0) {
      const snippetSources = results
        .filter(r => r.snippet && r.snippet.length > 30)
        .slice(0, fetchResultCount)
        .map(r => ({ url: r.url, title: r.title, content: r.snippet }));
      if (snippetSources.length > 0) {
        sources = snippetSources;
        usedSnippetFallback = true;
        console.log(`[HomeBot Web] Using ${snippetSources.length} snippet(s) as fallback sources`);
      }
    }

    const topContent = sources[0] ?? null;
    // Trim source content for small models — long walls of text cause hallucination.
    // Keep first 800 chars per source (enough for key facts, short enough to reason over).
    const trimmedSources = sources.map(s => ({
      url: s.url,
      title: s.title,
      content: s.content.length > 800 ? s.content.substring(0, 800) + '...' : s.content,
    }));
    const resultPayload: any = {
      query,
      resultCount: results.length,
      searchProvider,
      results: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
      sources: trimmedSources,
      sourceCount: sources.length,
      // Keep topResultContent for backward-compat with any code that reads it
      topResultContent: topContent ? { ...topContent, content: topContent.content.length > 800 ? topContent.content.substring(0, 800) + '...' : topContent.content } : null,
      instruction: 'Summarize the KEY facts from these sources in 2-4 sentences. Do not repeat raw text. If the sources do not answer the question, say so.',
      note: sources.length === 0
        ? `Search via ${searchProvider} found links but could not fetch detailed content.`
        : usedSnippetFallback
          // Say plainly that these are previews, and what to do about it.
          // Otherwise the model reports "the snippet doesn't specify" as if that
          // were the end of the road, when fetch_url is right there.
          ? `Could not open any of these pages, so these are SHORT PREVIEWS only, not full articles. `
            + `If a preview does not contain the answer, call fetch_url on the most promising URL `
            + `before concluding anything. Do not report that the preview was insufficient — open the page.`
          : `Fetched full page content from ${sources.length} source(s) via ${searchProvider}: `
            + `${sources.map(s => `"${s.title}"`).join(', ')}`,
      /** True when only previews were available — lets callers spot the degraded path. */
      previewOnly: usedSnippetFallback,
    };
    // Include Tavily AI answer if available
    if (tavilyAnswer) {
      resultPayload.aiAnswer = tavilyAnswer;
    }
    setCache(cacheKey, resultPayload);
    return { success: true, result: resultPayload, fromCache: false } as any;
  } catch (err: any) {
    console.error('[HomeBot Web] Search error:', err.message);
    return { success: false, error: `Search failed: ${err.message}` };
  }
};

export const fetchUrlHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const url = args.url;
    if (!url || typeof url !== 'string') {
      return { success: false, error: 'URL is required' };
    }
    
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { success: false, error: 'URL must start with http:// or https://' };
    }

    // Explicit safety check to prevent SSRF / local network access
    try {
      const safe = await isUrlSafe(url);
      if (!safe.ok) {
        return { success: false, error: 'Blocked unsafe URL' };
      }
    } catch (e) {
      return { success: false, error: 'Blocked unsafe URL' };
    }
    
    const maxLength = Math.min(Math.max(500, args.maxLength || 5000), 20000);

    const cacheKey = `fetch_url:${url}:${maxLength}`;
    const cached = getFromCache(cacheKey);
    if (cached) {
      return { success: true, result: { ...cached }, fromCache: true } as any;
    }

    const html = await httpGet(url);
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]).trim() : 'Untitled';
    
    // Extract main content
    let content = extractMainContent(html);
    
    // Truncate if needed
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '... [truncated]';
    }
    
    const resultPayload = {
      url,
      title,
      contentLength: content.length,
      content
    };
    setCache(cacheKey, resultPayload);
    return { success: true, result: resultPayload, fromCache: false } as any;
  } catch (err: any) {
    return { success: false, error: `Failed to fetch URL: ${err.message}` };
  }
};

export const getWeatherHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const location = args.location;
    if (!location || typeof location !== 'string') {
      return { success: false, error: 'Location is required' };
    }
    
    // Use wttr.in for weather (free, no API key)
    const encodedLocation = encodeURIComponent(location);
    const weatherUrl = `https://wttr.in/${encodedLocation}?format=j1`;
    
    const response = await httpGet(weatherUrl);
    const data = JSON.parse(response);
    
    if (!data.current_condition || data.current_condition.length === 0) {
      return { success: false, error: 'Weather data not available for this location' };
    }
    
    const current = data.current_condition[0];
    const area = data.nearest_area?.[0];
    
    const weather = {
      location: area ? `${area.areaName?.[0]?.value || location}, ${area.country?.[0]?.value || ''}`.trim() : location,
      temperature: {
        celsius: `${current.temp_C}°C`,
        fahrenheit: `${current.temp_F}°F`,
        feelsLike: `${current.FeelsLikeC}°C / ${current.FeelsLikeF}°F`
      },
      condition: current.weatherDesc?.[0]?.value || 'Unknown',
      humidity: `${current.humidity}%`,
      wind: {
        speed: `${current.windspeedKmph} km/h (${current.windspeedMiles} mph)`,
        direction: current.winddir16Point
      },
      visibility: `${current.visibility} km`,
      uvIndex: current.uvIndex,
      precipitation: `${current.precipMM} mm`
    };
    
    return {
      success: true,
      result: weather
    };
  } catch (err: any) {
    return { success: false, error: `Failed to get weather: ${err.message}` };
  }
};

// ============= IMAGE GENERATE TOOL =============

export const imageGenerateDef: ToolDefinition = {
  name: 'image_generate',
  description:
    'Generate an image from a text prompt. ' +
    'Tries local Stable Diffusion (AUTOMATIC1111 / ComfyUI) first, ' +
    'then Pollinations.ai (free, no API key), ' +
    'then falls back to DALL·E if an OpenAI API key is configured. ' +
    'Returns a base64-encoded image.',
  category: 'utility',
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Text description of the image to generate'
      },
      width: {
        type: 'number',
        description: 'Image width in pixels (default: 512, max: 1024)',
        default: 512
      },
      height: {
        type: 'number',
        description: 'Image height in pixels (default: 512, max: 1024)',
        default: 512
      },
      steps: {
        type: 'number',
        description: 'Number of diffusion steps (default: 20)',
        default: 20
      },
      backend: {
        type: 'string',
        description: '"local" (SD/ComfyUI only), "cloud" (Pollinations free → DALL-E), or "hybrid" (local first, then Pollinations, default)',
        enum: ['local', 'cloud', 'hybrid'],
        default: 'hybrid'
      },
      seed: {
        type: 'number',
        description: 'Optional. Reusing one seed across several prompts keeps the results consistent with each other.'
      }
    },
    required: ['prompt']
  }
};

// ── Shared HTTP POST helper used by image backends ──────────────────────────
function httpPost(urlStr: string, payload: string, extraHeaders: Record<string, string> = {}, timeoutMs = 120000): Promise<any> {
  return new Promise((resolve, reject) => {
    const isHttps = urlStr.startsWith('https');
    const lib = isHttps ? https : http;
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      agent: isHttps ? httpsAgent : httpAgent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...extraHeaders
      },
      timeout: timeoutMs
    };
    const req = lib.request(options, (res: any) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > MAX_API_RESPONSE) {
          req.destroy();
          const body = Buffer.concat(chunks).toString();
          try { resolve(JSON.parse(body)); } catch { resolve({ _raw: body }); }
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(body)); } catch { resolve({ _raw: body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.write(payload);
    req.end();
  });
}

// ── Buffer GET (for binary responses like images) ──────────────────────────
function httpGetBuffer(urlStr: string, timeoutMs = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const isHttps = urlStr.startsWith('https');
    const lib = isHttps ? https : http;
    const req = lib.get(urlStr, { timeout: timeoutMs, agent: isHttps ? httpsAgent : httpAgent } as any, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpGetBuffer(res.headers.location as string, timeoutMs));
        return;
      }
      if (res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > MAX_BINARY_RESPONSE) {
          req.destroy();
          reject(new Error(`Response too large (>${MAX_BINARY_RESPONSE / 1024 / 1024} MB)`));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('httpGetBuffer timed out')); });
  });
}

// ── Backend 0: Pollinations.ai (free, no API key required) ───────────────────
// Cache Pollinations availability so we don't burn an HTTPS round-trip on every
// image request when the service is known-down.  The "down" state expires after
// 5 minutes so we transparently recover when Pollinations comes back.
let _pollinationsLastFailAt = 0;
const POLLINATIONS_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

async function tryPollinations(prompt: string, width: number, height: number, seedOverride?: number): Promise<string | null> {
  // Skip quickly if we recently saw a failure
  if (Date.now() - _pollinationsLastFailAt < POLLINATIONS_BACKOFF_MS) return null;

  try {
    // A caller-supplied seed keeps a SET of images consistent with each other:
    // the Media Studio renders one video from several prompts, and with a
    // random seed each one came back in a different style — the same ship as a
    // different vessel from shot to shot. Same seed, different prompt, related
    // palette and composition.
    const seed = seedOverride ?? Math.floor(Math.random() * 1e9);
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
    const buf = await httpGetBuffer(url, 60000);
    if (!buf || buf.length < 1024) {
      _pollinationsLastFailAt = Date.now();
      return null;
    }
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
    const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46;
    if (!isPng && !isJpeg && !isWebp) {
      _pollinationsLastFailAt = Date.now();
      return null;
    }
    _pollinationsLastFailAt = 0;
    return buf.toString('base64');
  } catch {
    _pollinationsLastFailAt = Date.now();
    return null;
  }
}

// ── Backend 0b: Stable Horde (free community-powered distributed inference) ──
async function tryStableHorde(prompt: string, width: number, height: number): Promise<string | null> {
  try {
    // Stable Horde requires dimensions to be multiples of 64
    const w = Math.round(Math.min(width, 1024) / 64) * 64 || 512;
    const h = Math.round(Math.min(height, 1024) / 64) * 64 || 512;

    const apiKey = (_stableHordeApiKey && _stableHordeApiKey.trim()) ? _stableHordeApiKey.trim() : '0000000000';

    const body = JSON.stringify({
      prompt,
      params: { sampler_name: 'k_euler_a', width: w, height: h, steps: 20, n: 1, karras: true },
      nsfw: false,
      censor_nsfw: true,
      r2: false,
      shared: false,
      slow_workers: true,
      models: ['stable_diffusion']
    });

    const submitRes = await httpPost(
      'https://stablehorde.net/api/v2/generate/async',
      body,
      { apikey: apiKey, 'Client-Agent': 'HomeBot:1.0:local' },
      30000
    );

    const jobId = submitRes?.id;
    if (!jobId) return null;

    // Helper: JSON GET for hardcoded Stable Horde URLs (no SSRF risk)
    const hordeGet = (path: string): Promise<any> => new Promise((resolve, reject) => {
      const req = https.get(
        `https://stablehorde.net${path}`,
        { headers: { apikey: apiKey }, timeout: 10000 } as any,
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('horde GET timeout')); });
    });

    // Poll for completion — max 120 seconds, check every 6 s
    const started = Date.now();
    while (Date.now() - started < 120000) {
      await new Promise(r => setTimeout(r, 6000));
      const check = await hordeGet(`/api/v2/generate/check/${jobId}`).catch(() => null);
      if (!check?.done) continue;

      const status = await hordeGet(`/api/v2/generate/status/${jobId}`).catch(() => null);
      const img = status?.generations?.[0]?.img as string | undefined;
      if (img && img.length > 100) return img; // already base64 PNG
      return null;
    }
    return null; // timed out
  } catch {
    return null;
  }
}

// ── Backend 1: AUTOMATIC1111 / stable-diffusion-webui ────────────────────────
async function tryAutomatic1111(prompt: string, width: number, height: number, steps: number): Promise<string | null> {
  try {
    const url = 'http://127.0.0.1:7860/sdapi/v1/txt2img';
    const payload = JSON.stringify({ prompt, negative_prompt: '', width, height, steps, cfg_scale: 7, sampler_name: 'Euler a' });
    const res = await httpPost(url, payload, {}, 180000);
    const b64 = res?.images?.[0];
    return b64 ? (b64 as string) : null;
  } catch {
    return null;
  }
}

// ── Backend 2: ComfyUI simple prompt ─────────────────────────────────────────
async function tryComfyUI(prompt: string, width: number, height: number, steps: number): Promise<string | null> {
  try {
    // ComfyUI requires a workflow JSON — use the minimal KSampler workflow
    const workflow = {
      "3": { class_type: 'KSampler', inputs: { seed: Math.floor(Math.random() * 1e9), steps, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
      "4": { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.ckpt' } },
      "5": { class_type: 'EmptyLatentImage', inputs: { batch_size: 1, height, width } },
      "6": { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ["4", 1] } },
      "7": { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ["4", 1] } },
      "8": { class_type: 'VAEDecode', inputs: { samples: ["3", 0], vae: ["4", 2] } },
      "9": { class_type: 'SaveImage', inputs: { filename_prefix: 'homebot', images: ["8", 0] } }
    };
    const promptRes = await httpPost('http://127.0.0.1:8188/prompt', JSON.stringify({ prompt: workflow }), {}, 30000);
    if (!promptRes?.prompt_id) return null;

    // Poll for result
    const promptId = promptRes.prompt_id as string;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const history = await new Promise<any>((res2, rej2) => {
        const req = http.get(`http://127.0.0.1:8188/history/${promptId}`, (r) => {
          let d = ''; r.on('data', (c: Buffer) => d += c); r.on('end', () => { try { res2(JSON.parse(d)); } catch { res2({}); } });
        }); req.on('error', rej2);
      });
      const outputs = history?.[promptId]?.outputs;
      if (outputs) {
        for (const node of Object.values(outputs) as any[]) {
          if (node?.images?.[0]) {
            const img = node.images[0];
            const imgData = await new Promise<Buffer>((r3, e3) => {
              const url = `http://127.0.0.1:8188/view?filename=${img.filename}&subfolder=${img.subfolder || ''}&type=${img.type || 'output'}`;
              http.get(url, (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (c: Buffer) => chunks.push(c));
                response.on('end', () => r3(Buffer.concat(chunks)));
              }).on('error', e3);
            });
            return imgData.toString('base64');
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Backend 2b: stable-diffusion.cpp (lightweight local binary) ─────────────
export function getSDCppDir(): string {
  try {
    return path.join(app.getPath('userData'), 'sd-cpp');
  } catch {
    return path.join(process.env.APPDATA || '', 'HomeBot', 'sd-cpp');
  }
}

export function findSDCppBinary(): string | null {
  const dir = getSDCppDir();
  // 'sd-cli.exe' first: upstream renamed the binary (releases since 2026 ship
  // sd-cli.exe + sd-server.exe, no sd.exe at all), which silently made the old
  // manual instructions impossible to follow — found by a live probe of the
  // actual latest release. Older names kept for existing installs.
  for (const name of ['sd-cli.exe', 'sd.exe', 'sd', 'stable-diffusion.exe', 'main.exe']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function findSDCppModel(): string | null {
  const modelsDir = path.join(getSDCppDir(), 'models');
  if (!fs.existsSync(modelsDir)) return null;
  const files = fs.readdirSync(modelsDir);
  const model = files.find(f => f.endsWith('.gguf') || f.endsWith('.safetensors') || f.endsWith('.ckpt'));
  return model ? path.join(modelsDir, model) : null;
}

async function trySDCpp(prompt: string, width: number, height: number, steps: number): Promise<string | null> {
  const binary = findSDCppBinary();
  const model = findSDCppModel();
  if (!binary || !model) return null;

  const outputPath = path.join(getSDCppDir(), `output-${Date.now()}.png`);

  const runOnce = (mode: string) => new Promise<void>((resolve, reject) => {
    const args = [
      '-M', mode,
      '-m', model,
      '-p', prompt,
      '-W', String(width),
      '-H', String(height),
      '--steps', String(steps),
      '-o', outputPath,
    ];
    console.log(`[ImageGen] Running sd.cpp: ${binary} ${args.join(' ')}`);
    const proc = childProcess.spawn(binary, args, { timeout: 300000 });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sd.cpp exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
    proc.on('error', reject);
  });

  try {
    // Upstream renamed the mode: current sd-cli.exe takes `img_gen`
    // ([img_gen, adetailer, vid_gen, upscale, convert, metadata] per its own
    // --help, checked against a live binary), while older sd.exe builds only
    // understood `txt2img`. Try current first; an existing old install gets
    // one retry in its own dialect rather than a permanent failure.
    try {
      await runOnce('img_gen');
    } catch (firstErr: any) {
      // Match only a rejected MODE ("invalid mode txt2img, must be one of
      // [...]" — verified against the live binary). A broader match would also
      // catch the missing-model error, whose output includes "Usage:", and
      // burn a pointless retry in the wrong dialect.
      if (/invalid mode|unknown mode|must be one of/i.test(String(firstErr?.message))) {
        await runOnce('txt2img');
      } else {
        throw firstErr;
      }
    }

    if (fs.existsSync(outputPath)) {
      const buf = fs.readFileSync(outputPath);
      fs.unlinkSync(outputPath);
      if (buf.length > 1024) return buf.toString('base64');
    }
    return null;
  } catch (err: any) {
    console.error('[ImageGen] sd.cpp failed:', err?.message);
    try { fs.unlinkSync(outputPath); } catch {}
    return null;
  }
}

// ── Backend 3: OpenAI DALL-E 3 ───────────────────────────────────────────────
async function tryDallE(prompt: string, width: number, height: number): Promise<string | null> {
  const key = _openaiApiKey;
  if (!key) return null;
  try {
    // DALL-E 3 supports: 1024x1024, 1792x1024, 1024x1792
    const size = width > height ? '1792x1024' : width < height ? '1024x1792' : '1024x1024';
    const payload = JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size, response_format: 'b64_json' });
    const res = await httpPost('https://api.openai.com/v1/images/generations', payload, { Authorization: `Bearer ${key}` }, 120000);
    const b64 = res?.data?.[0]?.b64_json as string | undefined;
    return b64 || null;
  } catch {
    return null;
  }
}

export const imageGenerateHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return { success: false, error: 'prompt is required' };

    const width = Math.min(Math.max(64, Number(args.width) || 512), 1024);
    const height = Math.min(Math.max(64, Number(args.height) || 512), 1024);
    const steps = Math.min(Math.max(1, Number(args.steps) || 20), 50);
    const backend = String(args.backend || 'hybrid');
    // Optional, and only honoured by backends that take one. Used by the Media
    // Studio so every scene of one video shares a look.
    const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : undefined;

    let image_base64: string | null = null;
    let source = '';

    if (backend !== 'cloud') {
      // Try local backends: AUTOMATIC1111 → ComfyUI → stable-diffusion.cpp
      image_base64 = await tryAutomatic1111(prompt, width, height, steps);
      if (image_base64) { source = 'automatic1111'; }
      if (!image_base64) {
        image_base64 = await tryComfyUI(prompt, width, height, steps);
        if (image_base64) { source = 'comfyui'; }
      }
      if (!image_base64) {
        image_base64 = await trySDCpp(prompt, width, height, steps);
        if (image_base64) { source = 'sd-cpp-local'; }
      }
    }

    if (!image_base64 && backend !== 'local') {
      // Try Pollinations.ai — free, no API key required
      image_base64 = await tryPollinations(prompt, width, height, seed);
      if (image_base64) { source = 'pollinations'; }
    }

    if (!image_base64 && backend !== 'local') {
      // Try Stable Horde — free community-powered distributed inference
      image_base64 = await tryStableHorde(prompt, width, height);
      if (image_base64) { source = 'stable-horde'; }
    }

    if (!image_base64 && backend !== 'local') {
      // Fall back to DALL-E 3 if OpenAI key is set
      image_base64 = await tryDallE(prompt, width, height);
      if (image_base64) { source = 'dall-e-3'; }
    }

    if (!image_base64 && backend !== 'local') {
      // Retry Pollinations once more with backoff reset in case it was a transient failure
      _pollinationsLastFailAt = 0;
      image_base64 = await tryPollinations(prompt, width, height, seed);
      if (image_base64) { source = 'pollinations'; }
    }

    if (!image_base64) {
      const sdCppDir = getSDCppDir();
      const msg = backend === 'local'
        ? `No local image backends found. Options:\n` +
          `1. stable-diffusion.cpp (lightweight): Place sd.exe in "${sdCppDir}" and a .gguf model in "${sdCppDir}\\models"\n` +
          `2. AUTOMATIC1111: Run Stable Diffusion WebUI on port 7860\n` +
          `3. ComfyUI: Run ComfyUI on port 8188\n` +
          `Or switch to "Hybrid" to use free cloud generation.`
        : 'All image backends failed. ' +
          'Pollinations.ai and Stable Horde (both free) were tried — check your internet connection. ' +
          'For local generation, run Stable Diffusion (port 7860) or ComfyUI (port 8188). ' +
          'For DALL-E 3, add an OpenAI API key in Settings.';
      return { success: false, error: msg };
    }

    return { success: true, result: { image_base64, source, metadata: { prompt, width, height } } };
  } catch (err: any) {
    return { success: false, error: `image_generate failed: ${err.message}` };
  }
};

// Export all definitions and handlers
export const webToolDefs = [
  webSearchDef,
  fetchUrlDef,
  getWeatherDef,
  imageGenerateDef
];

export const webToolHandlers: Record<string, ToolHandler> = {
  'web_search': webSearchHandler,
  'fetch_url': fetchUrlHandler,
  'get_weather': getWeatherHandler,
  'image_generate': imageGenerateHandler
};
