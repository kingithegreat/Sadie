/**
 * The last fetch tier: a rendering proxy.
 *
 * The tiers below it run out. Measured against two real sites:
 *
 *                  plain GET        BrowserWindow      Jina Reader
 *   realgm.com     403              timed out at 30s   90,007 chars
 *   espn.com       202              139 chars (nav)    87,099 chars
 *
 * This is the only tier that sends a URL off the machine, which is why it is
 * off by default and why the eligibility guard below is tested harder than the
 * happy path — handing a third party a loopback or private-range address would
 * ask it to reach into a network the user never meant to expose.
 */

import { isReaderEligible, parseReaderOutput } from '../reader-fetch';

describe('isReaderEligible', () => {
  it.each([
    'https://example.com',
    'https://www.espn.com/nba/depthchart',
    'http://example.com/page?a=1',
  ])('allows the public page %s', (url) => {
    expect(isReaderEligible(url)).toBe(true);
  });

  // Each of these would ask an external service to fetch from a network only
  // this machine can see.
  it.each([
    ['loopback name', 'http://localhost:3000'],
    ['loopback v4', 'http://127.0.0.1/admin'],
    ['loopback v6', 'http://[::1]/'],
    ['mDNS', 'http://printer.local/status'],
    ['private 10/8', 'http://10.0.0.5/'],
    ['private 192.168/16', 'http://192.168.1.1/'],
    ['link-local', 'http://169.254.169.254/latest/meta-data/'],
    ['private 172.16/12', 'http://172.16.0.1/'],
    ['private 172.31/12', 'http://172.31.255.1/'],
    ['127/8 beyond .0.1', 'http://127.0.0.2/'],
    ['all-zeros', 'http://0.0.0.0/'],
    ['IPv6 unique-local', 'http://[fd00::1]/'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['IPv4-mapped IPv6 loopback', 'http://[::ffff:127.0.0.1]/'],
  ])('refuses %s', (_name, url) => {
    expect(isReaderEligible(url)).toBe(false);
  });

  test('172.32 is public and must NOT be swept up by the 172.16/12 rule', () => {
    // The private block is 172.16-172.31 only. A rule that blocked all of
    // 172.* would quietly break real sites.
    expect(isReaderEligible('http://172.32.0.1/')).toBe(true);
    expect(isReaderEligible('http://172.15.0.1/')).toBe(true);
  });

  it.each([
    ['a file path', 'file:///C:/secrets.txt'],
    ['a non-URL', 'not a url at all'],
    ['empty', ''],
  ])('refuses %s', (_name, url) => {
    expect(isReaderEligible(url)).toBe(false);
  });
});

describe('parseReaderOutput', () => {
  // Shaped exactly as the live service returned it for realgm.com.
  const REAL = [
    'Title: NBA Depth Charts - RealGM',
    'URL Source: https://basketball.realgm.com/nba/depth-charts/2026',
    'Published Time: Thu, 08 May 2025 23:15:48 GMT',
    '',
    'Markdown Content:',
    '## 2025-2026 NBA Depth Charts',
    '',
    'Atlanta Hawks | PG | SG',
  ].join('\n');

  test('takes the title', () => {
    expect(parseReaderOutput(REAL).title).toBe('NBA Depth Charts - RealGM');
  });

  test('drops the preamble and keeps the content', () => {
    const { text } = parseReaderOutput(REAL);
    expect(text.startsWith('## 2025-2026 NBA Depth Charts')).toBe(true);
    // The header lines are context spent on every fetch for no reader benefit.
    expect(text).not.toContain('URL Source:');
    expect(text).not.toContain('Published Time:');
  });

  test('output without the marker is kept whole rather than discarded', () => {
    const plain = 'Just some page text with no preamble at all.';
    expect(parseReaderOutput(plain).text).toBe(plain);
    expect(parseReaderOutput(plain).title).toBe('');
  });

  test('empty input does not throw', () => {
    expect(parseReaderOutput('').text).toBe('');
  });
});
