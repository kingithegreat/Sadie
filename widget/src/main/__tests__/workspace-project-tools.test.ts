// Real worker threads and real files; the project's packages are tiny local fakes
// implementing the public prettier/eslint API surface HomeBot calls.
jest.setTimeout(20_000);
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-tools-ud-'));
jest.mock('electron', () => ({ app: { getPath: () => userData }, dialog: { showMessageBox: jest.fn() } }));
jest.mock('../window-manager', () => ({ getMainWindow: () => null }));
import { handleProjectToolsRequest, resolveProjectTool, disposeProjectToolWorkers, projectToolsAllowed } from '../workspace-project-tools';

let root: string;
const allow = () => handleProjectToolsRequest({ action: 'allow', root }, { confirm: async () => true });
function writePackage(name: string, main: string) {
  const dir = path.join(root, 'node_modules', name); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '9.9.9', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'index.js'), main);
}
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), 'hb-tools-')));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}');
  fs.writeFileSync(path.join(root, 'a.ts'), 'let x=1\n');
});
afterEach(() => { disposeProjectToolWorkers(); fs.rmSync(root, { recursive: true, force: true }); try { fs.rmSync(path.join(userData, 'ide-project-tools-trust.json')); } catch { /* none */ } });

const prettierFake = `exports.getFileInfo = async f => ({ ignored: f.endsWith('ignored.ts'), inferredParser: f.endsWith('.bin') ? null : 'typescript' });
exports.resolveConfig = async () => ({ semi: true });
exports.format = async (text, o) => text.replace(/=/g, ' = ').trimEnd() + (o.semi ? ';' : '') + '\\n';`;
const eslintFake = `class ESLint { constructor(o) { this.cwd = o.cwd; }
  async isPathIgnored() { return false; }
  async lintText(text) { if (text.includes('HANG')) await new Promise(() => {}); return [{ messages: text.includes('var ') ? [{ line: 1, column: 1, endLine: 1, endColumn: 4, severity: 2, message: 'Unexpected var', ruleId: 'no-var' }] : [] }]; } }
exports.ESLint = ESLint;`;

test('nothing runs until the user allows project tools for this folder', async () => {
  writePackage('prettier', prettierFake);
  const result = await handleProjectToolsRequest({ action: 'format', root, path: 'a.ts', content: 'let x=1\n' });
  expect(result).toEqual(expect.objectContaining({ success: true, skipped: expect.stringMatching(/not allowed/) }));
  expect(result.formatted).toBeUndefined();
  const declined = await handleProjectToolsRequest({ action: 'allow', root }, { confirm: async () => false });
  expect(declined.status?.allowed).toBe(false);
  expect(projectToolsAllowed(root)).toBe(false);
});

test('missing packages are reported, not substituted with HomeBot\'s own copies', async () => {
  await allow();
  const status = await handleProjectToolsRequest({ action: 'status', root });
  expect(status.status).toEqual({ allowed: true, prettier: null, eslint: null });
  const lint = await handleProjectToolsRequest({ action: 'lint', root, path: 'a.ts', content: 'var x' });
  expect(lint.skipped).toMatch(/ESLint is not installed/);
});

test('project Prettier formats in a worker using the project config', async () => {
  writePackage('prettier', prettierFake); await allow();
  const result = await handleProjectToolsRequest({ action: 'format', root, path: 'a.ts', content: 'let x=1\n' });
  expect(result).toEqual({ success: true, formatted: 'let x = 1;\n' });
  const ignored = await handleProjectToolsRequest({ action: 'format', root, path: 'ignored.ts', content: 'a=b' });
  expect(ignored.skipped).toMatch(/prettierignore/);
  expect(fs.readFileSync(path.join(root, 'a.ts'), 'utf8')).toBe('let x=1\n');
});

test('project ESLint returns diagnostics for the unsaved buffer', async () => {
  writePackage('eslint', eslintFake); await allow();
  const result = await handleProjectToolsRequest({ action: 'lint', root, path: 'a.ts', content: 'var x = 1' });
  expect(result.diagnostics).toEqual([{ line: 1, column: 1, endLine: 1, endColumn: 4, severity: 'error', message: 'Unexpected var', ruleId: 'no-var' }]);
  const css = await handleProjectToolsRequest({ action: 'lint', root, path: 'a.css', content: 'var x' });
  expect(css.diagnostics).toEqual([]);
});

test('a hung tool is stopped by the timeout and the next request gets a fresh worker', async () => {
  writePackage('eslint', eslintFake); await allow();
  const hung = await handleProjectToolsRequest({ action: 'lint', root, path: 'a.ts', content: 'HANG' }, { timeoutMs: 500 });
  expect(hung.success).toBe(false); expect(hung.error).toMatch(/longer than/);
  const next = await handleProjectToolsRequest({ action: 'lint', root, path: 'a.ts', content: 'var y' });
  expect(next.diagnostics).toHaveLength(1);
});

test('paths outside the project and oversized buffers are refused', async () => {
  writePackage('eslint', eslintFake); await allow();
  const outside = await handleProjectToolsRequest({ action: 'lint', root, path: path.join(os.homedir(), 'elsewhere.ts'), content: 'var x' });
  expect(outside.success).toBe(false);
  const large = await handleProjectToolsRequest({ action: 'lint', root, path: 'a.ts', content: 'x'.repeat(2 * 1024 * 1024 + 1) });
  expect(large.skipped).toMatch(/2 MB/);
});

test('a package linked from outside the project is not treated as the project\'s own', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-outside-'));
  fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: 'prettier', version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(outside, 'index.js'), '');
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'node_modules', 'prettier'), 'junction');
  expect(resolveProjectTool(root, 'prettier')).toBeNull();
  fs.rmSync(outside, { recursive: true, force: true });
});
