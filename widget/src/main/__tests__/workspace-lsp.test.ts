// The LSP bridge against a real child process: a tiny stdio language server
// installed as the project's own "pyright" package. Optionally, set
// HOMEBOT_TEST_PYRIGHT_DIR to a folder containing node_modules/pyright to run
// the same flow against real Pyright (not run in CI; nothing is downloaded).
jest.setTimeout(60_000);
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-lsp-ud-'));
jest.mock('electron', () => ({ app: { getPath: () => userData }, dialog: { showMessageBox: jest.fn() } }));
jest.mock('../window-manager', () => ({ getMainWindow: () => null }));
jest.mock('../config-manager', () => ({ getSettings: () => ({}) }));
jest.mock('../../shared/cloud-llm', () => ({ resolveCloudLLM: jest.fn(() => ({ intended: false })) }));
import { resolveCloudLLM } from '../../shared/cloud-llm';
import { handleLspRequest, disposeLanguageServers, offsetToPosition, positionToOffset, hoverText } from '../lsp/lsp-manager';
import { serverForFile, LANGUAGE_SERVERS } from '../lsp/lsp-servers';

const FAKE_SERVER = String.raw`
let buffer = Buffer.alloc(0); const docs = new Map();
const send = m => { const b = Buffer.from(JSON.stringify(m)); process.stdout.write('Content-Length: ' + b.length + '\r\n\r\n'); process.stdout.write(b); };
const diagnose = (uri, version) => { const text = docs.get(uri) || ''; const lines = text.split('\n'); const items = [];
  lines.forEach((line, i) => { const at = line.indexOf('undefined_name'); if (at >= 0) items.push({ range: { start: { line: i, character: at }, end: { line: i, character: at + 14 } }, severity: 1, message: '"undefined_name" is not defined', source: 'fake' }); });
  send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, version, diagnostics: items } }); };
process.stdin.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]);
  for (;;) { const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return; const len = Number(/Content-Length: (\d+)/i.exec(buffer.slice(0, end).toString())[1]); if (buffer.length < end + 4 + len) return;
    const msg = JSON.parse(buffer.slice(end + 4, end + 4 + len).toString()); buffer = buffer.slice(end + 4 + len);
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
    else if (msg.method === 'textDocument/didOpen') { docs.set(msg.params.textDocument.uri, msg.params.textDocument.text); diagnose(msg.params.textDocument.uri, msg.params.textDocument.version); }
    else if (msg.method === 'textDocument/didChange') { docs.set(msg.params.textDocument.uri, msg.params.contentChanges[0].text); diagnose(msg.params.textDocument.uri, msg.params.textDocument.version); }
    else if (msg.method === 'textDocument/completion') send({ jsonrpc: '2.0', id: msg.id, result: { isIncomplete: false, items: [{ label: 'greet', kind: 3, detail: '(name: str) -> str' }, { label: 'GREETING', kind: 21 }] } });
    else if (msg.method === 'textDocument/hover') send({ jsonrpc: '2.0', id: msg.id, result: { contents: { kind: 'markdown', value: '` + '```python\\ndef greet(name: str) -> str\\n```' + `' } } });
    else if (msg.method === 'textDocument/definition') { const uri = msg.params.textDocument.uri.replace('main.py', 'lib.py'); send({ jsonrpc: '2.0', id: msg.id, result: [{ uri, range: { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } } }, { uri: 'file:///opt/typeshed/builtins.pyi', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] }); }
    else if (msg.method === 'shutdown') send({ jsonrpc: '2.0', id: msg.id, result: null });
    else if (msg.method === 'exit') process.exit(0);
  } });
`;
let root: string;
const allow = () => handleLspRequest({ action: 'allow', root, path: 'main.py' }, { confirm: async () => true });
function installFakePyright(into: string) {
  const dir = path.join(into, 'node_modules', 'pyright'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'pyright', version: '0.0.0-fake' }));
  fs.writeFileSync(path.join(dir, 'langserver.index.js'), FAKE_SERVER);
}
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), 'hb-lsp-')));
  fs.writeFileSync(path.join(root, 'lib.py'), 'GREETING = "hi"\ndef greet(name: str) -> str:\n    return GREETING + name\n');
  fs.writeFileSync(path.join(root, 'main.py'), 'from lib import greet\n');
});
// Windows keeps the folder locked until the killed server process has exited, so give it a moment and retry.
afterEach(async () => { disposeLanguageServers(); await new Promise(resolve => setTimeout(resolve, 200)); fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); for (const name of ['ide-project-tools-trust.json']) try { fs.rmSync(path.join(userData, name)); } catch { /* none */ } });

