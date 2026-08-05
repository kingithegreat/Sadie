/**
 * terminal-session.test.ts — interactive terminal sessions for the panel.
 *
 * child_process is mocked so nothing is ever really executed. Paths are real
 * (home dir + this repo) because the sandbox check consults the filesystem.
 */

// `exec` must be present even though this suite never calls it: importing
// terminal-session pulls in tools/terminal.ts, which does promisify(exec) at
// module load and throws if the mock omits it.
jest.mock('child_process', () => ({ spawn: jest.fn(), exec: jest.fn() }));

import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  createSession,
  runCommand,
  killCommand,
  closeSession,
  getSession,
  __resetSessionsForTest,
  TerminalChunk,
  TerminalExit,
} from '../terminal-session';

const mockSpawn = spawn as unknown as jest.Mock;
const HOME = os.homedir();

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  child.pid = 4242;
  return child;
}

function collect() {
  const chunks: TerminalChunk[] = [];
  const exits: TerminalExit[] = [];
  return {
    chunks,
    exits,
    handlers: { onChunk: (c: TerminalChunk) => chunks.push(c), onExit: (e: TerminalExit) => exits.push(e) },
    text: () => chunks.map(c => c.data).join(''),
  };
}

beforeEach(() => { mockSpawn.mockReset(); __resetSessionsForTest(); });

describe('session lifecycle', () => {
  test('defaults to the home directory', () => {
    expect(createSession().cwd).toBe(HOME);
  });

  test('honours a valid cwd inside home', () => {
    const s = createSession(process.cwd());
    expect(s.cwd.toLowerCase()).toBe(path.resolve(process.cwd()).toLowerCase());
  });

  test('falls back to home for a path outside the sandbox rather than refusing to open', () => {
    expect(createSession('C:\\Windows\\System32').cwd).toBe(HOME);
    expect(createSession('/etc').cwd).toBe(HOME);
  });

  test('sessions are addressable and closable', () => {
    const { id } = createSession();
    expect(getSession(id)).toMatchObject({ id, running: false });
    closeSession(id);
    expect(getSession(id)).toBeNull();
  });
});

describe('safety', () => {
  test('blocks destructive commands without spawning anything', () => {
    const { id } = createSession();
    const c = collect();
    runCommand(id, 'rm -rf /', c.handlers);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(c.text()).toMatch(/Blocked dangerous pattern/);
    expect(c.exits[0].code).toBe(126);
  });

  test('allows ordinary commands that the LLM-facing guard would reject as prose', () => {
    // `where python` and `help` trip the natural-language heuristic used for
    // the model. A human typing them means them literally.
    const { id } = createSession();
    mockSpawn.mockReturnValue(fakeChild());
    const c = collect();
    expect(runCommand(id, 'where python', c.handlers).started).toBe(true);
    expect(mockSpawn).toHaveBeenCalled();
  });
});

describe('built-ins', () => {
  test('cd changes the session cwd and persists for later commands', () => {
    const { id } = createSession(HOME);
    const c = collect();
    const target = path.resolve(process.cwd());
    runCommand(id, `cd ${target}`, c.handlers);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(getSession(id)!.cwd.toLowerCase()).toBe(target.toLowerCase());
    expect(c.exits[0].cwd.toLowerCase()).toBe(target.toLowerCase());
  });

  test('cd outside the home sandbox is refused and leaves cwd unchanged', () => {
    const { id, cwd } = createSession(HOME);
    const c = collect();
    runCommand(id, 'cd C:\\Windows', c.handlers);
    expect(getSession(id)!.cwd).toBe(cwd);
    expect(c.chunks[0].stream).toBe('stderr');
  });

  test('bare cd returns home', () => {
    const { id } = createSession(process.cwd());
    runCommand(id, 'cd', collect().handlers);
    expect(getSession(id)!.cwd).toBe(HOME);
  });

  test('clear emits the reset sequence the panel listens for', () => {
    const { id } = createSession();
    const c = collect();
    runCommand(id, 'clear', c.handlers);
    expect(c.chunks[0].data).toBe('\x1bc');
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe('streaming', () => {
  test('forwards stdout and stderr, then reports exit', () => {
    const { id } = createSession();
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);
    const c = collect();

    runCommand(id, 'npm test', c.handlers);
    child.stdout.emit('data', Buffer.from('running…'));
    child.stderr.emit('data', Buffer.from('warn'));
    child.emit('close', 0, null);

    expect(c.chunks.map(x => [x.stream, x.data])).toEqual([
      ['stdout', 'running…'],
      ['stderr', 'warn'],
    ]);
    expect(c.exits[0]).toMatchObject({ sessionId: id, code: 0 });
  });

  test('refuses a second command while one is running', () => {
    const { id } = createSession();
    mockSpawn.mockReturnValue(fakeChild());
    const c = collect();
    runCommand(id, 'sleep 10', c.handlers);
    const second = runCommand(id, 'echo hi', c.handlers);
    expect(second.started).toBe(false);
    expect(second.error).toMatch(/already running/i);
  });

  test('a command can be run again once the previous one exits', () => {
    const { id } = createSession();
    const first = fakeChild();
    mockSpawn.mockReturnValue(first);
    const c = collect();
    runCommand(id, 'one', c.handlers);
    first.emit('close', 0, null);

    mockSpawn.mockReturnValue(fakeChild());
    expect(runCommand(id, 'two', c.handlers).started).toBe(true);
  });

  test('exit is reported once, not per close event', () => {
    const { id } = createSession();
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);
    const c = collect();
    runCommand(id, 'x', c.handlers);
    child.emit('close', 0, null);
    child.emit('close', 0, null);
    expect(c.exits).toHaveLength(1);
  });

  test('spawn errors surface on stderr instead of throwing', () => {
    const { id } = createSession();
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);
    const c = collect();
    runCommand(id, 'nope', c.handlers);
    child.emit('error', new Error('ENOENT'));
    expect(c.text()).toContain('ENOENT');
  });

  test('unknown session and empty command fail cleanly', () => {
    const c = collect();
    expect(runCommand('term_missing', 'ls', c.handlers).error).toMatch(/not found/i);
    const { id } = createSession();
    expect(runCommand(id, '   ', c.handlers).error).toMatch(/empty/i);
  });
});

describe('cancellation', () => {
  test('kill reports an error when nothing is running', () => {
    const { id } = createSession();
    expect(killCommand(id)).toMatchObject({ killed: false });
  });

  test('kill terminates a running command', () => {
    const { id } = createSession();
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);
    runCommand(id, 'sleep 100', collect().handlers);
    // On Windows the shell's children outlive killing the shell, so the tree
    // is killed via taskkill rather than child.kill().
    mockSpawn.mockReturnValue(fakeChild());
    expect(killCommand(id).killed).toBe(true);
  });
});
