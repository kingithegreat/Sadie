import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { YouTubeConnectionStatus } from '../../shared/youtube-connection';
import { requestProviderEndpoint } from '../utils/provider-network-policy';

const READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CHANNEL_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50&fields=items(id,snippet(title))';
const CANCELLED = 'YouTube sign-in was cancelled. You can try again when Production Studio and Online access are enabled.';

interface DesktopClient { id: string; secret?: string }
interface GoogleTokens { access: string; refresh: string; expiresAt: number; scope?: string }
interface SavedConnection {
  version: 1;
  client: DesktopClient;
  tokens?: GoogleTokens;
  channels?: YouTubeConnectionStatus['channels'];
  lastChecked?: string;
}
interface ConnectionDependencies {
  load: () => string | undefined;
  save: (value: string | undefined) => void;
  assertAccess: () => void;
  openBrowser: (url: string) => Promise<void>;
  request?: typeof googleRequest;
  timeoutMs?: number;
}

/** Only deliberately authored errors cross IPC; remote bodies are never echoed. */
export class YouTubeConnectionError extends Error {
  constructor(message: string, readonly needsSignIn = false) { super(message); }
}

function tokenString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(value);
}

function desktopClient(value: any): DesktopClient {
  if (!value || typeof value !== 'object' ||
      typeof value.client_id !== 'string' || !/^[\w-]{1,200}\.apps\.googleusercontent\.com$/.test(value.client_id) ||
      (value.client_secret !== undefined && !tokenString(value.client_secret))) {
    throw new YouTubeConnectionError('Choose the JSON file downloaded for a Google Desktop app client. A Gemini API key is entered in model settings.');
  }
  // Never trust auth_uri, token_uri or redirect_uris supplied by an import.
  return { id: value.client_id, ...(value.client_secret ? { secret: value.client_secret } : {}) };
}

function googleRequest(kind: 'token' | 'channels', data: Record<string, string>, signal: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new YouTubeConnectionError(CANCELLED)); return; }
    const body = kind === 'token' ? new URLSearchParams(data).toString() : '';
    const failed = () => reject(new YouTubeConnectionError('Google could not be reached. Check your connection and try again.'));
    const req = requestProviderEndpoint(kind === 'token' ? TOKEN_URL : CHANNEL_URL, 'YouTube', {
      method: kind === 'token' ? 'POST' : 'GET', timeout: 15_000,
      headers: kind === 'token'
        ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json' }
        : { Authorization: `Bearer ${data.access}`, Accept: 'application/json' },
    }, response => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1_000_000) { req.destroy(); failed(); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.on('error', failed);
      response.on('end', () => {
        if (signal.aborted) { reject(new YouTubeConnectionError(CANCELLED)); return; }
        let result: any;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { reject(new YouTubeConnectionError('Google returned an unreadable response. Try again.')); return; }
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          if (status === 401 || result?.error === 'invalid_grant') reject(new YouTubeConnectionError('Google sign-in has expired or was removed. Sign in again.', true));
          else if (status === 403) reject(new YouTubeConnectionError('Google denied channel access. Enable YouTube Data API v3 in the same project, and allow the requested YouTube permission.'));
          else if (status === 429) reject(new YouTubeConnectionError('Google is limiting requests. Wait a little and try again.'));
          else reject(new YouTubeConnectionError('Google could not complete this request. Check the Desktop app credentials and test-user settings, then try again.'));
          return;
        }
        resolve(result);
      });
    });
    const abort = () => { req.destroy(); reject(new YouTubeConnectionError(CANCELLED)); };
    signal.addEventListener('abort', abort, { once: true });
    req.on('close', () => signal.removeEventListener('abort', abort));
    req.on('error', failed);
    req.on('timeout', () => { req.destroy(); failed(); });
    req.end(body || undefined);
  });
}

