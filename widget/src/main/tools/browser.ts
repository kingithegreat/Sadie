/**
 * SADIE Browser Automation Tools
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

// ----- Exports -----

export const browserToolDefs: ToolDefinition[] = [openInBrowserDef, browserSearchDef];

export const browserToolHandlers: Record<string, ToolHandler> = {
  open_in_browser: openInBrowserHandler,
  browser_search:  browserSearchHandler,
};
