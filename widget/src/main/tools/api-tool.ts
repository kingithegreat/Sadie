/**
 * HomeBot API Tool
 *
 * Makes outbound HTTP/HTTPS requests to an allowlisted set of public API hosts.
 * Strict SSRF protection: all private IPs, loopback, and non-https URLs are blocked.
 * Only hosts on the approved allowlist are reachable.
 *
 * The allowlist can be extended via config/api-allowlist.json (array of hostnames).
 *
 * Tools:
 *   api_request — make an HTTP GET or POST request to an approved API
 */

import * as https from 'https';
import * as net from 'net';
import * as dns from 'dns';
import * as fs from 'fs';
import * as path from 'path';
import { isPrivateIPv4, isPrivateIPv6 } from '../utils/url-boundary';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

// ----- Allowlist -----

/** Built-in approved public API hostnames (exact match or *.suffix) */
const BUILTIN_ALLOWLIST: string[] = [
  // Weather
  'wttr.in',
  'api.open-meteo.com',
  'api.openweathermap.org',
  // Time / timezone
  'worldtimeapi.org',
  'timeapi.io',
  // Currency / finance
  'api.exchangerate-api.com',
  'open.er-api.com',
  'api.coingecko.com',
  // Sports
  'api.balldontlie.io',
  'site.api.espn.com',
  'v1.american-football.api-sports.io',
  // Utility / public data
  'api.publicapis.org',
  'catfact.ninja',
  'official-joke-api.appspot.com',
  'v2.jokeapi.dev',
  'api.quotable.io',
  'restcountries.com',
  'disease.sh',
  // News
  'newsapi.org',
  'rss2json.com',
  // GitHub (public reads)
  'api.github.com',
];

/**
 * Load optional user-supplied allowlist from config/api-allowlist.json.
 * File should be a JSON array of hostname strings.
 */
function loadUserAllowlist(): string[] {
  try {
    const cfgFile = path.resolve(__dirname, '../../../../config/api-allowlist.json');
    if (!fs.existsSync(cfgFile)) return [];
    const raw = fs.readFileSync(cfgFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((e: any) => typeof e === 'string')
        .map((e: string) => e.toLowerCase().trim());
    }
  } catch {
    // ignore — optional
  }
  return [];
}

let _allowlist: string[] | null = null;
function getAllowlist(): string[] {
  if (!_allowlist) {
    _allowlist = [...BUILTIN_ALLOWLIST.map(h => h.toLowerCase()), ...loadUserAllowlist()];
  }
  return _allowlist;
}

/** Check if a hostname is in the allowlist (exact or subdomain of an entry) */
function isAllowlisted(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return getAllowlist().some(entry => h === entry || h.endsWith(`.${entry}`));
}

// ----- SSRF helpers -----
// (isPrivateIPv4 / isPrivateIPv6 live in utils/url-boundary.ts so all three
// fetchers share one copy of the range tables.)

async function validateApiUrl(raw: string): Promise<{ ok: boolean; message?: string }> {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { ok: false, message: 'Invalid URL' }; }

  if (parsed.protocol !== 'https:') {
    return { ok: false, message: 'Only https:// URLs are allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return { ok: false, message: 'Empty hostname' };

  // Block loopback hostnames
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, message: 'Loopback hostname blocked' };
  }
  // Block .local / .internal
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { ok: false, message: 'Local domains blocked' };
  }

  // IP literal check (v4 private ranges; v6 loopback/ULA/link-local/mapped)
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4 && isPrivateIPv4(hostname)) {
    return { ok: false, message: 'Private IP blocked' };
  }
  if (ipVersion === 6 && isPrivateIPv6(hostname)) {
    return { ok: false, message: 'Private/loopback IPv6 blocked' };
  }

  // Allowlist check (before DNS to avoid wasteful resolution)
  if (!isAllowlisted(hostname)) {
    return { ok: false, message: `Host "${hostname}" is not in the approved API allowlist` };
  }

  // DNS resolution check for non-IP hostnames
  if (ipVersion === 0) {
    try {
      const records = await dns.promises.lookup(hostname, { all: true });
      for (const rec of records) {
        if (rec.family === 4 && isPrivateIPv4(rec.address)) {
          return { ok: false, message: 'DNS resolved to private IP' };
        }
        if (rec.family === 6 && isPrivateIPv6(rec.address)) {
          return { ok: false, message: 'DNS resolved to private/loopback IPv6' };
        }
      }
    } catch {
      // DNS failure — let the request fail naturally
    }
  }

  return { ok: true };
}

// ----- HTTP helper -----