/** One transient loopback listener per sign-in; no externally reachable server. */
async function authorizationCallback(state: string, signal: AbortSignal): Promise<{ redirect: string; code: Promise<string> }> {
  let settle: (value: string | Error) => void = () => {};
  const code = new Promise<string>((resolve, reject) => { settle = value => value instanceof Error ? reject(value) : resolve(value); });
  // Browser launch can fail before the caller awaits code; attach a rejection handler now.
  void code.catch(() => {});
  let finished = false;
  let expectedHost = '';
  const close = (value: string | Error) => {
    if (finished) return;
    finished = true;
    signal.removeEventListener('abort', abort);
    server.close();
    server.closeIdleConnections();
    settle(value);
  };
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Connection', 'close');
    const invalid = () => { res.statusCode = 400; res.end('This sign-in response is not valid. Return to HomeBot.'); };
    if (finished || req.method !== 'GET' || req.headers.host !== expectedHost || !req.url?.startsWith('/') || req.url.length > 8192) { invalid(); return; }
    let url: URL;
    try { url = new URL(req.url, `http://${expectedHost}`); } catch { invalid(); return; }
    const returned = url.searchParams.get('state') || '';
    if (url.host !== expectedHost || url.pathname !== '/oauth2callback' || url.searchParams.getAll('state').length !== 1 ||
        !/^[a-f0-9]{64}$/.test(returned) || !timingSafeEqual(Buffer.from(returned), Buffer.from(state))) { invalid(); return; }
    if (url.searchParams.has('error')) {
      res.end('Sign-in was not completed. Return to HomeBot to try again.');
      close(new YouTubeConnectionError('Google sign-in was declined. Your existing connection was kept.'));
      return;
    }
    const value = url.searchParams.get('code');
    if (url.searchParams.getAll('code').length !== 1 || !tokenString(value)) { invalid(); return; }
    res.end('Google returned your sign-in. Return to HomeBot to see the channel check result.');
    close(value);
  });
  const abort = () => { close(new YouTubeConnectionError(CANCELLED)); server.closeAllConnections(); };
  server.unref();
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => { close(new YouTubeConnectionError('HomeBot could not open the local sign-in callback. Try again.')); reject(new YouTubeConnectionError('HomeBot could not open the local sign-in callback. Try again.')); });
    server.listen(0, '127.0.0.1', () => resolve());
  });
  expectedHost = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return { redirect: `http://${expectedHost}/oauth2callback`, code };
}

/** Main-process adapter; all persistence/authority is injected by the Studio host. */
export class YouTubeConnection {
  private operation?: AbortController;
  constructor(private readonly dependencies: ConnectionDependencies) {}

  private load(): SavedConnection | undefined {
    try {
      const raw = this.dependencies.load();
      if (!raw) return undefined;
      const saved = JSON.parse(raw) as SavedConnection;
      if (saved.version !== 1) throw new Error();
      desktopClient({ client_id: saved.client?.id, client_secret: saved.client?.secret });
      if (saved.tokens && (!tokenString(saved.tokens.access) || !tokenString(saved.tokens.refresh) || !Number.isFinite(saved.tokens.expiresAt))) throw new Error();
      if (saved.channels && (!Array.isArray(saved.channels) || saved.channels.length > 50 || saved.channels.some(c => !c || typeof c.id !== 'string' || !/^UC[\w-]{22}$/.test(c.id) || typeof c.title !== 'string' || c.title.length > 300))) throw new Error();
      if (saved.lastChecked !== undefined && (typeof saved.lastChecked !== 'string' || !Number.isFinite(Date.parse(saved.lastChecked)))) throw new Error();
      return saved;
    } catch { throw new YouTubeConnectionError('HomeBot cannot read this saved Google connection. Remove it and import the Desktop app JSON again.'); }
  }

  private save(value: SavedConnection | undefined): void {
    try { this.dependencies.save(value ? JSON.stringify(value) : undefined); }
    catch { throw new YouTubeConnectionError('HomeBot could not save the Google connection securely. Your connection was not updated.'); }
  }

