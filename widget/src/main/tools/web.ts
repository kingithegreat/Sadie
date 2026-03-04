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

// Search API keys — loaded from settings on first use
let _tavilyApiKey: string | null = null;
let _serperApiKey: string | null = null;

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

// ============= TOOL DEFINITIONS =============

export const webSearchDef: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web and get results. By default, automatically fetches content from the top result to provide actual information. Use this when the user asks about current events, sports, news, facts you\'re unsure about, or anything that requires up-to-date information.',
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
        description: 'Maximum number of results to return (default: 5, max: 10)',
        default: 5
      },
      fetchTopResult: {
        type: 'boolean',
        description: 'Automatically fetch and include content from the top result (default: true)',
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

// Filter out unwanted domains
function isAllowedDomain(url: string): boolean {
  const blockedDomains = [
    'wikipedia.org',
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

// Search using DuckDuckGo (fallback)
async function searchDuckDuckGo(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
  
  console.log('[SADIE Web] Searching DuckDuckGo for:', query);
  const html = await httpGet(searchUrl);
  console.log('[SADIE Web] DDG response length:', html.length);
  
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  
  // Split by result divs
  const resultBlocks = html.split(/<div class="result\s+results_links/gi);
  
  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i];
    
    if (block.includes('result--ad')) continue;
    
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]+)/i);
    if (!titleMatch) continue;
    
    const rawUrl = titleMatch[1];
    const title = stripHtml(titleMatch[2]).trim();
    
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : '';
    
    if (!rawUrl || !title) continue;
    
    let finalUrl = rawUrl;
    const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        finalUrl = decodeURIComponent(uddgMatch[1]);
      } catch {
        finalUrl = rawUrl;
      }
    }
    
    if (!isAllowedDomain(finalUrl)) continue;
    
    results.push({ title, url: finalUrl, snippet });
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
  topContent?: { url: string; title: string; content: string };
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

  // Tavily already gives us clean text content — use the top result
  let topContent: { url: string; title: string; content: string } | undefined;
  if (json.results && json.results.length > 0) {
    const top = json.results[0];
    topContent = {
      url: top.url,
      title: top.title,
      content: top.content || ''
    };
  }

  return { results, topContent, answer: json.answer };
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
    let results: Array<{ title: string; url: string; snippet: string }> = [];
    let tavilyAnswer: string | undefined;
    let tavilyTopContent: { url: string; title: string; content: string } | undefined;
    
    // Try Tavily first if API key is configured (best quality, AI-optimized)
    const hasTavily = !!getTavilyApiKey();
    if (hasTavily) {
      try {
        console.log('[SADIE Web] Trying Tavily (primary)...');
        const tavilyResult = await searchTavily(query, maxResults);
        results = tavilyResult.results;
        tavilyAnswer = tavilyResult.answer;
        tavilyTopContent = tavilyResult.topContent;
        if (results.length > 0) {
          console.log(`[SADIE Web] Tavily returned ${results.length} results`);
        }
      } catch (err: any) {
        console.log(`[SADIE Web] Tavily failed: ${err.message}`);
      }
    }

    // Try Serper.dev if Tavily unavailable/failed and Serper key is configured
    if (results.length === 0 && getSerperApiKey()) {
      try {
        console.log('[SADIE Web] Trying Serper.dev (secondary)...');
        const serperResult = await searchSerper(query, maxResults);
        results = serperResult.results;
        if (serperResult.topContent && serperResult.topContent.content.length > 50) {
          tavilyTopContent = serperResult.topContent; // reuse the same variable for top content
        }
        if (results.length > 0) {
          console.log(`[SADIE Web] Serper returned ${results.length} results`);
        }
      } catch (err: any) {
        console.log(`[SADIE Web] Serper failed: ${err.message}`);
      }
    }

    // Fallback to scraping-based engines if API providers unavailable or returned nothing
    if (results.length === 0) {
      const searchEngines = [
        { name: 'DuckDuckGo', fn: searchDuckDuckGo },
        { name: 'Google', fn: searchGoogle },
        { name: 'Brave', fn: searchBrave }
      ];
      
      for (const engine of searchEngines) {
        try {
          console.log(`[SADIE Web] Trying ${engine.name}...`);
          results = await engine.fn(query, maxResults);
          
          if (results.length > 0) {
            console.log(`[SADIE Web] ${engine.name} returned ${results.length} results`);
            break;
          }
        } catch (err: any) {
          console.log(`[SADIE Web] ${engine.name} failed: ${err.message}`);
          continue;
        }
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
    
    // Automatically fetch content from top result(s) for better answers
    const fetchTop = args.fetchTopResult !== false; // Default to true
    let topContent: { url: string; title: string; content: string } | null = null;
    
    // If Tavily already gave us clean content, use that directly (no extra HTTP fetches needed)
    if (tavilyTopContent && tavilyTopContent.content.length > 100) {
      topContent = tavilyTopContent;
      console.log(`[SADIE Web] Using Tavily pre-cleaned content (${topContent.content.length} chars)`);
    } else if (fetchTop && results.length > 0) {
      // Fallback: fetch and parse HTML from top results
      for (let i = 0; i < Math.min(3, results.length); i++) {
        try {
          console.log(`[SADIE Web] Fetching content from: ${results[i].url}`);
          const html = await httpGet(results[i].url);
          
          // Extract title
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const title = titleMatch ? stripHtml(titleMatch[1]).trim() : results[i].title;
          
          // Extract content
          let content = extractMainContent(html);
          
          // Only use if we got meaningful content
          if (content.length > 200) {
            // Truncate to reasonable size
            if (content.length > 3000) {
              content = content.substring(0, 3000) + '... [truncated]';
            }
            topContent = { url: results[i].url, title, content };
            console.log(`[SADIE Web] Got ${content.length} chars from ${results[i].url}`);
            break;
          }
        } catch (err: any) {
          console.log(`[SADIE Web] Failed to fetch ${results[i].url}: ${err.message}`);
          continue;
        }
      }
    }
    
    const resultPayload: any = {
      query,
      resultCount: results.length,
      results,
      topResultContent: topContent,
      note: topContent 
        ? `I fetched the content from "${topContent.title}" - use this to answer the question.`
        : 'Could not fetch detailed content. You may need to use fetch_url on specific results.'
    };
    // Include Tavily AI answer if available
    if (tavilyAnswer) {
      resultPayload.aiAnswer = tavilyAnswer;
      resultPayload.note = `Tavily AI answer: ${tavilyAnswer}\n\nTop source: "${topContent?.title || 'N/A'}"`;
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
    'then falls back to Stability AI or DALL·E if API keys are configured. ' +
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
        description: '"local" (SD/ComfyUI), "cloud" (Stability/OpenAI), or "hybrid" (local first, default)',
        enum: ['local', 'cloud', 'hybrid'],
        default: 'hybrid'
      }
    },
    required: ['prompt']
  }
};

