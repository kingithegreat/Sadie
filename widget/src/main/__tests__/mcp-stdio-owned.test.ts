import { createOwnedMcpStdioTransport } from '../mcp-stdio-owned';
import { createPendingWorkspaceWindowsJob } from '../workspace-windows-job';
import { snapshotWorkspaceLaunch } from '../workspace-process-gate';
import { workspacePtyLifecycle } from '../workspace-pty-identity';

const mockSdkInstances: any[] = [];
const mockSdkBaseStart = jest.fn(async () => {});
const mockSdkBaseClose = jest.fn(async () => {});
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  getDefaultEnvironment: () => ({ PATH: 'frozen-core-path', USERPROFILE: 'private-test-home' }),
  // ONLY the documented public SDK surface is implemented. A private-field
  // access in the product adapter would therefore fail these controls.
  StdioClientTransport: class {
    pid: number | null = 1234;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    stderr = { resume: jest.fn() };
    server: any;
    async start() { await mockSdkBaseStart(); }
    async close() { await mockSdkBaseClose(); this.pid = null; this.onclose?.(); }
    constructor(server: any) { this.server = server; mockSdkInstances.push(this); }
  },
}));
jest.mock('../workspace-windows-job', () => ({ createPendingWorkspaceWindowsJob: jest.fn() }));
jest.mock('../workspace-process-gate', () => ({
  createWorkspaceProcessGate: (env: any) => ({ executable: 'fixed-core.exe', args: ['-e', 'fixed-bootstrap'], env: { ...env, NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '1' }, pipeName: 'private-pipe', capability: 'private-capability' }),
  snapshotWorkspaceLaunch: jest.fn((executable, args, env, options) => ({ executable, args: [...args], env: { ...env }, cwd: options.cwd, adapter: options.adapter })),
}));
jest.mock('../workspace-pty-identity', () => ({ workspacePtyLifecycle: { capture: jest.fn() } }));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const factory = createPendingWorkspaceWindowsJob as jest.Mock;
const capture = workspacePtyLifecycle.capture as jest.Mock;
const originalPlatform = process.platform;
let attached: ReturnType<typeof deferred>;
let job: any;
beforeEach(() => {
  jest.clearAllMocks(); mockSdkInstances.length = 0;
  mockSdkBaseStart.mockReset().mockResolvedValue(undefined); mockSdkBaseClose.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(process, 'platform', { value: 'win32' });
  attached = deferred();
  job = { listening: Promise.resolve(), ready: Promise.resolve(), attach: jest.fn(async () => { attached.resolve(); }),
    authorize: jest.fn(async (_launch, validate) => { validate(); return 2345; }),
    queryEmpty: jest.fn(async () => false), stop: jest.fn(async () => {}) };
  factory.mockReturnValue(job);
  capture.mockResolvedValue({ creation: '639269323374710690', parent: process.pid });
});
afterEach(() => { Object.defineProperty(process, 'platform', { value: originalPlatform }); });

test('retained ownership is synchronous; target snapshots keep SDK env/cwd/args and require ordinary service cross-spawn', async () => {
  const config = { command: 'tool.cmd', args: ['space & quoted value'], env: { API_KEY: 'fixture-only-secret', NODE_OPTIONS: 'target-option' }, cwd: process.cwd(), stderr: 'pipe' as const };
  const owner = createOwnedMcpStdioTransport(config);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(owner.cleanupScope).toBe('windows-job');
  config.args[0] = 'changed'; config.env.API_KEY = 'changed';
  const sdk = mockSdkInstances[0];
  expect(sdk.server.command).toBe('fixed-core.exe');
  expect(sdk.server.env.API_KEY).toBeUndefined();
  expect(sdk.server.env.NODE_OPTIONS).toBe('');
  expect(sdk.server.stderr).toBe('pipe');
  await owner.transport.start();
  expect(job.attach).toHaveBeenCalledWith(1234, { creation: '639269323374710690', parent: process.pid });
  expect(job.authorize.mock.calls[0][0]).toMatchObject({ executable: 'tool.cmd', args: ['space & quoted value'], env: { PATH: 'frozen-core-path', API_KEY: 'fixture-only-secret', NODE_OPTIONS: 'target-option' }, adapter: 'cross-spawn' });
  expect(job.authorize.mock.calls[0][0].kind).toBeUndefined();
  expect(snapshotWorkspaceLaunch).toHaveBeenCalledWith('tool.cmd', ['space & quoted value'], expect.any(Object), { cwd: process.cwd(), adapter: 'cross-spawn' });
  await owner.close();
});

test('pending listening Stop cannot spawn SDK child or authorize configured code', async () => {
  const listening = deferred(); job.listening = listening.promise;
  const owner = createOwnedMcpStdioTransport({ command: 'server' });
  const starting = owner.transport.start();
  const rejected = expect(starting).rejects.toThrow('cancelled');
  await owner.close(); listening.resolve(); await rejected;
  expect(mockSdkBaseStart).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled(); expect(job.authorize).not.toHaveBeenCalled();
});

