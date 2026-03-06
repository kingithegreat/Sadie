/**
 * SADIE Web Tools
 * 
 * Provides web search and URL fetching capabilities.
 * Uses DuckDuckGo for search (no API key required).
 */

import { ToolDefinition, ToolHandler, ToolResult } from './types';
import * as https from 'https';
import * as http from 'http';
import * as dns from 'dns';
import * as net from 'net';
import { isE2E } from '../env';

// Search/image API keys — loaded from settings on first use
let _tavilyApiKey: string | null = null;
let _serperApiKey: string | null = null;
let _openaiApiKey: string | null = null;

export function setTavilyApiKey(key: string | null) {
  _tavilyApiKey = key;
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
        description: 'The search query - be specific and include dates/years when relevant'
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

function httpGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise(async (resolve, reject) => {
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
      headers: {
        // Use a browser-like User-Agent - DuckDuckGo blocks bot-like agents
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...headers
      }
    };
    
    const req = client.get(url, options, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http') 
          ? res.headers.location 
          : new URL(res.headers.location, url).href;
        return httpGet(redirectUrl, headers).then(resolve).catch(reject);
      }
      
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
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
async function searchGoogle(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://www.google.com/search?q=${encodedQuery}&num=${maxResults + 5}&hl=en`;
  
  console.log('[SADIE Web] Searching Google for:', query);
  const html = await httpGet(searchUrl);
  console.log('[SADIE Web] Google response length:', html.length);
  
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
      
      // Try to find snippet near this result
      const snippet = '';
      
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
  
  console.log('[SADIE Web] Searching DuckDuckGo for:', query);
  const html = await httpGet(searchUrl);
  console.log('[SADIE Web] DDG response length:', html.length);
  
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

// Search using Brave Search (another fallback)
async function searchBrave(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://search.brave.com/search?q=${encodedQuery}`;
  
  console.log('[SADIE Web] Searching Brave for:', query);
  const html = await httpGet(searchUrl);
  console.log('[SADIE Web] Brave response length:', html.length);
  
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

  console.log('[SADIE Web] Querying DDG Instant Answer API for:', query);
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
  console.log(`[SADIE Web] DDG Instant returned ${results.length} results, answer=${!!answer}`);
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

  console.log('[SADIE Web] Searching Tavily for:', query);

  const data = await new Promise<string>((resolve, reject) => {
    const req = https.request('https://api.tavily.com/search', {
      method: 'POST',
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
      res.on('data', (c: Buffer) => d += c.toString());
      res.on('end', () => resolve(d));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Tavily timeout')); });
    req.write(body);
    req.end();
  });

  const json: TavilyResponse = JSON.parse(data);
  console.log(`[SADIE Web] Tavily returned ${json.results?.length || 0} results in ${json.response_time}s`);

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

    // Try each provider in order until one returns results.
    let results: Array<{ title: string; url: string; snippet: string }> = [];
    let tavilyAnswer: string | undefined;
    let tavilySources: Array<{ url: string; title: string; content: string }> = [];

    for (const provider of SEARCH_PROVIDERS) {
      if (!provider.available()) continue;
      try {
        console.log(`[SADIE Web] Trying ${provider.name}...`);
        const providerResult = await provider.search(query, maxResults, fetchResultCount);
        if (providerResult && providerResult.results.length > 0) {
          results = providerResult.results;
          tavilySources = providerResult.sources;
          if (providerResult.answer) tavilyAnswer = providerResult.answer;
          console.log(`[SADIE Web] ${provider.name} returned ${results.length} results`);
          break;
        }
      } catch (err: any) {
        console.log(`[SADIE Web] ${provider.name} failed: ${err.message}`);
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

    if (tavilySources.length > 0) {
      // Tavily already provides clean pre-extracted text — use all of them directly
      sources = tavilySources;
      console.log(`[SADIE Web] Using ${sources.length} Tavily pre-cleaned source(s)`);
    } else if (fetchTop && results.length > 0) {
      // Fallback: fetch top N URLs in parallel
      const toFetch = results.slice(0, fetchResultCount);
      console.log(`[SADIE Web] Parallel-fetching ${toFetch.length} result(s)...`);
      const fetchResults = await Promise.allSettled(
        toFetch.map(async (r) => {
          const html = await httpGet(r.url);
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const title = titleMatch ? stripHtml(titleMatch[1]).trim() : r.title;
          let content = extractMainContent(html);
          if (content.length < 200) throw new Error('Too little content');
          if (content.length > 2500) content = content.substring(0, 2500) + '... [truncated]';
          return { url: r.url, title, content };
        })
      );
      for (const res of fetchResults) {
        if (res.status === 'fulfilled') {
          sources.push(res.value);
        } else {
          console.log(`[SADIE Web] Fetch failed: ${(res as PromiseRejectedResult).reason?.message}`);
        }
      }
      console.log(`[SADIE Web] Got content from ${sources.length}/${toFetch.length} source(s)`);
    }

    const topContent = sources[0] ?? null;
    const resultPayload: any = {
      query,
      resultCount: results.length,
      results,
      sources,
      // Keep topResultContent for backward-compat with any code that reads it
      topResultContent: topContent,
      note: sources.length > 0
        ? `Fetched content from ${sources.length} source(s): ${sources.map(s => `"${s.title}"`).join(', ')}`
        : 'Could not fetch detailed content. You may need to use fetch_url on specific results.',
    };
    // Include Tavily AI answer if available
    if (tavilyAnswer) {
      resultPayload.aiAnswer = tavilyAnswer;
    }
    setCache(cacheKey, resultPayload);
    return { success: true, result: resultPayload, fromCache: false } as any;
  } catch (err: any) {
    console.error('[SADIE Web] Search error:', err.message);
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
      }
    },
    required: ['prompt']
  }
};

// ── Shared HTTP POST helper used by image backends ──────────────────────────
function httpPost(urlStr: string, payload: string, extraHeaders: Record<string, string> = {}, timeoutMs = 120000): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = urlStr.startsWith('https') ? https : http;
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port || (urlStr.startsWith('https') ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...extraHeaders
      },
      timeout: timeoutMs
    };
    const req = lib.request(options, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
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
    const lib = urlStr.startsWith('https') ? https : http;
    const req = lib.get(urlStr, { timeout: timeoutMs } as any, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpGetBuffer(res.headers.location as string, timeoutMs));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('httpGetBuffer timed out')); });
  });
}

