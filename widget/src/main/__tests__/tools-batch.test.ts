import { executeToolBatch, registerTool } from '../tools';

import * as config from '../config-manager';

describe('executeToolBatch', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  test('denies batch if any tool permission missing', async () => {
    // Deny write_file, allow create_directory
    jest.spyOn(config, 'assertPermission').mockImplementation((name) => (name === 'write_file' ? false : true));

    const calls = [
      { name: 'create_directory', arguments: { path: 'Desktop/Test' } },
      { name: 'write_file', arguments: { path: 'Desktop/Test/report.txt', content: 'hi' } }
    ];

    const res = await executeToolBatch(calls, { executionId: 'test' } as any);
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
    jest.spyOn(config, 'assertPermission').mockImplementation((name) => (name === 'write_file' ? false : true));

    const calls = [ { name: 'dummy_report', arguments: {} } as any ];
    const res = await executeToolBatch(calls, { executionId: 'test' } as any);
    expect(res.length).toBe(1);
    expect((res[0] as any).status).toBe('needs_confirmation');
    expect((res[0] as any).missingPermissions).toContain('write_file');
  });

  test('Stop during one tool prevents the next queued tool from starting', async () => {
    jest.spyOn(config, 'assertPermission').mockReturnValue(true);
    const controller = new AbortController();
    let release!: () => void;
    let started!: () => void;
    const firstStarted = new Promise<void>(resolve => { started = resolve; });
    const first = jest.fn(async () => {
      started();
      await new Promise<void>(resolve => { release = resolve; });
      return { success: true };
    });
    const second = jest.fn(async () => ({ success: true }));
    const definition = (name: string) => ({ name, description: 'Chat Stop fixture', parameters: { type: 'object', properties: {} } });
    registerTool('chat_stop_first', definition('chat_stop_first') as any, first);
    registerTool('chat_stop_second', definition('chat_stop_second') as any, second);
    const pending = executeToolBatch([{ name: 'chat_stop_first', arguments: {} }, { name: 'chat_stop_second', arguments: {} }],
      { executionId: 'stop-test' }, { signal: controller.signal });
    try {
      await firstStarted;
      controller.abort();
    } finally { release(); }
    await pending;
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  test.each([false, true])('Stop while confirmation is pending prevents execution (allow once=%s)', async (override) => {
    jest.spyOn(config, 'assertPermission').mockReturnValue(true);
    jest.spyOn(config, 'hasStandingConsent').mockReturnValue(false);
    const controller = new AbortController();
    const handler = jest.fn(async () => ({ success: true }));
    const name = override ? 'chat_stop_override' : 'chat_stop_confirm';
    registerTool(name, { name, description: 'Chat confirmation fixture', requiresConfirmation: true,
      parameters: { type: 'object', properties: {} } } as any, handler);
    let release!: (confirmed: boolean) => void;
    let started!: () => void;
    const asked = new Promise<void>(resolve => { started = resolve; });
    const pending = executeToolBatch([{ name, arguments: {} }], { executionId: name,
      requestConfirmation: () => { started(); return new Promise<boolean>(resolve => { release = resolve; }); } },
    { signal: controller.signal, ...(override ? { overrideAllowed: [name] } : {}) });
    try { await asked; controller.abort(); }
    finally { release(true); }
    await pending;
    expect(handler).not.toHaveBeenCalled();
  });

  test('an already stopped batch never executes a handler', async () => {
    jest.spyOn(config, 'assertPermission').mockReturnValue(true);
    const handler = jest.fn(async () => ({ success: true }));
    registerTool('chat_stopped', { name: 'chat_stopped', description: 'Stopped fixture', parameters: { type: 'object', properties: {} } } as any, handler);
    const controller = new AbortController();
    controller.abort();
    const result = await executeToolBatch([{ name: 'chat_stopped', arguments: {} }], { executionId: 'stopped' }, { signal: controller.signal });
    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual([{ success: false, error: 'Operation cancelled by user' }]);
  });
});