  status(): YouTubeConnectionStatus {
    const saved = this.load();
    const result: YouTubeConnectionStatus = {
      configured: !!saved, signedIn: !!saved?.tokens, busy: !!this.operation,
      channels: saved?.channels || [], lastChecked: saved?.lastChecked,
    };
    if (saved?.tokens && saved.tokens.scope) {
      result.canUpload = saved.tokens.scope.includes('youtube.upload') || saved.tokens.scope.includes('/auth/youtube');
    }
    return result;
  }

  importClient(raw: string): YouTubeConnectionStatus {
    if (this.operation) throw new YouTubeConnectionError('Finish or cancel the current connection attempt first.');
    let parsed: any;
    try {
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > 65_536) throw new Error();
      parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch { throw new YouTubeConnectionError('Choose a valid Desktop app JSON file downloaded from Google Cloud.'); }
    const client = desktopClient(parsed?.installed);
    const previous = this.load();
    if (previous?.client.id === client.id && previous.client.secret === client.secret) return this.status();
    if (previous?.tokens) throw new YouTubeConnectionError('Remove the saved connection before switching Google projects.');
    this.save({ version: 1, client });
    return this.status();
  }

  cancel(): YouTubeConnectionStatus { this.operation?.abort(); return this.status(); }

  remove(): YouTubeConnectionStatus {
    this.operation?.abort();
    this.save(undefined);
    return this.status();
  }

  private check(signal: AbortSignal): void {
    if (signal.aborted) throw new YouTubeConnectionError(CANCELLED);
    try { this.dependencies.assertAccess(); }
    catch { throw new YouTubeConnectionError('YouTube needs Production Studio and Online access enabled. Check Modules and Settings, then try again.'); }
  }

  private async run(kind: 'connect' | 'refresh', action: (signal: AbortSignal) => Promise<void>): Promise<YouTubeConnectionStatus> {
    if (this.operation) throw new YouTubeConnectionError('A YouTube connection attempt is already running.');
    const op = new AbortController();
    this.check(op.signal);
    this.operation = op;
    const timer = setTimeout(() => op.abort(), this.dependencies.timeoutMs ?? 120_000);
    const watch = setInterval(() => { try { this.check(op.signal); } catch { op.abort(); } }, 250);
    timer.unref(); watch.unref();
    try { await action(op.signal); }
    catch (error) {
      // A rejected replacement authorization says nothing about the old grant.
      if (kind === 'refresh' && error instanceof YouTubeConnectionError && error.needsSignIn && !op.signal.aborted) {
        const saved = this.load();
        if (saved) this.save({ version: 1, client: saved.client });
      }
      if (error instanceof YouTubeConnectionError) throw error;
      throw new YouTubeConnectionError('YouTube could not complete the connection. Try again.');
    } finally {
      clearTimeout(timer); clearInterval(watch);
      op.abort();
      if (this.operation === op) this.operation = undefined;
    }
    return this.status();
  }

  private async request(kind: 'token' | 'channels', data: Record<string, string>, signal: AbortSignal): Promise<any> {
    this.check(signal);
    const result = await (this.dependencies.request || googleRequest)(kind, data, signal);
    this.check(signal);
    return result;
  }

  private tokens(response: any, refresh?: string): GoogleTokens {
    const validScope = response.scope === undefined || (typeof response.scope === 'string' && response.scope.split(' ').some((s: string) => s === READ_SCOPE || s === YOUTUBE_UPLOAD_SCOPE || s === 'https://www.googleapis.com/auth/youtube'));
    if (!tokenString(response?.access_token) || !tokenString(response?.refresh_token ?? refresh) ||
        typeof response.expires_in !== 'number' || response.expires_in <= 0 || response.expires_in > 86_400 ||
        String(response.token_type).toLowerCase() !== 'bearer' || !validScope) {
      throw new YouTubeConnectionError('Google did not return the required YouTube sign-in permission. Sign in again and allow YouTube access.');
    }
    return {
      access: response.access_token,
      refresh: response.refresh_token ?? refresh,
      expiresAt: Date.now() + response.expires_in * 1000,
      scope: typeof response.scope === 'string' ? response.scope : undefined,
    };
  }

