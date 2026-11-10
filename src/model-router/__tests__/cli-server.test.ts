import type * as http from 'node:http';
import * as path from 'node:path';
import { main, parseArgs } from '../cli';
import { REPO_DEFAULT_CONFIG_PATH } from '../config';
import { SpendLedger } from '../ledger';
import { LIVE_ENV, completion, forbidRealFetch, mockFetch, tempDir } from './helpers';

forbidRealFetch();

function io(env: Record<string, string | undefined>, fetch = mockFetch([]).fetch) {
  const out: string[] = [];
  const err: string[] = [];
  let server: http.Server | undefined;
  let url = '';
  return {
    out, err,
    get server() { return server; },
    get url() { return url; },
    io: {
      stdout: (t: string) => { out.push(t); },
      stderr: (t: string) => { err.push(t); },
      env,
      fetch,
      onServer: (s: http.Server, u: string) => { server = s; url = u; },
    },
  };
}

function baseEnv(dir: string, extra: Record<string, string> = {}) {
  return { MODEL_ROUTER_CONFIG: REPO_DEFAULT_CONFIG_PATH, MODEL_ROUTER_LEDGER: path.join(dir, 'ledger.json'), ...extra };
}

describe('CLI', () => {
  it('parses flags', () => {
    expect(parseArgs(['pick', '--task', 'x', '--files=2', '--failed'])).toEqual({ command: 'pick', flags: { task: 'x', files: '2', failed: true } });
    expect(() => parseArgs(['run', '--task'])).toThrow(/needs a value/);
  });

  it('pick prints the tier and models', async () => {
    const t = io(baseEnv(tempDir()));
    expect(await main(['pick', '--task', 'fix typo in README', '--files', '1', '--diff', '2'], t.io)).toBe(0);
    const out = JSON.parse(t.out.join(''));
    expect(out.tier).toBe('cheap');
    expect(out.models).toEqual(['qwen/qwen3.7-flash', 'deepseek/deepseek-v4.1-flash']);
  });

  it('run is a dry run by default and sends nothing', async () => {
    const mock = mockFetch([]);
    const t = io(baseEnv(tempDir(), { OPENROUTER_API_KEY: 'test-key-not-real' }), mock.fetch);
    expect(await main(['run', '--task', 'add a field to the form', '--files', '3', '--diff', '50', '--json'], t.io)).toBe(0);
    const out = JSON.parse(t.out.join(''));
    expect(out.dryRun).toBe(true);
    expect(out.tier).toBe('mid');
    expect(mock.calls).toHaveLength(0);
  });

  it('--live without a key warns and stays dry', async () => {
    const mock = mockFetch([]);
    const t = io(baseEnv(tempDir()), mock.fetch);
    expect(await main(['run', '--task', 'hi', '--live'], t.io)).toBe(0);
    expect(t.err.join('')).toMatch(/OPENROUTER_API_KEY is not set/);
    expect(mock.calls).toHaveLength(0);
  });

  it('run --live with a key calls the mocked fetch and spend reports it', async () => {
    const dir = tempDir();
    const mock = mockFetch([completion('patched', { cost: 0.02 })]);
    const t = io(baseEnv(dir, { OPENROUTER_API_KEY: 'test-key-not-real' }), mock.fetch);
    expect(await main(['run', '--task', 'fix typo', '--files', '1', '--diff', '1', '--live'], t.io)).toBe(0);
    expect(mock.calls).toHaveLength(1);
    expect(t.out.join('')).toMatch(/patched/);
    const s = io(baseEnv(dir));
    expect(await main(['spend', '--json'], s.io)).toBe(0);
    expect(JSON.parse(s.out.join('')).spentUsd).toBeCloseTo(0.02);
  });

  it('exits 1 with the cap message when capped', async () => {
    const dir = tempDir();
    const t = io(baseEnv(dir, { MODEL_ROUTER_MONTHLY_CAP_USD: '0' }));
    expect(await main(['run', '--task', 'hi'], t.io)).toBe(1);
    expect(t.err.join('')).toMatch(/Monthly spend cap reached/);
  });

  it('config never prints the key', async () => {
    const t = io(baseEnv(tempDir(), { OPENROUTER_API_KEY: 'test-key-not-real' }));
    expect(await main(['config'], t.io)).toBe(0);
    expect(t.out.join('')).not.toContain('test-key-not-real');
    expect(JSON.parse(t.out.join('')).tiers.top.model).toBe('anthropic/claude-opus-5.5');
  });

  it('unknown command exits 2', async () => {
    const t = io(baseEnv(tempDir()));
    expect(await main(['nope'], t.io)).toBe(2);
  });
});

describe('OpenAI-compatible endpoint', () => {
  async function serve(env: Record<string, string>, fetchMock = mockFetch([])) {
    const t = io(env, fetchMock.fetch);
    expect(await main(['serve', '--port', '0'], t.io)).toBe(0);
    expect(t.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    return t;
  }
  // Talks to our own 127.0.0.1 server with node:http, never the internet.
  function post(url: string, body: unknown): Promise<{ status: number; json: any }> {
    const http = require('node:http') as typeof import('node:http');
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
        let text = '';
        res.on('data', c => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode || 0, json: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(data);
    });
  }

  it('dry run: returns an OpenAI-shaped completion with router metadata', async () => {
    const dir = tempDir();
    const t = await serve(baseEnv(dir));
    try {
      const r = await post(t.url, { model: 'auto', messages: [{ role: 'user', content: 'fix typo in README' }], router: { files: 1, diffLines: 2 } });
      expect(r.status).toBe(200);
      expect(r.json.object).toBe('chat.completion');
      expect(r.json.model).toBe('qwen/qwen3.7-flash');
      expect(r.json.choices[0].message.content).toMatch(/dry run/i);
      expect(r.json.router).toMatchObject({ dry_run: true, tier: 'cheap' });
    } finally { t.server?.close(); }
  });

  it('live (mocked fetch): forces a tier via model router/top and passes session_id', async () => {
    const dir = tempDir();
    const mock = mockFetch([completion('ok', { model: 'anthropic/claude-opus-5.5', cost: 0.1 })]);
    const t = await serve(baseEnv(dir, LIVE_ENV), mock);
    try {
      const r = await post(t.url, { model: 'router/top', session_id: 'agent-7', messages: [{ role: 'user', content: 'hello' }] });
      expect(r.status).toBe(200);
      expect(r.json.choices[0].message.content).toBe('ok');
      expect(mock.calls[0].body.models[0]).toBe('anthropic/claude-opus-5.5');
      expect(mock.calls[0].body.session_id).toBe('agent-7');
      expect(new SpendLedger(path.join(dir, 'ledger.json'), 35).read()[0].source).toBe('endpoint');
    } finally { t.server?.close(); }
  });

  it('returns 402 when capped and 400 for stream or bad bodies', async () => {
    const t = await serve(baseEnv(tempDir(), { MODEL_ROUTER_MONTHLY_CAP_USD: '0' }));
    try {
      const capped = await post(t.url, { messages: [{ role: 'user', content: 'hi' }] });
      expect(capped.status).toBe(402);
      expect(capped.json.error.code).toBe('SPEND_CAP_EXCEEDED');
      expect((await post(t.url, { messages: [{ role: 'user', content: 'hi' }], stream: true })).status).toBe(400);
      expect((await post(t.url, { messages: [] })).status).toBe(400);
    } finally { t.server?.close(); }
  });
});
