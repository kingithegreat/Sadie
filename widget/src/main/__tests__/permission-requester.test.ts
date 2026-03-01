/**
 * Permission Requester Tests
 *
 * Tests the permissionRequester module's request() method, covering:
 *  - cancel resolution when sender.send throws (e.g., destroyed webContents)
 *  - timeout-based cancel when no renderer response arrives
 *  - successful allow_once / always_allow resolution via the ipcMain listener
 */

// Mock electron BEFORE importing any module that requires it at load time
jest.mock('electron', () => ({
  ipcMain: {
    on: jest.fn(),
  },
}));

// We use fake timers to control the 60 s timeout without waiting
jest.useFakeTimers();

import { permissionRequester } from '../permission-requester';

// Capture the ipcMain listener registered at module load time.
// Must happen in beforeAll — BEFORE jest.clearAllMocks() in afterEach wipes mock.calls.
let ipcPermissionListener: Function | null = null;

beforeAll(() => {
  const { ipcMain } = require('electron') as any;
  const call = (ipcMain.on as jest.Mock).mock.calls.find(
    ([ch]: [string]) => ch === 'sadie:permission-response'
  );
  ipcPermissionListener = call ? call[1] : null;
});

describe('permissionRequester.request()', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  // -------------------------------------------------------------------------
  test('resolves with "cancel" when sender.send() throws synchronously', async () => {
    const brokenSender = {
      send: jest.fn().mockImplementation(() => {
        throw new Error('Renderer process is gone');
      }),
    } as any;

    const result = await permissionRequester.request(
      brokenSender,
      'stream-broken',
      ['write_file'],
      'Testing broken sender'
    );

    expect(result.decision).toBe('cancel');
    expect(brokenSender.send).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  test('resolves with "cancel" after 60 s timeout', async () => {
    const sender = { send: jest.fn() } as any;

    const promise = permissionRequester.request(
      sender,
      'stream-timeout',
      ['delete_file'],
      'Testing timeout'
    );

    // Advance past the 60-second timeout
    jest.advanceTimersByTime(61_000);

    const result = await promise;
    expect(result.decision).toBe('cancel');
  });

  // -------------------------------------------------------------------------
  test('sender receives a permission-request IPC message with correct shape', async () => {
    const sender = { send: jest.fn() } as any;

    const promise = permissionRequester.request(
      sender,
      'stream-shape',
      ['read_file', 'write_file'],
      'Need two permissions'
    );

    // Cancel immediately so the test doesn't hang
    jest.advanceTimersByTime(61_000);
    await promise;

    expect(sender.send).toHaveBeenCalledWith(
      'sadie:permission-request',
      expect.objectContaining({
        requestId: expect.stringMatching(/^perm-/),
        missingPermissions: ['read_file', 'write_file'],
        reason: 'Need two permissions',
        streamId: 'stream-shape',
      })
    );
  });

  // -------------------------------------------------------------------------
  test('resolves with allow_once when ipcMain listener fires matching response', async () => {
    const sender = { send: jest.fn() } as any;

    const promise = permissionRequester.request(
      sender,
      'stream-allow',
      ['web_search'],
      'User wants web search'
    );

    // Extract the requestId that was sent to the renderer
    await Promise.resolve(); // let microtasks flush so send() was called
    const [[, payload]] = sender.send.mock.calls as [[string, { requestId: string }]];
    const { requestId } = payload;

    // Simulate the renderer replying via the ipcMain listener
    expect(ipcPermissionListener).not.toBeNull();
    ipcPermissionListener!(
      {} /* IpcMainEvent mock */,
      { requestId, decision: 'allow_once' }
    );

    const result = await promise;
    expect(result.decision).toBe('allow_once');
    expect(result.requestId).toBe(requestId);
  });

  // -------------------------------------------------------------------------
  test('resolves with always_allow when renderer sends always_allow decision', async () => {
    const sender = { send: jest.fn() } as any;

    const promise = permissionRequester.request(
      sender,
      'stream-always',
      ['launch_app'],
      'Allow permanently'
    );

    await Promise.resolve();
    const [[, payload]] = sender.send.mock.calls as [[string, { requestId: string }]];
    const { requestId } = payload;

    const listener = ipcPermissionListener;
    listener!(
      {},
      { requestId, decision: 'always_allow' }
    );

    const result = await promise;
    expect(result.decision).toBe('always_allow');
  });

  // -------------------------------------------------------------------------
  test('ignores responses with a mismatched requestId', async () => {
    const sender = { send: jest.fn() } as any;

    const promise = permissionRequester.request(
      sender,
      'stream-mismatch',
      ['read_file'],
      'Mismatch test'
    );

    await Promise.resolve();

    // Fire with the wrong requestId — should not resolve the promise
    ipcPermissionListener!({}, { requestId: 'wrong-id', decision: 'allow_once' });

    // Promise should still be pending; advance timer to get cancel
    jest.advanceTimersByTime(61_000);
    const result = await promise;
    // Should have timed out with cancel, not resolved with allow_once
    expect(result.decision).toBe('cancel');
  });
});
