import { injectAuthGuards, AUTH_GUARD_JS } from '../n8n-auth-guard';

function makeWorkflow(nodeNames: string[], webhookIndexes: number[] = [0]) {
  const nodes = nodeNames.map((name, i) => ({
    name,
    type: i === 0 && webhookIndexes.includes(0)
      ? 'n8n-nodes-base.webhook'
      : 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [250 + i * 200, 300],
    parameters: { jsCode: `// ${name}` },
  }));
  if (webhookIndexes.includes(0)) {
    (nodes[0] as any).type = 'n8n-nodes-base.webhook';
    (nodes[0] as any).webhookId = 'test-webhook';
  }
  const connections: any = {};
  for (let i = 0; i < nodeNames.length - 1; i++) {
    connections[nodeNames[i]] = { main: [[{ node: nodeNames[i + 1], type: 'main', index: 0 }]] };
  }
  return { name: 'Test WF', nodes, connections, settings: { executionOrder: 'v1' } };
}

describe('injectAuthGuards', () => {
  test('inserts a guard between the webhook and its first downstream node', () => {
    const wf = makeWorkflow(['Webhook', 'Prepare Request', 'Respond']);
    const { wf: out, injected } = injectAuthGuards(wf as any);
    expect(injected).toBe(1);
    expect(out.nodes.some((n: any) => n.name === 'Auth Guard')).toBe(true);
    // Webhook now points at the guard, guard points at the original target.
    expect(out.connections['Webhook'].main[0][0].node).toBe('Auth Guard');
    expect(out.connections['Auth Guard'].main[0][0].node).toBe('Prepare Request');
    // The untouched chain survives intact.
    expect(out.connections['Prepare Request'].main[0][0].node).toBe('Respond');
  });

  test('guard node carries the shared-secret check script', () => {
    const { wf: out } = injectAuthGuards(makeWorkflow(['Webhook', 'Respond']) as any);
    const guard = out.nodes.find((n: any) => n.name === 'Auth Guard') as any;
    expect(guard.parameters.jsCode).toContain('HOMEBOT_WEBHOOK_SECRET');
    expect(guard.parameters.jsCode).toContain("hdrs['x-homebot-auth']");
  });

  test('is idempotent — a second pass injects nothing and keeps one guard', () => {
    const first = injectAuthGuards(makeWorkflow(['Webhook', 'Respond']) as any);
    const second = injectAuthGuards(first.wf as any);
    expect(second.injected).toBe(0);
    expect(second.wf.nodes.filter((n: any) => n.name === 'Auth Guard').length).toBe(1);
  });

  test('recognises an existing guard even when it is named differently', () => {
    const wf = makeWorkflow(['Webhook', 'My Custom Guard', 'Respond']);
    (wf.nodes[1] as any).parameters = { jsCode: AUTH_GUARD_JS };
    const { injected, wf: out } = injectAuthGuards(wf as any);
    expect(injected).toBe(0);
    expect(out.connections['Webhook'].main[0][0].node).toBe('My Custom Guard');
  });

  test('leaves workflows without webhooks untouched', () => {
    const wf = makeWorkflow(['Step A', 'Step B'], []);
    const { injected, wf: out } = injectAuthGuards(wf as any);
    expect(injected).toBe(0);
    expect(out.nodes.length).toBe(wf.nodes.length);
  });

  test('guards each webhook in a multi-trigger workflow', () => {
    const wf: any = {
      name: 'Two Triggers',
      nodes: [
        { name: 'W1', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
        { name: 'W2', type: 'n8n-nodes-base.webhook', position: [0, 200], parameters: {} },
        { name: 'A', type: 'n8n-nodes-base.code', position: [400, 0], parameters: {} },
        { name: 'B', type: 'n8n-nodes-base.code', position: [400, 200], parameters: {} },
      ],
      connections: {
        W1: { main: [[{ node: 'A', type: 'main', index: 0 }]] },
        W2: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
      },
      settings: {},
    };
    const { wf: out, injected } = injectAuthGuards(wf);
    expect(injected).toBe(2);
    expect(out.connections['W1'].main[0][0].node).toBe('Auth Guard');
    expect(out.connections['W2'].main[0][0].node).toBe('Auth Guard 2');
    expect(out.connections['Auth Guard'].main[0][0].node).toBe('A');
    expect(out.connections['Auth Guard 2'].main[0][0].node).toBe('B');
  });

  test('does not mutate the input workflow', () => {
    const wf = makeWorkflow(['Webhook', 'Respond']) as any;
    const before = JSON.stringify(wf);
    injectAuthGuards(wf);
    expect(JSON.stringify(wf)).toBe(before);
  });
});
