import { JevDecisionProvider, parseJevResult } from '../jev-provider';
import { createDecisionProvider, withLocalFallback } from '../index';
import { DecisionError, normalizeDecisionProvider, type DecisionQuestion } from '../types';

const questions: DecisionQuestion[] = [
  { id: 'tool', type: 'choice', prompt: 'Which tool?', options: ['chat', 'weather'], keywords: { weather: ['rain'] } },
  { id: 'risky', type: 'boolean', prompt: 'Risky?' },
];

const okBody = {
  answers: { tool: 'weather', risky: false },
  probabilities: { tool: { chat: 0.1, weather: 0.9 }, risky: { true: 0.05, false: 0.95 } },
  confidence: { tool: 0.9, risky: 0.95 },
};

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Partial<Response>>) {
  return jest.fn(impl) as unknown as jest.Mock & ((u: string, i?: RequestInit) => Promise<Response>);
}

// Guard: no test in this file may reach the real network.
const realFetch = globalThis.fetch;
beforeAll(() => { (globalThis as any).fetch = jest.fn(() => { throw new Error('real fetch called'); }); });
afterAll(() => { (globalThis as any).fetch = realFetch; });

describe('decision.provider selection', () => {
  it('defaults to local when unset or unknown', () => {
    expect(createDecisionProvider(undefined).id).toBe('local');
    expect(createDecisionProvider({}).id).toBe('local');
    expect(createDecisionProvider({ decision: { provider: 'gpt' } }).id).toBe('local');
    expect(normalizeDecisionProvider(undefined)).toBe('local');
  });

  it('selects jev only when the flag says so', () => {
    expect(createDecisionProvider({ decision: { provider: 'jev' } }, { env: {} }).id).toBe('jev');
  });
});

describe('JevDecisionProvider', () => {
  it('is disabled without TYPESAFE_API_KEY and makes no call', async () => {
    const f = mockFetch(async () => ({}));
    const p = new JevDecisionProvider({ env: {}, fetch: f });
    expect(p.enabled).toBe(false);
    await expect(p.decide({}, questions)).rejects.toMatchObject({ name: 'DecisionError', code: 'disabled' });
    expect(f).not.toHaveBeenCalled();
  });

  it('POSTs to /v1/systemone with the key from env and parses the result', async () => {
    const f = mockFetch(async () => ({ ok: true, status: 200, json: async () => okBody }));
    const p = new JevDecisionProvider({ env: { TYPESAFE_API_KEY: 'test-key' }, fetch: f, baseUrl: 'https://mock.invalid/' });
    const r = await p.decide({ text: 'rain?' }, questions);
    expect(r).toEqual(okBody);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://mock.invalid/v1/systemone');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe('jev-latest');
    expect(sent.state).toEqual({ text: 'rain?' });
    expect(sent.questions[0].keywords).toBeUndefined(); // local hints stay local
  });

  it('maps HTTP errors, network errors and bad bodies to typed errors', async () => {
    const opts = { apiKey: 'k' };
    await expect(new JevDecisionProvider({ ...opts, fetch: mockFetch(async () => ({ ok: false, status: 401 })) })
      .decide({}, questions)).rejects.toMatchObject({ code: 'http', status: 401 });
    await expect(new JevDecisionProvider({ ...opts, fetch: mockFetch(async () => { throw new Error('ECONNREFUSED'); }) })
      .decide({}, questions)).rejects.toMatchObject({ code: 'network' });
    await expect(new JevDecisionProvider({ ...opts, fetch: mockFetch(async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } })) })
      .decide({}, questions)).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(new JevDecisionProvider({ ...opts, fetch: mockFetch(async () => ({ ok: true, json: async () => ({ answers: { tool: 'nope', risky: false } }) })) })
      .decide({}, questions)).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('times out via AbortController', async () => {
    const f = mockFetch((_u, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
    }));
    await expect(new JevDecisionProvider({ apiKey: 'k', fetch: f, timeoutMs: 10 }).decide({}, questions))
      .rejects.toMatchObject({ code: 'timeout' });
  });

  it('parseJevResult tolerates missing probabilities/confidence', () => {
    const r = parseJevResult({ answers: { tool: 'chat', risky: true } }, questions);
    expect(r.confidence).toEqual({ tool: 0, risky: 0 });
    expect(r.probabilities).toEqual({ tool: {}, risky: {} });
  });
});

describe('withLocalFallback', () => {
  it('answers locally when Jev is disabled and reports the error', async () => {
    const seen: DecisionError[] = [];
    const p = withLocalFallback(new JevDecisionProvider({ env: {} }), e => seen.push(e));
    const r = await p.decide({ text: 'rain' }, questions);
    expect(r.answers.tool).toBe('weather');
    expect(seen[0].code).toBe('disabled');
  });
});
