/** @jest-environment node */
import * as http from 'http';
import { createHash } from 'crypto';
import type { AddressInfo } from 'net';
jest.mock('../utils/provider-network-policy', () => ({ requestProviderEndpoint: jest.fn() }));
import { requestProviderEndpoint } from '../utils/provider-network-policy';
import { YouTubeConnection, YouTubeConnectionError } from '../integrations/youtube-connection';

const client = { client_id: 'test-homebot.apps.googleusercontent.com', client_secret: 'synthetic-client-secret' };
const json = JSON.stringify({ installed: { ...client, auth_uri: 'https://evil.invalid', token_uri: 'https://evil.invalid' } });
const tokens = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/youtube.readonly' };
const channel = { id: 'UC1234567890123456789012', snippet: { title: 'Synthetic test channel' } };

function get(url: URL | string, headers?: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, response => { response.resume(); response.on('end', () => resolve(response.statusCode || 0)); });
    req.on('error', reject);
  });
}

function fixture() {
  let saved: string | undefined;
  let online = true;
  let authorization: URL | undefined;
  const request = jest.fn(async (kind: 'token' | 'channels', _data: any, _signal: AbortSignal) => kind === 'token' ? tokens : { items: [channel] });
  const openBrowser = jest.fn(async (raw: string) => {
    authorization = new URL(raw);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'synthetic-code' }).toString();
    expect(await get(callback)).toBe(200);
  });
  const dependencies = { load: () => saved, save: (value: string | undefined) => { saved = value; },
    assertAccess: () => { if (!online) throw new Error('offline'); }, openBrowser, request };
  const service = new YouTubeConnection(dependencies);
  service.importClient(json);
  return { service, dependencies, request, openBrowser, setOnline: (value: boolean) => { online = value; },
    saved: () => saved, authorization: () => authorization, replaceSaved: (value: string) => { saved = value; } };
}

