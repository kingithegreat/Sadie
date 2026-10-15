import { execFile } from 'child_process';
import { queryWorkspacePtyIdentity, workspacePtyLifecycle, type WorkspacePtyIdentityDiagnostic } from '../workspace-pty-identity';
jest.mock('child_process', () => ({ execFile: jest.fn() }));
function reply(output: string, error: Record<string, unknown> | null = null) {
  jest.mocked(execFile).mockImplementation((...args: any[]) => {
    args[3](error, output, 'PRIVATE_STDERR_CAP_ENV_ARG');
    return {} as ReturnType<typeof execFile>;
  });
}
beforeEach(() => jest.mocked(execFile).mockReset());
test('fixed identity observations distinguish absent, malformed, observed and failed queries without changing results', async () => {
  const cases = [
    { output: 'missing', error: null, expected: null, status: 'missing' },
    { output: 'PRIVATE_STDOUT_CAP_ENV_ARG', error: null, expected: undefined, status: 'malformed' },
    { output: `639269693422023150:${process.pid}`, error: null, expected: { creation: '639269693422023150', parent: process.pid }, status: 'observed' },
    { output: 'missing', error: { code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM', message: 'PRIVATE_RAW_ERROR' }, expected: undefined, status: 'query-error' },
  ];
  for (const item of cases) {
    reply(item.output, item.error); const observe = jest.fn();
    expect(await queryWorkspacePtyIdentity(45, observe)).toEqual(item.expected);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0][0]).toMatchObject({ status: item.status });
    expect(observe.mock.calls[0][0].elapsedMs).toBeGreaterThanOrEqual(0);
    expect(observe.mock.calls[0][0].elapsedMs).toBeLessThanOrEqual(60_000);
    expect(JSON.stringify(observe.mock.calls)).not.toContain('PRIVATE');
    expect(await queryWorkspacePtyIdentity(45)).toEqual(item.expected);
    expect(execFile).toHaveBeenLastCalledWith('powershell.exe', expect.any(Array), { windowsHide: true, timeout: 1800, maxBuffer: 1024 }, expect.any(Function));
  }
});
test('only allowlisted error codes and finite primitive exit metadata enter diagnostics', async () => {
  reply('', { code: 'PRIVATE_CODE', signal: 'PRIVATE_SIGNAL', killed: 'PRIVATE_KILLED', message: 'PRIVATE_RAW' });
  const observe = jest.fn(); await queryWorkspacePtyIdentity(45, observe);
  expect(observe.mock.calls[0][0]).toMatchObject({ status: 'query-error', errorCode: 'unknown', signal: 'unknown' });
  expect(observe.mock.calls[0][0].killed).toBeUndefined();
  expect(JSON.stringify(observe.mock.calls)).not.toContain('PRIVATE');
  reply('', { code: 7, killed: false }); await queryWorkspacePtyIdentity(45, observe);
  expect(observe.mock.calls[1][0]).toMatchObject({ exitCode: 7, killed: false });
  reply('', { code: Infinity }); await queryWorkspacePtyIdentity(45, observe);
  expect(observe.mock.calls[2][0].exitCode).toBeUndefined();
});
test('observer throwing or returning an identity cannot alter missing or unknown query authority', async () => {
  reply('missing'); expect(await queryWorkspacePtyIdentity(45, () => { throw new Error('diagnostic failure'); })).toBeNull();
  reply('invalid'); expect(await queryWorkspacePtyIdentity(45, () => ({ creation: '639269693422023150', parent: process.pid }))).toBeUndefined();
  expect(execFile).toHaveBeenCalledTimes(2);
});
test('invalid PID observations never spawn a query or infer ownership', async () => {
  for (const pid of [0, -1, 1.5, Infinity, NaN]) {
    const observe = jest.fn(); expect(await queryWorkspacePtyIdentity(pid, observe)).toBeUndefined();
    expect(observe).toHaveBeenCalledWith({ status: 'invalid-pid', elapsedMs: expect.any(Number) });
  }
  expect(execFile).not.toHaveBeenCalled();
});
(process.platform === 'win32' ? test : test.skip)('capture reports foreign parent without disclosing birth or changing direct-child authority', async () => {
  reply('639269693422023150:1'); const observations: WorkspacePtyIdentityDiagnostic[] = [];
  expect(await workspacePtyLifecycle.capture(45, item => { observations.push(item); })).toBeUndefined();
  expect(observations).toHaveLength(1); expect(observations[0]).toMatchObject({ status: 'foreign-parent' });
  expect(JSON.stringify(observations)).not.toContain('639269693422023150');
  expect(await workspacePtyLifecycle.capture(45, () => ({ creation: '639269693422023150', parent: process.pid }))).toBeUndefined();
  reply(`639269693422023150:${process.pid}`);
  expect(await workspacePtyLifecycle.capture(45, () => { throw new Error('ignored observer'); })).toEqual({ creation: '639269693422023150', parent: process.pid });
});
