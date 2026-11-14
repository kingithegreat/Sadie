/**
 * HomeBot chat wiring for the OpenRouter model router. Mocked fetch only;
 * nothing here can reach the network.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModelRouter, type RouterFetch } from '../../../../src/model-router/client';
import { loadRouterConfig } from '../../../../src/model-router/config';
import { SpendLedger } from '../../../../src/model-router/ledger';
import defaultRouterConfig from '../../../../config/model-router.json';
import { isModelRouterChatEnabled, routeChatThroughModelRouter, runVibeCodeChatTurn, vibeCodeTaskFor } from '../model-router-chat';

function routerWith(env: Record<string, string | undefined>, replies: Array<{ status: number; body: unknown }>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-router-chat-'));
  const config = loadRouterConfig({ env: { ...env, MODEL_ROUTER_LEDGER: path.join(dir, 'ledger.json') }, homeDir: dir, fallback: defaultRouterConfig });
  const calls: any[] = [];
  const fetch: RouterFetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const reply = replies[calls.length - 1];
    if (!reply) throw new Error('unexpected call');
    return { ok: reply.status < 300, status: reply.status, text: async () => JSON.stringify(reply.body) };
  };
  return { router: new ModelRouter({ config, ledger: new SpendLedger(config.ledgerPath, config.monthlyCapUsd), fetch, env }), calls };
}

describe('model router chat wiring', () => {
  it('is off unless the setting or HOMEBOT_MODEL_ROUTER turns it on', () => {
    expect(isModelRouterChatEnabled({}, {})).toBe(false);
    expect(isModelRouterChatEnabled(undefined, {})).toBe(false);
    expect(isModelRouterChatEnabled({ modelRouterEnabled: true }, {})).toBe(true);
    expect(isModelRouterChatEnabled({}, { HOMEBOT_MODEL_ROUTER: '1' })).toBe(true);
  });

  it('/code always triggers vibe-code; detected intent only with the router on and a project set', () => {
    expect(vibeCodeTaskFor('/code fix hello.ts', { routerEnabled: false, explicitProject: false })).toBe('fix hello.ts');
    expect(vibeCodeTaskFor('fix the typo in src/app.ts', { routerEnabled: false, explicitProject: true })).toBeNull();
    expect(vibeCodeTaskFor('fix the typo in src/app.ts', { routerEnabled: true, explicitProject: false })).toBeNull();
    expect(vibeCodeTaskFor('fix the typo in src/app.ts', { routerEnabled: true, explicitProject: true })).toBe('fix the typo in src/app.ts');
    expect(vibeCodeTaskFor('how are you?', { routerEnabled: true, explicitProject: true })).toBeNull();
  });

  it('dry run: chat reply carries the model and a mock cost, and sends nothing', async () => {
    const { router, calls } = routerWith({}, []);
    const turn = await routeChatThroughModelRouter({ message: 'hello', conversationId: 'c1', systemPrompt: 'sys' }, router);
    expect(calls).toHaveLength(0);
    expect(turn.route.dryRun).toBe(true);
    expect(turn.display).toMatch(/Model: qwen\/qwen3\.7-flash \(cheap tier\)/);
    expect(turn.display).toMatch(/mock estimate, dry run/);
  });

  it('live (mocked fetch): chat uses the cheap tier and records the cost', async () => {
    const { router, calls } = routerWith({ MODEL_ROUTER_LIVE: '1', OPENROUTER_API_KEY: 'test-key-not-real' }, [
      { status: 200, body: { model: 'qwen/qwen3.7-flash', choices: [{ message: { content: 'Kia ora!' } }], usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.0001 } } },
    ]);
    const turn = await routeChatThroughModelRouter({ message: 'hello', conversationId: 'c1', history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }] }, router);
    expect(calls[0].models[0]).toBe('qwen/qwen3.7-flash');
    expect(calls[0].messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(turn.display).toMatch(/Kia ora!/);
    expect(router.ledger.read()[0]).toMatchObject({ source: 'chat', costUsd: 0.0001 });
  });

  it('vibe-code without a project asks for one and writes nothing', async () => {
    const { router } = routerWith({}, []);
    const sent: string[] = [];
    const confirm = jest.fn(async () => true);
    const outcome = await runVibeCodeChatTurn({ task: 'fix hello.ts', repoRoot: undefined, router, io: { send: (m) => { sent.push(m); }, confirm } });
    expect(outcome.status).toBe('error');
    expect(confirm).not.toHaveBeenCalled();
    expect(sent.join('')).toMatch(/\/project <path>/);
  });
});