  private async channels(tokens: GoogleTokens, signal: AbortSignal): Promise<YouTubeConnectionStatus['channels']> {
    const response = await this.request('channels', { access: tokens.access }, signal);
    if (!Array.isArray(response?.items) || response.items.length > 50) throw new YouTubeConnectionError('Google returned an invalid channel list. Try checking the connection again.');
    return response.items.map((item: any) => {
      if (!/^UC[\w-]{22}$/.test(item?.id) || typeof item?.snippet?.title !== 'string' || item.snippet.title.length > 300) throw new YouTubeConnectionError('Google returned an invalid channel. Try checking the connection again.');
      return { id: item.id, title: item.snippet.title };
    });
  }

  connect(options?: { upload?: boolean }): Promise<YouTubeConnectionStatus> {
    return this.run('connect', async signal => {
      const saved = this.load();
      if (!saved) throw new YouTubeConnectionError('Import your Google Desktop app JSON first.');
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(32).toString('hex');
      const callback = await authorizationCallback(state, signal);
      this.check(signal);
      const requestedScope = options?.upload ? `${READ_SCOPE} ${YOUTUBE_UPLOAD_SCOPE}` : READ_SCOPE;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: saved.client.id, redirect_uri: callback.redirect,
        response_type: 'code', scope: requestedScope, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account' }).toString();
      await this.dependencies.openBrowser(url.toString());
      this.check(signal);
      const code = await callback.code;
      const tokens = this.tokens(await this.request('token', { client_id: saved.client.id,
        ...(saved.client.secret ? { client_secret: saved.client.secret } : {}), code, code_verifier: verifier,
        redirect_uri: callback.redirect, grant_type: 'authorization_code' }, signal));
      const channels = await this.channels(tokens, signal);
      this.check(signal);
      this.save({ ...saved, tokens, channels, lastChecked: new Date().toISOString() });
    });
  }

  refresh(): Promise<YouTubeConnectionStatus> {
    return this.run('refresh', async signal => {
      const saved = this.load();
      if (!saved?.tokens) throw new YouTubeConnectionError('Sign in to Google first.');
      let tokens = saved.tokens;
      if (tokens.expiresAt < Date.now() + 60_000) {
        tokens = this.tokens(await this.request('token', { client_id: saved.client.id,
          ...(saved.client.secret ? { client_secret: saved.client.secret } : {}),
          refresh_token: tokens.refresh, grant_type: 'refresh_token' }, signal), tokens.refresh);
      }
      const channels = await this.channels(tokens, signal);
      this.check(signal);
      this.save({ ...saved, tokens, channels, lastChecked: new Date().toISOString() });
    });
  }

  async getAccessToken(signal: AbortSignal, requireUpload = false): Promise<string> {
    this.check(signal);
    const saved = this.load();
    if (!saved?.tokens) throw new YouTubeConnectionError('Sign in to Google first.', true);
    if (requireUpload && saved.tokens.scope && !saved.tokens.scope.includes('youtube.upload') && !saved.tokens.scope.includes('/auth/youtube')) {
      throw new YouTubeConnectionError('YouTube upload permission is not granted. Please sign in again and allow upload access.', true);
    }
    let tokens = saved.tokens;
    if (tokens.expiresAt < Date.now() + 60_000) {
      tokens = this.tokens(await this.request('token', {
        client_id: saved.client.id,
        ...(saved.client.secret ? { client_secret: saved.client.secret } : {}),
        refresh_token: tokens.refresh,
        grant_type: 'refresh_token',
      }, signal), tokens.refresh);
      this.save({ ...saved, tokens, lastChecked: new Date().toISOString() });
    }
    return tokens.access;
  }
}
