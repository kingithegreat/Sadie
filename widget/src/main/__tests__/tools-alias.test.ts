import { registerTool, executeTool } from '../tools';

describe('tool alias mapping', () => {
  test('allows calling an aliased tool name', async () => {
    // register a dummy tool under canonical name
    registerTool('nba_query', {
      name: 'nba_query',
      description: 'test',
      category: 'test',
      parameters: { type: 'object', properties: {}, required: [] }
    } as any, async () => ({ success: true, result: { ok: true } } as any));

    const res = await executeTool({ name: 'nba_scores', arguments: {} } as any, { executionId: 'test' } as any);
    expect(res.success).toBe(true);
  });
});
