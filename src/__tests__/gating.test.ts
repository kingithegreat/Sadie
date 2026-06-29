/**
 * Gating tests: tier dimension in ToolRegistry + Automation Center handler gate.
 */
import { ToolRegistry } from '../toolRegistry';
import {
  ensureFeature,
  withFeatureGate,
  isGateBlocked,
} from '../handlers/featureGate';
import {
  guardAutomationChannel,
  gatedAutomationHandler,
  isAutomationChannel,
  capabilityForChannel,
  AUTOMATION_CENTER_CHANNELS,
} from '../handlers/automationCenter';

function makeProTool(name: string, capability: any) {
  return {
    name,
    description: 'pro tool',
    requiredCapability: capability,
    inputSchema: {
      type: 'object',
      properties: { x: { type: 'number' } },
      required: ['x'],
      additionalProperties: false,
    } as const,
    execute: async (input: { x: number }) => ({ doubled: input.x * 2 }),
  };
}

describe('ToolRegistry — Pro tier gate (existing permission model)', () => {
  let reg: ToolRegistry;
  beforeEach(() => {
    reg = new ToolRegistry(['automate', 'echo']);
    reg.register(makeProTool('automate', 'automation'));
    reg.register({
      name: 'echo',
      description: 'free taster tool, no requiredCapability',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      } as const,
      execute: async (i: { message: string }) => ({ echo: i.message }),
    });
  });

  test('free caller is blocked from a pro tool with an upgrade prompt', async () => {
    const r = await reg.execute('automate', { x: 5 }, { tier: 'free' });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Upgrade required');
    expect(r.output).toBeNull();
    expect(r.upgrade?.capability).toBe('automation');
    expect(r.upgrade?.requiredTier).toBe('pro');
  });

  test('missing tier defaults to free → blocked', async () => {
    const r = await reg.execute('automate', { x: 5 });
    expect(r.error).toBe('Upgrade required');
  });

  test('pro caller executes the pro tool', async () => {
    const r = await reg.execute('automate', { x: 5 }, { tier: 'pro' });
    expect(r.success).toBe(true);
    expect((r.output as any).doubled).toBe(10);
    expect(r.upgrade).toBeUndefined();
  });

  test('tier-agnostic (taster) tools are unaffected by tier — backward compat', async () => {
    const free = await reg.execute('echo', { message: 'hi' }, { tier: 'free' });
    expect(free.success).toBe(true);
    expect((free.output as any).echo).toBe('hi');
    const none = await reg.execute('echo', { message: 'hi' });
    expect(none.success).toBe(true);
  });

  test('gate runs before input validation (no leak of pro execution path)', async () => {
    // invalid input, but free tier → still upgrade-required, never validation
    const r = await reg.execute('automate', { x: 'not-a-number' } as any, { tier: 'free' });
    expect(r.error).toBe('Upgrade required');
  });

  test('audit log records the blocked attempt', async () => {
    await reg.execute('automate', { x: 1 }, { tier: 'free' });
    const log = reg.getExecutionLog();
    const last = log[log.length - 1];
    expect((last.output as any).error).toBe('Upgrade required');
    expect((last.output as any).capability).toBe('automation');
  });
});

describe('Automation Center — handler/IPC gate', () => {
  const freeTier = () => 'free' as const;
  const proTier = () => 'pro' as const;

  test('channel registry maps channels to capabilities', () => {
    expect(isAutomationChannel('homebot:automation:scheduler:add')).toBe(true);
    expect(isAutomationChannel('homebot:get-settings')).toBe(false);
    expect(capabilityForChannel('homebot:automation:image:generate')).toBe('imageGen');
    expect(capabilityForChannel('homebot:automation:workflow:create')).toBe('automation');
    expect(Object.keys(AUTOMATION_CENTER_CHANNELS).length).toBeGreaterThanOrEqual(5);
  });

  test('guardAutomationChannel blocks free, allows pro', async () => {
    const blocked = await guardAutomationChannel('homebot:automation:scheduler:add', freeTier);
    expect(blocked).not.toBeNull();
    expect(isGateBlocked(blocked)).toBe(true);
    expect(blocked?.upgrade.capability).toBe('automation');

    const allowed = await guardAutomationChannel('homebot:automation:scheduler:add', proTier);
    expect(allowed).toBeNull();
  });

  test('guardAutomationChannel throws on unknown channel (programmer error)', async () => {
    await expect(guardAutomationChannel('homebot:not-a-channel', proTier)).rejects.toThrow();
  });

  test('gatedAutomationHandler: real handler runs only for pro', async () => {
    let ran = 0;
    const handler = async (_event: unknown, job: { name: string }) => {
      ran++;
      return { ok: true, job };
    };
    const freeWrapped = gatedAutomationHandler('homebot:automation:scheduler:add', freeTier, handler);
    const res1 = await freeWrapped({}, { name: 'daily' });
    expect(isGateBlocked(res1)).toBe(true);
    expect(ran).toBe(0); // real handler never executed for free user

    const proWrapped = gatedAutomationHandler('homebot:automation:scheduler:add', proTier, handler);
    const res2 = await proWrapped({}, { name: 'daily' });
    expect(isGateBlocked(res2)).toBe(false);
    expect((res2 as any).ok).toBe(true);
    expect(ran).toBe(1);
  });

  test('ensureFeature respects a custom upgrade url', async () => {
    const blocked = await ensureFeature(freeTier, 'voice', 'https://buy.example/x');
    expect(blocked?.upgrade.upgradeUrl).toBe('https://buy.example/x');
  });

  test('withFeatureGate is a drop-in wrapper preserving handler signature for pro', async () => {
    const wrapped = withFeatureGate('rag', proTier, async (a: number, b: number) => a + b);
    expect(await wrapped(2, 3)).toBe(5);
  });
});
