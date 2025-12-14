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
    
    // Try multiple search engines - DuckDuckGo is most reliable for actual results
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
    
    if (fetchTop && results.length > 0) {
      // Try to fetch the top result
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
    
    const resultPayload = {
      query,
      resultCount: results.length,
      results,
      topResultContent: topContent,
      note: topContent 
        ? `I fetched the content from "${topContent.title}" - use this to answer the question.`
        : 'Could not fetch detailed content. You may need to use fetch_url on specific results.'
    };
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

// Export all definitions and handlers
export const webToolDefs = [
  webSearchDef,
  fetchUrlDef,
  getWeatherDef
];

export const webToolHandlers: Record<string, ToolHandler> = {
  'web_search': webSearchHandler,
  'fetch_url': fetchUrlHandler,
  'get_weather': getWeatherHandler
};