export const imageGenerateHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return { success: false, error: 'prompt is required' };

    const width = Math.min(Math.max(64, Number(args.width) || 512), 1024);
    const height = Math.min(Math.max(64, Number(args.height) || 512), 1024);
    const steps = Math.min(Math.max(1, Number(args.steps) || 20), 50);
    const backend = String(args.backend || 'hybrid');

    // Call n8n image-generate webhook
    const n8nBase = process.env.N8N_BASE_URL || 'http://localhost:5678';
    const webhookUrl = `${n8nBase}/webhook/sadie-image-generate`;

    const payload = JSON.stringify({
      action: 'generate',
      payload: { prompt, width, height, steps, backend }
    });

    const result = await new Promise<any>((resolve, reject) => {
      const lib = webhookUrl.startsWith('https') ? require('https') : require('http');
      const url = new URL(webhookUrl);
      const options = {
        hostname: url.hostname,
        port: url.port || (webhookUrl.startsWith('https') ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 150000
      };
      const req = lib.request(options, (res: any) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString()));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ status: 'failure', error: { message: data } }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('image_generate timed out')); });
      req.write(payload);
      req.end();
    });

    if (result.status !== 'success') {
      return {
        success: false,
        error: result.error?.message || 'Image generation failed'
      };
    }

    return {
      success: true,
      result: {
        image_base64: result.image,
        source: result.source,
        metadata: result.metadata
      }
    };
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
