import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  const { EventEmitter } = jest.requireActual('events');
  return { ...actual, spawn: jest.fn(() => Object.assign(new EventEmitter(), { pid: 1234 })) };
});
// Use the PUBLIC package export. No _parse, copied quoting, or real native spawn.
const crossSpawn = jest.requireActual('cross-spawn') as (command: string, args: string[], options: Record<string, unknown>) => any;
const nativeSpawn = spawn as unknown as jest.Mock;
const windows = process.platform === 'win32' ? describe : describe.skip;

windows('public cross-spawn preserves Windows configured MCP command semantics', () => {
  let directory: string;
  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hbi-mcp-compat-'));
    for (const name of ['tool with space.cmd', 'tool.bat', 'fixture-node.exe', 'bare.exe']) fs.writeFileSync(path.join(directory, name), '@echo fixture\r\n');
    fs.writeFileSync(path.join(directory, 'script with space'), '#!fixture-node.exe\nfixture-only\n');
  });
  beforeEach(() => { nativeSpawn.mockClear(); });
  afterAll(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

  test.each(['tool with space.cmd', 'tool.bat'])('public adapter handles %s with arguments and frozen target env/cwd', name => {
    const target = path.join(directory, name), env = { PATH: directory, FIXTURE_ONLY: 'target-env' };
    crossSpawn(target, ['space & value', 'quote " value'], { env, cwd: directory, stdio: 'inherit', shell: false });
    expect(nativeSpawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = nativeSpawn.mock.calls[0];
    expect(command.toLowerCase()).toMatch(/cmd(?:\.exe)?$/);
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(args[3]).toContain(name.replace(/ /g, '^ '));
    expect(args[3]).toContain('^&');
    expect(options).toMatchObject({ env, cwd: directory, stdio: 'inherit', windowsVerbatimArguments: true });
  });

  test('a shebang resolves its interpreter through the public adapter and retains script/arguments', () => {
    const script = path.join(directory, 'script with space');
    crossSpawn(script, ['original argument'], { env: { PATH: directory }, cwd: directory, stdio: 'inherit', shell: false });
    const [command, args, options] = nativeSpawn.mock.calls[0];
    expect(command).toBe('fixture-node.exe'); expect(args).toEqual([script, 'original argument']);
    expect(options.windowsVerbatimArguments).not.toBe(true);
  });

  test('a native executable does not acquire cmd quoting or a guessed shell', () => {
    const target = path.join(directory, 'bare.exe');
    crossSpawn(target, ['space & value'], { env: { PATH: directory }, cwd: directory, stdio: 'inherit', shell: false });
    expect(nativeSpawn.mock.calls[0][0]).toBe(target);
    expect(nativeSpawn.mock.calls[0][1]).toEqual(['space & value']);
    expect(nativeSpawn.mock.calls[0][2].windowsVerbatimArguments).not.toBe(true);
  });
});