function httpsRequest(
  url: string,
  method: 'GET' | 'POST',
  body: string | undefined,
  headers: Record<string, string>,
  timeout: number
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyBuf = body ? Buffer.from(body, 'utf8') : undefined;
    const reqHeaders: Record<string, string> = {
      'User-Agent': 'HomeBot/1.0 (local AI assistant)',
      Accept: 'application/json, text/plain, */*',
      ...headers,
    };
    if (bodyBuf) {
      reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
      reqHeaders['Content-Length'] = String(bodyBuf.byteLength);
    }

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
      },
      res => {
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') respHeaders[k] = v;
          else if (Array.isArray(v)) respHeaders[k] = v.join(', ');
        }

        // Follow a single redirect — but re-validate the target first. The
        // allowlist applies to the FIRST hop only otherwise: any allowlisted
        // host (or an open redirect on it) could bounce this request at an
        // arbitrary host. validateApiUrl also rejects http: targets, so a
        // https→http downgrade dies here too.
        if (
          res.statusCode &&
          res.statusCode >= 301 &&
          res.statusCode <= 308 &&
          res.headers.location
        ) {
          const loc = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return validateApiUrl(loc)
            .then((check) => {
              if (!check.ok) throw new Error(`Blocked redirect (${check.message}): ${loc}`);
              return httpsRequest(loc, 'GET', undefined, {}, timeout);
            })
            .then(resolve)
            .catch(reject);
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: data, headers: respHeaders })
        );
        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Request timeout')); });

    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ----- Tool definition -----

export const apiRequestDef: ToolDefinition = {
  name: 'api_request',
  description:
    'Make an HTTP GET or POST request to an approved public API. ' +
    'Only https:// URLs to allowlisted hosts are permitted. ' +
    'Use this for fetching data from known public APIs (weather, currency, sports, etc.) ' +
    'when the dedicated tool is not available or the endpoint is not pre-built. ' +
    'POST requests require user confirmation.',
  category: 'web',
  // GETs run without a dialog; POSTs are confirmed in the handler (see
  // apiRequestHandler) because ToolDefinition can only express a per-tool flag.
  requiresConfirmation: false,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Full https:// URL to call. Must be on the approved API allowlist.',
      },
      method: {
        type: 'string',
        description: 'HTTP method: "GET" (default) or "POST".',
        enum: ['GET', 'POST'],
      },
      body: {
        type: 'string',
        description: 'Request body for POST requests (JSON string or plain text).',
      },
      headers: {
        type: 'object',
        description: 'Optional additional request headers as key/value pairs.',
      },
      timeout: {
        type: 'number',
        description: 'Request timeout in milliseconds (default: 10000, max: 30000).',
        default: 10000,
      },
    },
    required: ['url'],
  },
};

// ----- Handler -----

export const apiRequestHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const url = String(args.url ?? '').trim();
  const method: 'GET' | 'POST' = args.method === 'POST' ? 'POST' : 'GET';
  const body = args.body !== undefined ? String(args.body) : undefined;
  const rawHeaders = args.headers && typeof args.headers === 'object' ? args.headers as Record<string, any> : {};
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (typeof k === 'string' && typeof v === 'string') {
      // Block auth headers from being injected unless they're api keys
      const kl = k.toLowerCase();
      if (kl === 'authorization' || kl === 'cookie' || kl === 'host') continue;
      headers[k] = v;
    }
  }
  const timeout = Math.min(Math.max(1000, Number(args.timeout) || 10000), 30000);

  if (!url) {
    return { success: false, error: 'api_request: url is required' };
  }

  // Validate URL and check SSRF / allowlist
  const check = await validateApiUrl(url);
  if (!check.ok) {
    return { success: false, error: `api_request blocked: ${check.message}` };
  }

  // POST can change state on the remote API, so it needs a consent gate. The
  // definition keeps requiresConfirmation=false (GETs must keep flowing) and
  // this implements what that field's old comment promised — "set per method
  // in handler" — but the code never actually did.
  if (method === 'POST') {
    if (!context?.requestConfirmation) {
      return {
        success: false,
        error: 'api_request POST needs your confirmation, and this run has no way to ask for it. Run it from chat, or use GET for read-only calls.',
      };
    }
    const confirmed = await context.requestConfirmation(
      `POST to ${url}${body ? `\nBody: ${String(body).slice(0, 200)}${String(body).length > 200 ? '...' : ''}` : ''}?`
    );
    if (!confirmed) {
      return { success: false, error: 'Operation cancelled by user' };
    }
  }

  try {
    const resp = await httpsRequest(url, method, body, headers, timeout);

    // Try to parse JSON response
    let parsed: any = null;
    let isJson = false;
    const ct = resp.headers['content-type'] ?? '';
    if (ct.includes('application/json') || ct.includes('text/json')) {
      try { parsed = JSON.parse(resp.body); isJson = true; } catch { /* fall through */ }
    }

    const bodySlice = resp.body.slice(0, 8000); // cap response size

    return {
      success: resp.status >= 200 && resp.status < 300,
      result: {
        url,
        method,
        status: resp.status,
        body: isJson ? parsed : bodySlice,
        isJson,
        contentType: ct,
      },
      ...(resp.status >= 400 ? { error: `HTTP ${resp.status}` } : {}),
    };
  } catch (err) {
    return { success: false, error: `api_request failed: ${(err as any)?.message}` };
  }
};

// ----- Exports -----

export const apiToolDefs: ToolDefinition[] = [apiRequestDef];

export const apiToolHandlers: Record<string, ToolHandler> = {
  api_request: apiRequestHandler,
};
