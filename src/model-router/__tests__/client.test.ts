import * as fs from 'node:fs';
import * as path from 'node:path';
import { ModelRouter, RouterRequestError, buildChatRequest, formatRouteBadge, stableSessionId } from '../client';
import { REPO_DEFAULT_CONFIG_PATH, loadRouterConfig } from '../config';
import { SpendCapExceededError, SpendLedger } from '../ledger';
import { LIVE_ENV, completion, forbidRealFetch, mockFetch, tempDir } from './helpers';

forbidRealFetch();

function setup(env: Record<string, string | undefined>, replies: Parameters<typeof mockFetch>[0] = [], cap = 35) {
  const dir = tempDir();
  const config = loadRouterConfig({ path: REPO_DEFAULT_CONFIG_PATH, env: { ...env, MODEL_ROUTER_LEDGER: path.join(dir, 'ledger.json') } });
  const ledger = new SpendLedger(config.ledgerPath, cap, () => new Date('2026-11-10T06:00:00Z'));
  const mock = mockFetch(replies);
  const router = new ModelRouter({ config, ledger, fetch: mock.fetch, env });
  return { router, ledger, calls: mock.calls, config, dir };
}

describe('request shape', () => {
  const config = loadRouterConfig({ path: REPO_DEFAULT_CONFIG_PATH, env: {} });
  const messages = [{ role: 'user' as const, content: 'hi' }];

  it('sends models[] primary-first, session_id, max_tokens and provider.max_price', () => {
    const body = buildChatRequest(config, 'mid', messages, 'sess-1');
    expect(body.models).toEqual(['anthropic/claude-sonnet-5.5', 'openai/gpt-6.1-terra']);
    expect(body).not.toHaveProperty('model');
    expect(body.session_id).toBe('sess-1');
    expect(body.max_tokens).toBe(8192);
    expect(body.provider).toEqual({ max_price: { prompt: 2, completion: 10 }, require_parameters: true });
    expect(body.usage).toEqual({ include: true });
  });

  it('adds cache_control for anthropic/ and qwen/ primaries only', () => {
    expect(buildChatRequest(config, 'cheap', messages, 's').cache_control).toEqual({ type: 'ephemeral' });
    expect(buildChatRequest(config, 'top', messages, 's').cache_control).toEqual({ type: 'ephemeral' });
    const openaiFirst = { ...config, tiers: { ...config.tiers, mid: { ...config.tiers.mid, model: 'openai/gpt-6.1-terra', fallbacks: [] } } };
    expect(buildChatRequest(openaiFirst, 'mid', messages, 's').cache_control).toBeUndefined();
    const withTtl = { ...config, cacheTtl: '1h' as const };
    expect(buildChatRequest(withTtl, 'mid', messages, 's').cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('cheap tier uses the cheap price ceiling', () => {
    const body = buildChatRequest(config, 'cheap', messages, 's');
    expect(body.provider.max_price).toEqual({ prompt: 0.1, completion: 0.7 });
    expect(body.max_tokens).toBe(4096);
  });

  it('session ids are stable per seed', () => {
    expect(stableSessionId('task A')).toBe(stableSessionId('task A'));
    expect(stableSessionId('task A')).not.toBe(stableSessionId('task B'));
  });
});

describe('dry run is the default', () => {
  it('sends nothing without live mode, even with a key set', async () => {
    const { router, calls, ledger } = setup({ OPENROUTER_API_KEY: 'test-key-not-real' });
    const result = await router.complete({ task: 'fix typo in README', files: 1, diffLines: 2 });
    expect(calls).toHaveLength(0);
    expect(result.dryRun).toBe(true);
    expect(result.tier).toBe('cheap');
    expect(result.model).toBe('qwen/qwen3.7-flash');
    expect(result.content).toMatch(/dry run/i);
    expect(result.costEstimated).toBe(true);
    expect(result.request.models).toEqual(['qwen/qwen3.7-flash', 'deepseek/deepseek-v4.1-flash']);
    expect(ledger.read()).toHaveLength(0);
  });

  it('sends nothing with live mode but no key', async () => {
    const { router, calls } = setup({ MODEL_ROUTER_LIVE: '1' });
    const result = await router.complete({ task: 'hello' });
    expect(calls).toHaveLength(0);
    expect(result.dryRun).toBe(true);
    expect(result.mode).toMatch(/OPENROUTER_API_KEY is not set/);
  });

  it('labels dry-run cost as a mock estimate', async () => {
    const { router } = setup({});
    const result = await router.complete({ task: 'hello' });
    expect(formatRouteBadge(result)).toMatch(/mock estimate, dry run/);
  });
});

describe('live calls (mocked fetch)', () => {
  it('posts to OpenRouter with the bearer key and records usage.cost in the ledger', async () => {
    const { router, calls, ledger } = setup(LIVE_ENV, [completion('done', { cost: 0.0123, prompt: 500, completion: 40, cached: 300 })]);
    const result = await router.complete({ task: 'fix typo in README', files: 1, diffLines: 2, sessionId: 'task-42' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer test-key-not-real');
    expect(calls[0].body.models).toEqual(['qwen/qwen3.7-flash', 'deepseek/deepseek-v4.1-flash']);
    expect(calls[0].body.session_id).toBe('task-42');
    expect(calls[0].body.cache_control).toEqual({ type: 'ephemeral' });
    expect(calls[0].body.max_tokens).toBe(4096);
    expect(calls[0].body.provider.max_price).toEqual({ prompt: 0.1, completion: 0.7 });
    expect(result.dryRun).toBe(false);
    expect(result.content).toBe('done');
    expect(result.costUsd).toBe(0.0123);
    expect(result.costEstimated).toBe(false);
    const entries = ledger.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ month: '2026-11', tier: 'cheap', model: 'qwen/qwen3.7-flash', promptTokens: 500, completionTokens: 40, cachedTokens: 300, costUsd: 0.0123, estimated: false, source: 'coder' });
    // The key never lands in the result.
    expect(JSON.stringify(result)).not.toContain('test-key-not-real');
  });

  it('estimates cost from config pricing when usage.cost is missing', async () => {
    const { router, ledger } = setup(LIVE_ENV, [completion('ok', { model: 'anthropic/claude-sonnet-5.5', prompt: 1_000_000, completion: 0 })]);
    const result = await router.complete({ task: 'add a field to the form', files: 3, diffLines: 100 });
    expect(result.tier).toBe('mid');
    expect(result.costUsd).toBeCloseTo(2);
    expect(result.costEstimated).toBe(true);
    expect(ledger.read()[0].estimated).toBe(true);
  });

  it('escalates one tier per failure and keeps the session id', async () => {
    const { router, calls } = setup(LIVE_ENV, [
      { status: 503, body: { error: { message: 'upstream down' } } },
      completion('', { model: 'anthropic/claude-sonnet-5.5' }),
      completion('fixed', { model: 'anthropic/claude-opus-5.5', cost: 0.5 }),
    ]);
    const result = await router.complete({ task: 'fix typo', files: 1, diffLines: 1 });
    expect(calls.map(c => c.body.models[0])).toEqual(['qwen/qwen3.7-flash', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5']);
    expect(new Set(calls.map(c => c.body.session_id)).size).toBe(1);
    expect(result.tier).toBe('top');
    expect(result.attempts.map(a => [a.tier, a.ok])).toEqual([['cheap', false], ['mid', false], ['top', true]]);
  });

  it('escalates on network errors and gives up after top', async () => {
    const { router, calls } = setup(LIVE_ENV, [new Error('ECONNRESET'), { status: 500, body: 'boom' }]);
    await expect(router.complete({ task: 'add a field', files: 3, diffLines: 100 })).rejects.toThrow(RouterRequestError);
    expect(calls.map(c => c.body.models[0])).toEqual(['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5']);
  });

  it('never escalates past top or retries top', async () => {
    const { router, calls } = setup(LIVE_ENV, [{ status: 500, body: 'x' }]);
    await expect(router.complete({ task: 'migrate the schema', files: 1, diffLines: 1 })).rejects.toThrow(/All tiers failed/);
    expect(calls).toHaveLength(1);
  });

  it('does not escalate on 401/402/403 (key or credit problems)', async () => {
    const { router, calls } = setup(LIVE_ENV, [{ status: 403, body: { error: { message: 'Key limit exceeded' } } }]);
    await expect(router.complete({ task: 'fix typo', files: 1, diffLines: 1 })).rejects.toThrow(/Not escalating/);
    expect(calls).toHaveLength(1);
  });
});

describe('monthly cap', () => {
  it('refuses calls once the cap is hit, with a clear error and no request', async () => {
    const { router, calls, ledger } = setup(LIVE_ENV, [completion('a', { cost: 0.6 }), completion('b', { cost: 0.6 })], 1);
    await router.complete({ task: 'fix typo', files: 1, diffLines: 1 });
    await router.complete({ task: 'fix typo', files: 1, diffLines: 1 });
    expect(ledger.monthTotal()).toBeCloseTo(1.2);
    const err = await router.complete({ task: 'fix typo', files: 1, diffLines: 1 }).catch(e => e);
    expect(err).toBeInstanceOf(SpendCapExceededError);
    expect(err.message).toMatch(/Monthly spend cap reached: \$1\.2000 spent of the \$1\.00 cap for 2026-11/);
    expect(err.message).toMatch(/No request was sent/);
    expect(calls).toHaveLength(2);
  });

  it('also refuses dry runs once capped, so the state is visible before going live', async () => {
    const { router } = setup({}, [], 0);
    await expect(router.complete({ task: 'hi' })).rejects.toThrow(SpendCapExceededError);
  });

  it('a new UTC month starts from zero', () => {
    const dir = tempDir();
    const file = path.join(dir, 'ledger.json');
    let now = new Date('2026-11-30T23:00:00Z');
    const ledger = new SpendLedger(file, 1, () => now);
    ledger.record({ source: 'coder', tier: 'mid', model: 'm/x', sessionId: 's', promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 5, estimated: false });
    expect(() => ledger.assertUnderCap()).toThrow(SpendCapExceededError);
    now = new Date('2026-12-01T00:00:01Z');
    expect(() => ledger.assertUnderCap()).not.toThrow();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).entries).toHaveLength(1);
  });

  it('a corrupt ledger is an error, not a silent reset', () => {
    const dir = tempDir();
    const file = path.join(dir, 'ledger.json');
    fs.writeFileSync(file, '{not json');
    const ledger = new SpendLedger(file, 10);
    expect(() => ledger.assertUnderCap()).toThrow(/could not be read/);
  });
});
