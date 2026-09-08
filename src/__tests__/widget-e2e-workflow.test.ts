import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';

// Execute the actual workflow's wrapper, stubbing only the child process.
// This guards the production exit status, not a second copy of its logic.
const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/widget-e2e-ci.yaml'), 'utf8');
const step = workflow.match(/- name: Run E2E tests \(sharded\)\r?\n(?:[ \t]+#[^\r\n]*\r?\n)*\s+run: \|\r?\n\s+node -e "([^\r\n]+)"/);
if (!step) throw new Error('The sharded E2E launch step was not found; update this test with the workflow.');
const script = step[1]
  .replace(/\$\{\{ matrix.shardIndex \}\}/g, '1')
  .replace(/\$\{\{ matrix.totalShards \}\}/g, '3');

function execute(platform: string, result: { status: number | null; error?: Error; signal?: string }) {
  const spawnSync = jest.fn(() => result);
  const exit = jest.fn();
  const error = jest.fn();
  runInNewContext(script, {
    require: (name: string) => {
      if (name !== 'child_process') throw new Error(`Unexpected import: ${name}`);
      return { spawnSync };
    },
    process: { platform, exit },
    console: { log: jest.fn(), error },
    Date,
  });
  return { spawnSync, exit, error };
}

test('the Windows shard launches npm through its command shim', () => {
  const { spawnSync, exit } = execute('win32', { status: 0 });
  expect(spawnSync).toHaveBeenCalledTimes(1);
  expect(spawnSync).toHaveBeenCalledWith('npm', expect.arrayContaining(['--shard=1/3']), {
    stdio: 'inherit', shell: true,
  });
  expect(exit).toHaveBeenCalledWith(0);
});

test.each(['linux', 'darwin'])('%s preserves its direct launch and successful exit', platform => {
  const { spawnSync, exit } = execute(platform, { status: 0 });
  const [command, args, options] = spawnSync.mock.calls[0] as unknown as [string, string[], object];
  expect(command).toBe(platform === 'linux' ? 'xvfb-run' : 'npm');
  expect(args).toContain('--shard=1/3');
  if (platform === 'linux') expect(args.slice(0, 2)).toEqual(['-a', 'npm']);
  expect(options).toEqual({ stdio: 'inherit', shell: false });
  expect(exit).toHaveBeenCalledWith(0);
});

test('a child launch error reports failure rather than process.exit(null)', () => {
  const launchError = new Error('spawn npm ENOENT');
  const { spawnSync, exit, error } = execute('win32', { status: null, error: launchError });
  expect(spawnSync).toHaveBeenCalledTimes(2);
  expect(error).toHaveBeenCalledWith(launchError);
  expect(exit).toHaveBeenCalledWith(1);
});

test('a terminated child cannot turn the required gate green', () => {
  const { exit } = execute('linux', { status: null, signal: 'SIGTERM' });
  expect(exit).toHaveBeenCalledWith(1);
});

test('real test failures keep their nonzero exit status after retries', () => {
  const { spawnSync, exit } = execute('win32', { status: 7 });
  expect(spawnSync).toHaveBeenCalledTimes(2);
  expect(exit).toHaveBeenCalledWith(7);
});
