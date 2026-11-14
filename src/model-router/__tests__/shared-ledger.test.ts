import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRouter, routeChatTurn } from '../chat-route';
import { REPO_DEFAULT_CONFIG_PATH } from '../config';
import { SpendCapExceededError } from '../ledger';
import { LIVE_ENV, completion, forbidRealFetch, mockFetch, tempDir } from './helpers';

forbidRealFetch();

/** Chat and the coder each build their own router the way the app and CLI do. */
function routers(home: string, replies: Parameters<typeof mockFetch>[0], env: Record<string, string> = LIVE_ENV) {
  const shared = path.join(home, '.homebot', 'model-router', 'config.json');
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(REPO_DEFAULT_CONFIG_PATH, 'utf8'));
  cfg.monthlyCapUsd = 1;
  fs.writeFileSync(shared, JSON.stringify(cfg));
  const mock = mockFetch(replies);
  const now = () => new Date('2026-11-10T06:00:00Z');
  const chat = createRouter({ env, homeDir: home, fetch: mock.fetch, now, fallback: cfg });
  const coder = createRouter({ env, homeDir: home, fetch: mock.fetch, now });
  return { chat, coder, calls: mock.calls };
}

describe('chat and coder share one ledger and one cap', () => {
  it('resolve to the same ledger file and cap', () => {
    const home = tempDir();
    const { chat, coder } = routers(home, []);
    expect(chat.ledger.filePath).toBe(coder.ledger.filePath);
    expect(chat.ledger.filePath).toBe(path.join(home, '.homebot', 'model-router', 'ledger.json'));
    expect(chat.ledger.capUsd).toBe(1);
    expect(coder.ledger.capUsd).toBe(1);
  });

  it('coder spend counts against chat, and the cap stops both', async () => {
    const home = tempDir();
    const { chat, coder, calls } = routers(home, [completion('patch', { cost: 0.7 }), completion('hi there', { cost: 0.4 })]);
    await coder.complete({ task: 'fix typo', files: 1, diffLines: 1, source: 'coder' });
    const turn = await routeChatTurn(chat, { message: 'hello', conversationId: 'c1' });
    expect(turn.display).toMatch(/hi there/);
    expect(turn.display).toMatch(/Model: qwen\/qwen3\.7-flash \(cheap tier\) · Cost: \$0\.4000/);
    expect(coder.ledger.read().map(e => e.source)).toEqual(['coder', 'chat']);
    await expect(routeChatTurn(chat, { message: 'again', conversationId: 'c1' })).rejects.toThrow(SpendCapExceededError);
    await expect(coder.complete({ task: 'fix typo', files: 1, diffLines: 1 })).rejects.toThrow(SpendCapExceededError);
    expect(calls).toHaveLength(2);
  });

  it('chat turns default to cheap, cap hard topics at mid, and keep one session per conversation', async () => {
    const home = tempDir();
    const { chat, calls } = routers(home, () => completion('ok', { cost: 0.001 }));
    await routeChatTurn(chat, { message: 'what should I cook tonight?', conversationId: 'conv-9', systemPrompt: 'You are HomeBot.' });
    await routeChatTurn(chat, { message: 'explain the security model of OAuth', conversationId: 'conv-9' });
    expect(calls.map(c => c.body.models[0])).toEqual(['qwen/qwen3.7-flash', 'anthropic/claude-sonnet-5.5']);
    expect(calls[0].body.session_id).toBe(calls[1].body.session_id);
    expect(calls[0].body.messages[0]).toEqual({ role: 'system', content: 'You are HomeBot.' });
  });

  it('chat escalates on failure using the same rules', async () => {
    const home = tempDir();
    const { chat, calls } = routers(home, [{ status: 503, body: 'down' }, completion('recovered', { model: 'anthropic/claude-sonnet-5.5', cost: 0.01 })]);
    const turn = await routeChatTurn(chat, { message: 'hello', conversationId: 'c2' });
    expect(calls.map(c => c.body.models[0])).toEqual(['qwen/qwen3.7-flash', 'anthropic/claude-sonnet-5.5']);
    expect(turn.route.tier).toBe('mid');
  });

  it('chat in dry run labels the cost as mock and sends nothing', async () => {
    const home = tempDir();
    const { chat, calls } = routers(home, [], {} as Record<string, string>);
    const turn = await routeChatTurn(chat, { message: 'hello', conversationId: 'c3' });
    expect(calls).toHaveLength(0);
    expect(turn.display).toMatch(/mock estimate, dry run/);
  });
});
