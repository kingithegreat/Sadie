/**
 * url-boundary.ts — shared IP-range predicates for the SSRF guards.
 *
 * Three fetchers (browser.ts fetchHtml, web.ts httpGet, api-tool.ts
 * httpsRequest) each used to carry a private copy of the private-range check,
 * and all three copies knew about IPv4 only — an IPv6 ULA (fc00::/7),
 * link-local (fe80::/10), or IPv4-mapped (::ffff:127.0.0.1) host sailed
 * through every literal-IP check. One predicate, imported everywhere, so the
 * next range that needs blocking lands in exactly one place.
 */

/** True for RFC1918, loopback, link-local (169.254/16) and 0.0.0.0/8. */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(s => parseInt(s, 10));
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p))) return false;
  const n = ((parts[0] << 24) >>> 0) | ((parts[1] << 16) >>> 0) | ((parts[2] << 8) >>> 0) | (parts[3] >>> 0);
  const inRange = (start: string, bits: number) => {
    const sp = start.split('.').map(s => parseInt(s, 10));
    const sn = ((sp[0] << 24) >>> 0) | ((sp[1] << 16) >>> 0) | ((sp[2] << 8) >>> 0) | (sp[3] >>> 0);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (sn & mask);
  };
  return (
    inRange('10.0.0.0', 8) ||
    inRange('172.16.0.0', 12) ||
    inRange('192.168.0.0', 16) ||
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) ||
    inRange('0.0.0.0', 8)
  );
}

/**
 * True for the IPv6 addresses a local network answer should never reach from a
 * web fetch: unspecified (::), loopback (::1), Unique Local (fc00::/7),
 * link-local (fe80::/10), and IPv4-mapped addresses whose embedded IPv4 is
 * itself private.
 */
export function isPrivateIPv6(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (!a) return false;
  if (a === '::' || a === '::1') return true;
  if (a.startsWith('fc') || a.startsWith('fd')) return true; // fc00::/7 ULA
  if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return true; // fe80::/10
  const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}
