// executeTool permission-checks through getSettings(), which reads Electron's
// app.getPath. Without this mock that throws, and the check fails CLOSED —
// so the test failed with "Permission check failed", not an alias bug. The
// fail-closed behaviour is deliberate; the missing mock was the defect.
jest.mock('electron', () => ({
  app: { getPath: () => require('os').tmpdir() },
}));

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