// ── Backend 0: Pollinations.ai (free, no API key required) ───────────────────
async function tryPollinations(prompt: string, width: number, height: number): Promise<string | null> {
  try {
    const seed = Math.floor(Math.random() * 1e9);
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true`;
    const buf = await httpGetBuffer(url, 60000);
    // A valid image should be at least a few KB; reject obviously invalid responses
    if (!buf || buf.length < 1024) return null;
    return buf.toString('base64');
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
      "9": { class_type: 'SaveImage', inputs: { filename_prefix: 'sadie', images: ["8", 0] } }
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

    let image_base64: string | null = null;
    let source = '';

    if (backend !== 'cloud') {
      // Try local backends first
      image_base64 = await tryAutomatic1111(prompt, width, height, steps);
      if (image_base64) { source = 'automatic1111'; }
      if (!image_base64) {
        image_base64 = await tryComfyUI(prompt, width, height, steps);
        if (image_base64) { source = 'comfyui'; }
      }
    }

    if (!image_base64 && backend !== 'local') {
      // Try Pollinations.ai — free, no API key required
      image_base64 = await tryPollinations(prompt, width, height);
      if (image_base64) { source = 'pollinations'; }
    }

    if (!image_base64 && backend !== 'local') {
      // Fall back to DALL-E 3 if OpenAI key is set
      image_base64 = await tryDallE(prompt, width, height);
      if (image_base64) { source = 'dall-e-3'; }
    }

    if (!image_base64) {
      return {
        success: false,
        error: 'All image backends failed. ' +
          'Pollinations.ai (free) was tried — check your internet connection. ' +
          'For local generation, run Stable Diffusion (port 7860) or ComfyUI (port 8188). ' +
          'For DALL-E 3, add an OpenAI API key in Settings.'
      };
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