test('Stop during pending Job readiness prevents configured execution and joins the same retained Job', async () => {
  const ready = deferred(); job.ready = ready.promise;
  const owner = createOwnedMcpStdioTransport({ command: 'server' });
  const starting = owner.transport.start();
  const rejected = expect(starting).rejects.toThrow('cancelled');
  await attached.promise; await owner.close(); ready.resolve(); await rejected;
  expect(job.authorize).not.toHaveBeenCalled(); expect(job.stop).toHaveBeenCalledTimes(1);
});

test('global/per-server cancellation is checked again at final GO after an awaited membership check', async () => {
  const abort = new AbortController(), authorizing = deferred(), membership = deferred();
  const go = jest.fn();
  job.authorize.mockImplementation(async (_launch: unknown, validate: () => void) => { authorizing.resolve(); await membership.promise; validate(); go(); return 2345; });
  const owner = createOwnedMcpStdioTransport({ command: 'server' }, { signal: abort.signal });
  const starting = owner.transport.start(), rejected = expect(starting).rejects.toThrow('cancelled');
  await authorizing.promise; abort.abort(); membership.resolve(); await rejected;
  expect(go).not.toHaveBeenCalled(); expect(job.stop).toHaveBeenCalled();
});

test('failed native identity never authorizes code, and startup SDK cleanup still runs when Job stop rejects', async () => {
  capture.mockResolvedValue(undefined); job.stop.mockRejectedValue(new Error('held helper unavailable'));
  const owner = createOwnedMcpStdioTransport({ command: 'server' });
  await expect(owner.transport.start()).rejects.toThrow('cleanup remains pending');
  expect(job.attach).not.toHaveBeenCalled(); expect(job.authorize).not.toHaveBeenCalled();
  expect(mockSdkInstances[0].pid).toBeNull(); expect(job.stop).toHaveBeenCalledTimes(1);
  job.stop.mockResolvedValue(undefined); await owner.close(); expect(job.stop).toHaveBeenCalledTimes(2);
});

test('closed RPC wrapper with remaining Job descendants still has retained retryable cleanup', async () => {
  const owner = createOwnedMcpStdioTransport({ command: 'server' }); await owner.transport.start();
  // Mirrors Protocol clearing its own transport after public onclose. The owner
  // remains reachable independently; no query/snapshot is mistaken for Stop.
  mockSdkInstances[0].onclose?.();
  job.stop.mockRejectedValueOnce(new Error('Job still has inherited members'));
  await expect(owner.close()).rejects.toThrow('inherited members');
  await owner.close(); await owner.close();
  expect(factory).toHaveBeenCalledTimes(1); expect(job.stop).toHaveBeenCalledTimes(2);
});

test('SDK close failure does not skip retained Job stop and retries public SDK cleanup', async () => {
  const owner = createOwnedMcpStdioTransport({ command: 'server' }); await owner.transport.start();
  mockSdkBaseClose.mockRejectedValueOnce(new Error('SDK close failure'));
  await expect(owner.close()).rejects.toThrow('SDK close failure');
  expect(job.stop).toHaveBeenCalledTimes(1);
  await owner.close();
  expect(job.stop).toHaveBeenCalledTimes(2); expect(mockSdkBaseClose).toHaveBeenCalledTimes(2);
});

test('a stale root generation refuses before spawn and does not expose server credentials to helpers', async () => {
  const owner = createOwnedMcpStdioTransport({ command: 'server', env: { API_KEY: 'fixture-only-secret' } }, { assertCurrent: () => { throw new Error('stale generation'); } });
  await expect(owner.transport.start()).rejects.toThrow('stale generation');
  expect(capture).not.toHaveBeenCalled(); expect(job.authorize).not.toHaveBeenCalled();
  expect(factory.mock.calls[0][0].env.API_KEY).toBeUndefined();
});

test('POSIX preserves SDK direct-child scope without claiming inherited Job cleanup', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  const owner = createOwnedMcpStdioTransport({ command: 'server', args: ['original'] });
  expect(owner.cleanupScope).toBe('sdk-direct-child'); expect(factory).not.toHaveBeenCalled();
  await owner.transport.start(); await owner.close();
  expect(mockSdkInstances[0].server.command).toBe('server');
});

test('POSIX per-server cancellation still prevents public SDK startup without a tree guarantee', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  const abort = new AbortController();
  const owner = createOwnedMcpStdioTransport({ command: 'server' }, { signal: abort.signal });
  abort.abort(); await expect(owner.transport.start()).rejects.toThrow('cancelled');
  expect(mockSdkBaseStart).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled();
});
