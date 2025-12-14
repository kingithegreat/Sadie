import { executeToolBatch } from '../tools';
import { ToolCall } from '../tools/types';
import * as config from '../config-manager';

describe('executeToolBatch', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  test('denies batch if any tool permission missing', async () => {
    // Deny write_file, allow create_directory
    jest.spyOn(config, 'assertPermission').mockImplementation((name: string) => name === 'write_file' ? false : true as any);

    const calls: ToolCall[] = [
      { name: 'create_directory', arguments: { path: 'Desktop/Test' } },
      { name: 'write_file', arguments: { path: 'Desktop/Test/report.txt', content: 'hi' } }
    ];

    const res = await executeToolBatch(calls as any, {} as any);
    expect(res.length).toBe(1);
    expect(res[0].success).toBe(false);
    expect(res[0].status).toBe('needs_confirmation');
    expect(res[0].missingPermissions).toContain('write_file');
  });

  test('honors tool.requiredPermissions during precheck', async () => {
    const { registerTool, executeToolBatch } = require('../tools');
    // Register a dummy tool that declares it needs `write_file`
    registerTool('dummy_report', { name: 'dummy_report', description: 'dummy', parameters: { type: 'object', properties: {}, required: [] }, requiredPermissions: ['write_file'] } as any, async () => ({ success: true }));

    // Deny write_file
    jest.spyOn(config, 'assertPermission').mockImplementation((name: string) => name === 'write_file' ? false : true as any);

    const calls: ToolCall[] = [ { name: 'dummy_report', arguments: {} } as any ];
    const res = await executeToolBatch(calls as any, {} as any);
    expect(res.length).toBe(1);
    expect((res[0] as any).status).toBe('needs_confirmation');
    expect((res[0] as any).missingPermissions).toContain('write_file');
  });
});