describe('native desktop YouTube connection', () => {
  test('imports desktop JSON only, ignores imported endpoints, and exposes no credentials', () => {
    const f = fixture();
    expect(f.service.status()).toEqual({ configured: true, signedIn: false, busy: false, channels: [], lastChecked: undefined });
    for (const raw of ['AIza-key', JSON.stringify({ web: client }), JSON.stringify({ installed: { ...client, client_id: 'bad' } }), ' '.repeat(65_537)]) {
      expect(() => f.service.importClient(raw)).toThrow();
    }
    expect(f.saved()).not.toContain('evil.invalid');
    expect(f.openBrowser).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
  });

  test('real loopback callback checks channel, pins Google authorization, uses PKCE and persists for restart', async () => {
    const f = fixture();
    const status = await f.service.connect();
    expect(status.signedIn).toBe(true);
    expect(status.channels).toEqual([{ id: channel.id, title: channel.snippet.title }]);
    expect(status.lastChecked).toBeDefined();
    const auth = f.authorization()!;
    expect(auth.origin + auth.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(auth.searchParams.get('scope')).toBe(tokens.scope);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    const exchange = f.request.mock.calls[0][1];
    expect(exchange.code_verifier.length).toBeGreaterThanOrEqual(43);
    expect(createHash('sha256').update(exchange.code_verifier).digest('base64url')).toBe(auth.searchParams.get('code_challenge'));
    expect(exchange.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);
    expect(exchange.code).toBe('synthetic-code');
    const restarted = new YouTubeConnection(f.dependencies);
    expect(restarted.status()).toEqual(status);
    expect(JSON.stringify(status)).not.toMatch(/synthetic-(client-secret|access|refresh)|client_id|client_secret/);
    expect(() => restarted.importClient(JSON.stringify({ installed: { ...client, client_id: 'other.apps.googleusercontent.com' } }))).toThrow(/Remove/);
  });

  test('rejects wrong state, unicode state, duplicate state, host and path before accepting one valid callback', async () => {
    const f = fixture();
    f.openBrowser.mockImplementation(async raw => {
      const auth = new URL(raw);
      const callback = new URL(auth.searchParams.get('redirect_uri')!);
      const state = auth.searchParams.get('state')!;
      for (const wrong of ['wrong', 'é'.repeat(64)]) {
        callback.search = new URLSearchParams({ state: wrong, code: 'not-accepted' }).toString();
        expect(await get(callback)).toBe(400);
      }
      callback.search = new URLSearchParams({ state, code: 'synthetic-code' }).toString() + '&state=' + state;
      expect(await get(callback)).toBe(400);
      callback.search = new URLSearchParams({ state, code: 'synthetic-code' }).toString();
      expect(await get(callback, { Host: 'evil.invalid' })).toBe(400);
      const wrongPath = new URL(callback); wrongPath.pathname = '/unexpected';
      expect(await get(wrongPath)).toBe(400);
      expect(f.request).not.toHaveBeenCalled();
      expect(await get(callback)).toBe(200);
    });
    expect((await f.service.connect()).signedIn).toBe(true);
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  test('declining Google consent preserves the earlier saved connection and makes no API call', async () => {
    const f = fixture(); await f.service.connect(); const previous = f.saved(); f.request.mockClear();
    f.openBrowser.mockImplementation(async raw => {
      const auth = new URL(raw); const callback = new URL(auth.searchParams.get('redirect_uri')!);
      callback.search = new URLSearchParams({ state: auth.searchParams.get('state')!, error: 'access_denied', error_description: 'do-not-echo' }).toString();
      await get(callback);
    });
    await expect(f.service.connect()).rejects.toThrow(/declined/);
    expect(f.saved()).toBe(previous);
    expect(f.request).not.toHaveBeenCalled();
  });

  test('Online denial prevents browser launch and every API request', async () => {
    const f = fixture(); f.setOnline(false);
    await expect(f.service.connect()).rejects.toThrow(/Online/);
    expect(f.openBrowser).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  test('rechecks Online after browser consent and after token exchange', async () => {
    const f = fixture();
    const open = f.openBrowser.getMockImplementation()!;
    f.openBrowser.mockImplementation(async url => { await open(url); f.setOnline(false); });
    await expect(f.service.connect()).rejects.toThrow(/Online/);
    expect(f.request).not.toHaveBeenCalled();
    f.setOnline(true); f.openBrowser.mockImplementation(open);
    f.request.mockImplementation(async () => { f.setOnline(false); return tokens; });
    await expect(f.service.connect()).rejects.toThrow(/Online/);
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.service.status().signedIn).toBe(false);
  });

  test('refresh retains omitted refresh token, uses fresh access token, and rereads the channel', async () => {
    const f = fixture(); await f.service.connect();
    const record = JSON.parse(f.saved()!); record.tokens.expiresAt = 0; f.replaceSaved(JSON.stringify(record));
    f.request.mockClear();
    f.request.mockImplementation(async kind => kind === 'token'
      ? { access_token: 'new-access', expires_in: 3600, token_type: 'Bearer' } as any : { items: [channel] });
    const status = await new YouTubeConnection(f.dependencies).refresh();
    expect(status.signedIn).toBe(true);
    expect(f.request.mock.calls[0][1]).toMatchObject({ refresh_token: 'synthetic-refresh', grant_type: 'refresh_token' });
    expect(f.request.mock.calls[1][1]).toEqual({ access: 'new-access' });
    expect(JSON.parse(f.saved()!).tokens.refresh).toBe('synthetic-refresh');
  });

  test('removing during an outstanding request prevents late credential resurrection', async () => {
    const f = fixture(); let release!: (value: any) => void;
    f.request.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const operation = f.service.connect(); const failure = expect(operation).rejects.toThrow(/cancelled/);
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    f.service.remove(); release(tokens); await failure;
    expect(f.saved()).toBeUndefined(); expect(f.service.status().configured).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  test('cancel closes the pending callback and does not exchange credentials', async () => {
    const f = fixture(); let callback: string | undefined;
    f.openBrowser.mockImplementation(async raw => { callback = new URL(raw).searchParams.get('redirect_uri')!; });
    const failure = expect(f.service.connect()).rejects.toThrow(/cancelled/);
    while (!callback) await new Promise(resolve => setTimeout(resolve, 5));
    f.service.cancel(); await failure;
    await expect(get(callback!)).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
    expect(f.service.status().busy).toBe(false);
  });

  test('timeout and lost Online authority close pending sign-in', async () => {
    for (const loseAuthority of [false, true]) {
      const f = fixture(); let launched = false;
      f.openBrowser.mockImplementation(async () => { launched = true; });
      const service = new YouTubeConnection({ ...f.dependencies, timeoutMs: loseAuthority ? 2000 : 40 });
      const failure = expect(service.connect()).rejects.toThrow(/cancelled/);
      while (!launched) await new Promise(resolve => setTimeout(resolve, 5));
      if (loseAuthority) f.setOnline(false);
      await failure; expect(service.status().busy).toBe(false); expect(f.request).not.toHaveBeenCalled();
    }
  });

  test('expired permission drops tokens while retaining desktop setup', async () => {
    const f = fixture(); await f.service.connect();
    f.request.mockRejectedValue(new YouTubeConnectionError('Sign in again.', true));
    await expect(f.service.refresh()).rejects.toThrow(/Sign in/);
    expect(f.service.status()).toMatchObject({ configured: true, signedIn: false, channels: [] });
  });

  test.each([
    { ...tokens, refresh_token: undefined }, { ...tokens, scope: 'openid' }, { ...tokens, access_token: 'bad\nheader' },
    { ...tokens, expires_in: '3600' }, { ...tokens, token_type: 'Other' },
  ])('rejects unusable token response without saving a sign-in', async response => {
    const f = fixture(); f.request.mockResolvedValue(response as any);
    await expect(f.service.connect()).rejects.toThrow(/permission/);
    expect(f.service.status().signedIn).toBe(false);
  });

  test('an invalid channel response cannot establish a connection', async () => {
    const f = fixture(); f.request.mockImplementation(async kind => kind === 'token' ? tokens : { items: [{ id: 'bad', snippet: { title: 'fake' } }] });
    await expect(f.service.connect()).rejects.toThrow(/invalid channel/);
    expect(f.service.status().signedIn).toBe(false);
  });

  test('transport uses fixed HTTPS destinations, bounded responses and no redirects', async () => {
    const received: Array<{ method?: string; url?: string; body: string; auth?: string }> = [];
    const server = http.createServer((req, res) => {
      let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
        received.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
        if (req.url === '/token') res.end(JSON.stringify(tokens));
        else res.end(JSON.stringify({ items: [channel] }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const targets: string[] = [];
    (requestProviderEndpoint as jest.Mock).mockImplementation((url: string, _provider: string, options: any, listener: any) => {
      targets.push(url);
      return http.request({ ...options, host: '127.0.0.1', port, path: url.includes('/token') ? '/token' : '/channels' }, listener);
    });
    try {
      const f = fixture();
      const service = new YouTubeConnection({ ...f.dependencies, request: undefined });
      expect((await service.connect()).channels).toHaveLength(1);
      expect(targets[0]).toBe('https://oauth2.googleapis.com/token');
      expect(targets[1]).toMatch(/^https:\/\/www\.googleapis\.com\/youtube\/v3\/channels\?/);
      expect(received[0].method).toBe('POST'); expect(new URLSearchParams(received[0].body).get('client_secret')).toBe(client.client_secret);
      expect(received[1].auth).toBe('Bearer synthetic-access');
      server.removeAllListeners('request');
      server.on('request', (_req, res) => { res.writeHead(302, { Location: 'https://evil.invalid' }); res.end('{}'); });
      await expect(service.refresh()).rejects.toThrow(/could not complete/);
      expect(targets).toHaveLength(3);
      server.removeAllListeners('request');
      server.on('request', (_req, res) => { res.end('x'.repeat(1_000_001)); });
      await expect(service.refresh()).rejects.toThrow();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
