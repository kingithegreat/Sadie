import * as http from 'http';
import * as https from 'https';
import { getSettings } from '../config-manager';
import { resolveCloudLLM } from '../../shared/cloud-llm';
import { isLoopbackHostname } from './url-boundary';

/** Read the existing Online choice at dispatch time; requests cannot grant it. */
export function assertProviderOnlineAccess(provider: string): void {
  try {
    if (resolveCloudLLM(getSettings()).intended) return;
  } catch {
    // Missing/unreadable settings are not consent. Do not expose config details.
  }
  const error = new Error(`${provider} needs Online access. Turn on Online in Settings, or use a provider on this PC.`);
  Object.assign(error, { code: 'ONLINE_ACCESS_DISABLED' });
  throw error;
}

/**
 * Owner-configured generation servers may be remote despite a local adapter's
 * name. Check every request (including discovery and polling) before DNS or I/O.
 * Node's HTTP client does not follow redirects; a redirect cannot escape this
 * decision. Trusted local engines remain responsible for their own behavior.
 */
export function requestProviderEndpoint(
  endpoint: string,
  provider: string,
  options: Pick<http.RequestOptions, 'method' | 'headers' | 'timeout'>,
  onResponse: (response: http.IncomingMessage) => void,
): http.ClientRequest {
  let url: URL;
  try {
    url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    throw new Error(`${provider} needs a valid HTTP or HTTPS endpoint without embedded credentials.`);
  }
  if (!isLoopbackHostname(url.hostname)) assertProviderOnlineAccess(provider);
  // Pin localhost instead of relying on DNS (also avoids Docker's IPv6 race).
  const hostname = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g, '');
  const transport = url.protocol === 'https:' ? https : http;
  return transport.request({
    ...options,
    protocol: url.protocol,
    hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
  }, onResponse);
}