test('positions convert between editor offsets and LSP line/character', () => {
  const text = 'ab\ncdé\nf';
  expect(offsetToPosition(text, 5)).toEqual({ line: 1, character: 2 });
  expect(positionToOffset(text, { line: 1, character: 2 })).toBe(5);
  expect(positionToOffset(text, { line: 9, character: 0 })).toBe(text.length);
  expect(hoverText([{ kind: 'markdown', value: '```python\nx: int\n```' }, 'doc'])).toBe('x: int\n\ndoc');
});

test('the registry routes .py to pyright and keeps unverified servers off', () => {
  expect(serverForFile('/p/a.py')?.id).toBe('pyright');
  expect(serverForFile('/p/a.go')).toBeUndefined();
  expect(LANGUAGE_SERVERS.find(server => server.id === 'gopls')?.enabled).toBe(false);
});

test('nothing starts before the project is allowed; a missing server offers install (Online only)', async () => {
  const before = await handleLspRequest({ action: 'complete', root, path: 'main.py', content: 'gr', position: 2 });
  expect(before.skipped).toMatch(/runs only in projects you allow/);
  await allow();
  const status = await handleLspRequest({ action: 'status', root, path: 'main.py' });
  expect(status.status).toEqual({ id: 'pyright', label: 'Pyright (Python)', source: null, allowed: true, installable: true });
  const install = jest.fn(async () => installFakePyright(path.join(userData, 'language-servers')));
  const offline = await handleLspRequest({ action: 'install', root, path: 'main.py' }, { install });
  expect(offline.skipped).toMatch(/Turn on Online/); expect(install).not.toHaveBeenCalled();
  (resolveCloudLLM as jest.Mock).mockReturnValue({ intended: true });
  const installed = await handleLspRequest({ action: 'install', root, path: 'main.py' }, { install });
  expect(install).toHaveBeenCalledTimes(1);
  expect(installed.status?.source).toBe('homebot');
  fs.rmSync(path.join(userData, 'language-servers'), { recursive: true, force: true });
});

test('completion, hover, go-to-definition and diagnostics flow through a real stdio server', async () => {
  installFakePyright(root); await allow();
  const content = 'from lib import greet\nprint(gr)\nundefined_name\n';
  const complete = await handleLspRequest({ action: 'complete', root, path: 'main.py', content, position: content.indexOf('gr)') + 2 });
  expect(complete.entries).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'greet', kind: 'function', detail: '(name: str) -> str' })]));
  expect(complete.from).toBe(content.indexOf('gr)'));
  const hover = await handleLspRequest({ action: 'hover', root, path: 'main.py', content, position: 18 });
  expect(hover.text).toBe('def greet(name: str) -> str');
  const definition = await handleLspRequest({ action: 'definition', root, path: 'main.py', content, position: 18 });
  expect(definition.locations).toEqual([{ path: path.join(root, 'lib.py'), line: 2, column: 5, start: 20, length: 5 }]);
  const diagnostics = await handleLspRequest({ action: 'diagnostics', root, path: 'main.py', content });
  expect(diagnostics.diagnostics).toEqual([{ start: content.indexOf('undefined_name'), end: content.indexOf('undefined_name') + 14, severity: 'error', message: '"undefined_name" is not defined', source: 'fake' }]);
  const fixed = await handleLspRequest({ action: 'diagnostics', root, path: 'main.py', content: content.replace('undefined_name', 'greet') });
  expect(fixed.diagnostics).toEqual([]);
});

const realPyright = process.env.HOMEBOT_TEST_PYRIGHT_DIR;
(realPyright ? test : test.skip)('real Pyright: diagnostics, completion, hover and definition', async () => {
  fs.cpSync(path.join(realPyright!, 'node_modules', 'pyright'), path.join(root, 'node_modules', 'pyright'), { recursive: true }); await allow();
  const content = 'from lib import greet\nprint(greet("a").upp)\nundefined_name\n';
  const diagnostics = await handleLspRequest({ action: 'diagnostics', root, path: 'main.py', content });
  expect(diagnostics.diagnostics?.some(item => /undefined_name/.test(item.message))).toBe(true);
  const complete = await handleLspRequest({ action: 'complete', root, path: 'main.py', content, position: content.indexOf('.upp') + 4 });
  expect(complete.entries?.some(item => item.label === 'upper')).toBe(true);
  const hover = await handleLspRequest({ action: 'hover', root, path: 'main.py', content, position: content.indexOf('greet(') + 1 });
  expect(hover.text).toMatch(/greet\(name: str\) -> str/);
  const definition = await handleLspRequest({ action: 'definition', root, path: 'main.py', content, position: content.indexOf('greet(') + 1 });
  expect(definition.locations?.[0]).toEqual(expect.objectContaining({ path: path.join(root, 'lib.py'), line: 2 }));
});
