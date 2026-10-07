import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { createPendingWorkspaceWindowsJob, createWorkspaceWindowsJob } from '../workspace-windows-job';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const spawnMock = spawn as unknown as jest.Mock;
const identity = { creation: '639269357577651780', parent: 44 };

function helper() {
  const child = new EventEmitter() as EventEmitter & { stdin: EventEmitter & { write: jest.Mock }; stdout: EventEmitter; stderr: EventEmitter };
  child.stdin = Object.assign(new EventEmitter(), { write: jest.fn((_line, callback) => { callback?.(); return true; }) });
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  spawnMock.mockReturnValue(child);
  const send = (value: object) => child.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  const requests = () => child.stdin.write.mock.calls.map(call => JSON.parse(call[0])).filter(value => value.id);
  const reply = (value: object) => send({ type: 'result', id: requests().at(-1).id, ...value });
  return { child, send, requests, reply };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe('creation-gated Windows Job ownership', () => {
  const oldSystemRoot = process.env.SystemRoot;
  beforeEach(() => { process.env.SystemRoot = 'C:\\Windows'; jest.useFakeTimers(); spawnMock.mockReset(); });
  afterEach(() => { if (oldSystemRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = oldSystemRoot; jest.clearAllTimers(); jest.useRealTimers(); });

  it('returns ownership before helper listening and resolves ready only after assignment', async () => {
    const fake = helper(); const job = createWorkspaceWindowsJob(90, identity);
    let ready = false; void job.ready.then(() => { ready = true; });
    expect(fake.requests()).toHaveLength(0);
    fake.send({ type: 'listening' }); await settle();
    expect(fake.requests()).toEqual([{ id: 1, operation: 'attach', pid: 90, creation: identity.creation }]);
    expect(ready).toBe(false);
    fake.reply({ ok: true }); await job.ready; expect(ready).toBe(true);
  });

  it('reports cold compile at the unchanged startup deadline without treating a phase as readiness', async () => {
    const fake = helper(); const job = createPendingWorkspaceWindowsJob();
    let ready = false; void job.ready.then(() => { ready = true; }, () => {});
    fake.send({ type: 'phase', phase: 'compile', empty: true }); await settle();
    expect(ready).toBe(false); expect(fake.requests()).toHaveLength(0);
    const rejected = expect(job.listening).rejects.toThrow('Helper phase: compile');
    jest.advanceTimersByTime(4500); await rejected;
    fake.child.emit('close', 0); await expect(job.stop()).rejects.toThrow('lost');
  });

  it.each(['encoding', 'encoding-constructed', 'encoding-set', 'utility-import', 'utility-imported'])('keeps %s observations diagnostic-only at the original listener deadline', async phase => {
    const fake = helper(); const job = createPendingWorkspaceWindowsJob();
    let listening = false; void job.listening.then(() => { listening = true; }, () => {});
    fake.send({ type: 'phase', phase, empty: true, ok: true }); await settle();
    expect(listening).toBe(false); expect(fake.requests()).toHaveLength(0);
    const rejected = expect(job.listening).rejects.toThrow(`Helper phase: ${phase}`);
    jest.advanceTimersByTime(4499); await settle(); expect(listening).toBe(false);
    jest.advanceTimersByTime(1); await rejected;
    fake.child.emit('close', 0); await expect(job.stop()).rejects.toThrow('lost');
  });

  it('keeps fixed helper errors diagnostic-only and requires a real zero response even after a stop phase', async () => {
    const fake = helper(); const job = createWorkspaceWindowsJob(90, identity);
    fake.send({ type: 'listening' }); await settle(); fake.reply({ ok: true }); await job.ready;
    const stopped = job.stop(); await settle();
    fake.send({ type: 'phase', phase: 'stop', code: 'query', empty: true, ok: true });
    fake.send({ type: 'phase', phase: 'command' });
    const rejected = expect(stopped).rejects.toThrow('Last fixed helper error: stop/query');
    jest.advanceTimersByTime(4500); await rejected;
    fake.child.emit('close', 0); await expect(job.stop()).rejects.toThrow('lost');
  });

  it('rejects non-allowlisted diagnostic text without reflecting it into user errors', async () => {
    const fake = helper(); const job = createPendingWorkspaceWindowsJob();
    fake.send({ type: 'phase', phase: 'compile', code: 'private-command-canary' });
    await expect(job.listening).rejects.toThrow('unknown state evidence');
    await expect(job.ready).rejects.not.toThrow('private-command-canary');
    fake.child.emit('close', 0);
  });

  it('fails closed when the system Utility import exits without a listener or cleanup receipt', async () => {
    const fake = helper(); const job = createPendingWorkspaceWindowsJob();
    fake.send({ type: 'phase', phase: 'utility-import' }); fake.child.emit('close', 1);
    await expect(job.listening).rejects.toThrow('closed without verified cleanup');
    await expect(job.ready).rejects.toThrow('closed without verified cleanup');
    await expect(job.stop()).rejects.toThrow('lost');
    expect(fake.requests()).toHaveLength(0); expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('keeps cleanup authority after failed assignment and never authorizes a launch', async () => {
    const fake = helper(); const job = createPendingWorkspaceWindowsJob();
    fake.send({ type: 'listening' }); const attached = job.attach(90, identity); await settle();
    fake.reply({ ok: false }); await expect(attached).rejects.toThrow('assignment');
    await expect(job.ready).rejects.toThrow('assignment');
    const stopped = job.stop(); await settle(); fake.reply({ ok: true, empty: true }); fake.child.emit('close', 0);
    await stopped; expect(fake.requests().map(value => value.operation)).toEqual(['attach', 'stop']);
  });

  it('requires successful accounting rather than interpreting unknown state as empty', async () => {
    const fake = helper(); const job = createWorkspaceWindowsJob(90, identity);
    fake.send({ type: 'listening' }); await settle(); fake.reply({ ok: true }); await job.ready;
    const query = job.queryEmpty(); await settle(); fake.reply({ ok: false });
    await expect(query).rejects.toThrow('unverified');
    const second = job.queryEmpty(); await settle(); fake.reply({ ok: true, empty: false }); expect(await second).toBe(false);
  });

  it('joins helper close after zero accounting and tolerates close in the same callback turn', async () => {
    const fake = helper(); const job = createWorkspaceWindowsJob(90, identity);
    fake.send({ type: 'listening' }); await settle(); fake.reply({ ok: true }); await job.ready;
    let finished = false; const stopped = job.stop().then(() => { finished = true; }); await settle();
    fake.reply({ ok: true, empty: true }); await settle(); expect(finished).toBe(false);
    fake.child.emit('close', 0); await stopped; expect(finished).toBe(true);
    await job.stop(); expect(fake.requests().filter(value => value.operation === 'stop')).toHaveLength(1);
  });

  it('retries uncertain Stop on the same helper and does not spawn or reconstruct a PID', async () => {
    const fake = helper(); const job = createWorkspaceWindowsJob(90, identity);
    fake.send({ type: 'listening' }); await settle(); fake.reply({ ok: true }); await job.ready;
    const first = job.stop(); await settle(); fake.reply({ ok: true, empty: false }); await expect(first).rejects.toThrow('Retry');
    const second = job.stop(); await settle(); fake.reply({ ok: true, empty: true }); fake.child.emit('close', 0); await second;
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(fake.requests().map(value => value.operation)).toEqual(['attach', 'stop', 'stop']);
  });

  it('retains a late zero receipt after request timeout so later Close can join actual helper exit', async () => {
    const fake = helper(); const job = createWorkspaceWindowsJob(90, identity);
    fake.send({ type: 'listening' }); await settle(); fake.reply({ ok: true }); await job.ready;
    const first = job.stop(); await settle(); jest.advanceTimersByTime(4500);
    await expect(first).rejects.toThrow('in time');
    fake.reply({ ok: true, empty: true }); fake.child.emit('close', 0); await job.stop();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('does not infer cleanup from an unexpected helper exit or a read-only empty query', async () => {
    const fake = helper(); const job = createWorkspaceWindowsJob(90, identity);
    fake.send({ type: 'listening' }); await settle(); fake.reply({ ok: true }); await job.ready;
    const query = job.queryEmpty(); await settle(); fake.reply({ ok: true, empty: true }); expect(await query).toBe(true);
    fake.child.emit('close', 0); await expect(job.stop()).rejects.toThrow('lost');
  });

  it('requires graceful owned helper exit even after its zero-member receipt', async () => {
    const fake = helper(); const job = createWorkspaceWindowsJob(90, identity);
    fake.send({ type: 'listening' }); await settle(); fake.reply({ ok: true }); await job.ready;
    const stopped = job.stop(); await settle(); fake.reply({ ok: true, empty: true }); fake.child.emit('close', 1);
    await expect(stopped).rejects.toThrow('unexpectedly');
  });

  it('rejects invalid native birth and duplicate attach without releasing ready', async () => {
    const fake = helper(); const job = createPendingWorkspaceWindowsJob(); fake.send({ type: 'listening' });
    await expect(job.attach(90, { ...identity, creation: '0' })).rejects.toThrow('positive');
    await expect(job.ready).rejects.toThrow('positive'); expect(fake.requests()).toHaveLength(0);
  });

  it('bounds and fails malformed helper output without accepting forged zero evidence', async () => {
    const fake = helper(); const job = createWorkspaceWindowsJob(90, identity);
    fake.send({ type: 'listening' }); await settle(); fake.reply({ ok: true }); await job.ready;
    fake.send({ type: 'result', id: 999, ok: true, empty: true }); fake.child.emit('close', 0);
    await expect(job.stop()).rejects.toThrow('lost');
  });

  it('keeps launch capability and environment out of helper argv and responses', async () => {
    const fake = helper(); const capability = 'a'.repeat(64);
    const job = createPendingWorkspaceWindowsJob({ gate: { pipeName: 'hbi-00000000-0000-0000-0000-000000000001', capability } });
    expect(spawnMock.mock.calls[0][0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(JSON.stringify(spawnMock.mock.calls[0][1])).not.toContain(capability);
    fake.send({ type: 'listening' }); const attached = job.attach(90, identity); await settle(); fake.reply({ ok: true }); await attached;
    const started = job.authorize({ executable: 'C:\\Windows\\System32\\cmd.exe', args: ['/D'], env: { PRIVATE_CANARY: 'never-log-env' } }); await settle();
    fake.reply({ ok: true, pid: 91 }); expect(await started).toBe(91);
    await expect(job.authorize({ executable: 'other', args: [], env: {} })).rejects.toThrow('single-use');
  });

  it('generates exclusive OS-peer checked gated assignment and a retained-Job empty oracle', () => {
    helper(); createPendingWorkspaceWindowsJob();
    const args = spawnMock.mock.calls[0][1]; const source = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    expect(source).toContain('CreateNamedPipe'); expect(source).toContain('0x40080003');
    expect(source).toContain('GetNamedPipeClientProcessId(pipe.SafePipeHandle,out peer)');
    expect(source).toContain('DateTime.FromFileTimeUtc(born).Ticks/10!=expected/10');
    expect(source).toContain('limits.Basic.Flags=0x2000');
    expect(source).toContain('QueryInformationJobObject(job,1'); expect(source).toContain('return Account().Active==0');
    expect(source).not.toContain('Get-CimInstance'); expect(source).not.toContain('TerminateProcess');
    expect(source).toContain('$inputEncoding=[System.Text.UTF8Encoding]::new($false)');
    expect(source).toContain('[Console]::InputEncoding=$inputEncoding');
  });

  it('rechecks main-owned authority after readiness and cannot send GO when that fence rejects', async () => {
    const fake = helper(); const job = createPendingWorkspaceWindowsJob({ gate: { pipeName: 'hbi-00000000-0000-0000-0000-000000000001', capability: 'a'.repeat(64) } });
    fake.send({ type: 'listening' }); const attached = job.attach(90, identity); await settle(); fake.reply({ ok: true }); await attached;
    const validate = jest.fn(() => { throw new Error('request scope expired'); });
    await expect(job.authorize({ executable: 'approved.exe', args: [], env: {} }, validate)).rejects.toThrow('scope expired');
    expect(fake.requests().filter(value => value.operation === 'go')).toEqual([]);
    const stopped = job.stop(); await settle(); fake.reply({ ok: true, empty: true }); fake.child.emit('close', 0); await stopped;
  });
});
