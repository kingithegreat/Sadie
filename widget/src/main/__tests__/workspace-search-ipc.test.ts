/**
 * workspace-search-ipc — IDE-9.
 *
 * What is being proved here is the reachability contract, not the search
 * algorithm (that is codebase-tool.test.ts). Two things matter:
 *   1. a search from the panel finds matches in SEVERAL files and hands back
 *      the absolute path a click needs;
 *   2. replace writes exactly the previewed lines and refuses any line that
 *      moved on since the search.
 *
 * `child_process` is mocked so ripgrep fails with ENOENT and the Node walker
 * runs — deterministic, and it is the path that ships on machines without rg.
 */

const handlers: Record<string, (...args: any[]) => Promise<any>> = {};
jest.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: any) => { handlers[name] = handler; },
    removeHandler: (name: string) => { delete handlers[name]; },
  },
}));
jest.mock('child_process', () => ({
  exec: jest.fn(),
  execFile: ((_file: string, _args: unknown[], _opts?: unknown, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) {
      const err = new Error('spawn rg ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      callback(err);
    }
  }) as any,
}));

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { registerWorkspaceIpc, WORKSPACE_CHANNELS } from '../workspace-ipc';

const TMP = os.tmpdir();
const TEST_DIR = path.join(TMP, `homebot-ws-search-${Date.now()}`);
const SRC = path.join(TEST_DIR, 'src');

beforeAll(() => {
  fs.mkdirSync(SRC, { recursive: true });
  fs.writeFileSync(
    path.join(SRC, 'one.ts'),
    ['export const GREETING = "hello";', '', 'export function ping(): string {', '  return "hello world";', '}', ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(SRC, 'two.ts'),
    ['// says hello twice', 'export const A = "hello";', 'export const B = "hello";', ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(TEST_DIR, 'readme.md'),
    ['# Hello heading', '', 'Some notes about hello.', ''].join('\n'),
    'utf8',
  );
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  registerWorkspaceIpc(() => TEST_DIR);
});

const search = (opts: Record<string, unknown>) =>
  handlers[WORKSPACE_CHANNELS.SEARCH]({}, opts);

const replace = (filePath: string, edits: Array<Record<string, unknown>>) =>
  handlers[WORKSPACE_CHANNELS.REPLACE]({}, filePath, edits);

const readLines = (p: string) => fs.readFileSync(p, 'utf8').split(/\r?\n/);

describe('workspace search', () => {
  test('finds matches in several files and returns the absolute path a click needs', async () => {
    const res = await search({ pattern: 'hello', directory: TEST_DIR });
    expect(res.success).toBe(true);
    expect(res.match_count).toBeGreaterThan(2);

    const files = new Set(res.matches.map((m: any) => m.file.replace(/\\/g, '/')));
    expect(files.size).toBeGreaterThanOrEqual(3);
    expect(files).toContain('src/one.ts');
    expect(files).toContain('readme.md');

    // The panel shows `file` (relative) but opens `path` (absolute).
    const first = res.matches[0];
    expect(path.isAbsolute(first.path)).toBe(true);
    expect(fs.existsSync(first.path)).toBe(true);
    expect(first.line).toBeGreaterThanOrEqual(1);
    expect(first.text.toLowerCase()).toContain('hello');
  });

  test('case-sensitive finds only exact casing', async () => {
    const loose = await search({ pattern: 'hello', directory: TEST_DIR });
    const strict = await search({ pattern: 'hello', directory: TEST_DIR, case_sensitive: true });
    expect(loose.match_count).toBeGreaterThan(strict.match_count);
    expect(strict.match_count).toBeGreaterThan(0);
  });

  test('file_pattern limits the files walked', async () => {
    const res = await search({ pattern: 'hello', directory: TEST_DIR, file_pattern: '*.ts' });
    expect(res.success).toBe(true);
    const files: string[] = res.matches.map((m: any) => String(m.file).replace(/\\/g, '/'));
    files.forEach(f => expect(f.endsWith('.ts')).toBe(true));
  });

  test('refuses a directory outside the home folder', async () => {
    const res = await search({ pattern: 'hello', directory: 'C:\\Windows\\System32' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('an empty pattern fails plainly instead of returning everything', async () => {
    const res = await search({ pattern: '   ', directory: TEST_DIR });
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describe('workspace replace', () => {
  test('applies exactly the previewed lines and leaves every other line alone', async () => {
    const target = path.join(SRC, 'two.ts');
    const before = readLines(target);

    const res = await replace(target, [
      { line: 2, oldText: 'export const A = "hello";', newText: 'export const A = "goodbye";' },
    ]);
    expect(res.success).toBe(true);
    expect(res.applied).toBe(1);

    const after = readLines(target);
    expect(after[1]).toBe('export const A = "goodbye";');
    // The untouched lines are byte-identical, including line 3's own "hello".
    expect(after[2]).toBe(before[2]);
    expect(after.length).toBe(before.length);
  });

  test('skips and reports a line that changed since the search, without writing', async () => {
    const target = path.join(SRC, 'one.ts');
    const res = await replace(target, [
      { line: 1, oldText: 'export const GREETING = "goodbye";', newText: 'const x = 1;' },
    ]);
    expect(res.success).toBe(false);
    expect(res.applied).toBe(0);
    expect(res.skipped[0].line).toBe(1);
    expect(res.skipped[0].reason).toContain('changed');
    // And the file on disk is untouched.
    expect(readLines(target)[0]).toBe('export const GREETING = "hello";');
  });

  test('a replacement containing a newline inserts lines at the right place', async () => {
    const target = path.join(SRC, 'one.ts');
    const res = await replace(target, [
      { line: 4, oldText: '  return "hello world";', newText: '  return [\n    "hello world",\n  ];' },
    ]);
    expect(res.success).toBe(true);
    expect(res.applied).toBe(1);
    const after = readLines(target);
    expect(after[3]).toBe('  return [');
    expect(after[4]).toBe('    "hello world",');
    expect(after[5]).toBe('  ];');
  });

  test('preserves CRLF line endings on the way back out', async () => {
    const target = path.join(TEST_DIR, 'crlf.txt');
    fs.writeFileSync(target, 'line one\r\nfind me\r\nline three\r\n', 'utf8');
    const res = await replace(target, [
      { line: 2, oldText: 'find me', newText: 'found' },
    ]);
    expect(res.success).toBe(true);
    const buf = fs.readFileSync(target);
    expect(buf.toString('utf8')).toBe('line one\r\nfound\r\nline three\r\n');
  });

  test('refuses a path outside the home folder', async () => {
    const res = await replace('C:\\Windows\\System32\\drivers\\etc\\hosts', [
      { line: 1, oldText: 'x', newText: 'y' },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('refuses a binary file and a missing one', async () => {
    const binary = path.join(TEST_DIR, 'blob.bin');
    fs.writeFileSync(binary, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const bin = await replace(binary, [{ line: 1, oldText: 'x', newText: 'y' }]);
    expect(bin.success).toBe(false);
    expect(bin.error).toContain('Binary');

    const gone = await replace(path.join(TEST_DIR, 'nope.ts'), [{ line: 1, oldText: 'x', newText: 'y' }]);
    expect(gone.success).toBe(false);
  });

  test('an empty edit list fails plainly instead of touching the file', async () => {
    const res = await replace(path.join(SRC, 'one.ts'), []);
    expect(res.success).toBe(false);
  });
});
