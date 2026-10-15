import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ragToolHandlers as RagHandlers } from '../tools/rag';

// Exercise the real handler and filesystem with disposable files. Only external
// services, permission settings, and the Electron persistence location are stubbed.
jest.mock('../config-manager', () => ({
  assertPermission: jest.fn(),
  getSettings: jest.fn(() => ({ ollamaUrl: 'http://127.0.0.1:11434' })),
}));
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn().mockRejectedValue(new Error('Embedding disabled in test')) },
}));
jest.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => process.env.HOMEBOT_RAG_TEST_STORE },
}));

jest.setTimeout(15_000);

let fixtureRoot: string;
let home: string;
let siblingFile: string;
let handlers: typeof RagHandlers;
const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;
const originalStore = process.env.HOMEBOT_RAG_TEST_STORE;

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-rag-boundary-'));
  home = path.join(fixtureRoot, 'profile');
  const sibling = `${home}-other`;
  fs.mkdirSync(path.join(home, 'Documents'), { recursive: true });
  fs.mkdirSync(sibling);
  siblingFile = path.join(sibling, 'outside.txt');
  fs.writeFileSync(siblingFile, 'Sibling confidential marker zirconium.');
  fs.writeFileSync(path.join(home, 'Documents', 'inside.txt'), 'Allowed document marker beryllium.');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HOMEBOT_RAG_TEST_STORE = path.join(fixtureRoot, 'store');
  // Resolve filesystem's home after installing the isolated profile.
  handlers = require('../tools/rag').ragToolHandlers;
});

beforeEach(async () => {
  const listed = await handlers.rag_list({}, {} as any);
  for (const document of listed.result.documents) {
    await handlers.rag_clear({ doc_id: document.doc_id }, {} as any);
  }
});

afterAll(() => {
  for (const [name, value] of [
    ['HOME', originalHome],
    ['USERPROFILE', originalProfile],
    ['HOMEBOT_RAG_TEST_STORE', originalStore],
  ]) {
    if (value === undefined) delete process.env[name!];
    else process.env[name!] = value;
  }
  // Only remove this test's resolved temporary tree.
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test.each(['absolute', 'parent traversal'])('rejects a same-prefix sibling via %s path before indexing', async kind => {
  const supplied = kind === 'absolute'
    ? siblingFile
    : `${home}${path.sep}..${path.sep}profile-other${path.sep}outside.txt`;
  const before = await handlers.rag_list({}, {} as any);
  const result = await handlers.rag_index({ path: supplied }, {} as any);

  expect(result).toEqual({ success: false, error: expect.stringMatching(/access denied/i) });
  expect(await handlers.rag_list({}, {} as any)).toEqual(before);
  const storePath = path.join(fixtureRoot, 'store', 'memory', 'rag-index.json');
  if (fs.existsSync(storePath)) {
    expect(fs.readFileSync(storePath, 'utf8')).not.toContain('Sibling confidential marker');
  }
});

test('indexes and retrieves a real document inside home using the Documents shortcut', async () => {
  const result = await handlers.rag_index({ path: 'Documents/inside.txt' }, {} as any);
  expect(result.success).toBe(true);
  expect(result.result.filename).toBe('inside.txt');
  const query = await handlers.rag_query({ query: 'beryllium', doc_id: result.result.doc_id }, {} as any);
  expect(query.success).toBe(true);
  expect(query.result.results[0].text).toBe('Allowed document marker beryllium.');
  const store = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'store', 'memory', 'rag-index.json'), 'utf8'));
  expect(store.chunks.map((chunk: { text: string }) => chunk.text)).toContain('Allowed document marker beryllium.');
  expect(JSON.stringify(store)).not.toContain('Sibling confidential marker');
});

test('uses the Windows profile boundary when HOME differs', async () => {
  process.env.HOME = `${home}-other`;
  try {
    const denied = await handlers.rag_index({ path: siblingFile }, {} as any);
    expect(denied).toEqual({ success: false, error: expect.stringMatching(/access denied/i) });
    const allowed = await handlers.rag_index({ path: path.join(home, 'Documents', 'inside.txt') }, {} as any);
    expect(allowed.success).toBe(true);
  } finally {
    process.env.HOME = home;
  }
});

test('a filesystem-root profile (D:\\ on Windows, / on POSIX) still indexes a document under it', async () => {
  const root = path.parse(fixtureRoot).root;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  try {
    const allowed = await handlers.rag_index({ path: path.join(home, 'Documents', 'inside.txt') }, {} as any);
    expect(allowed.success).toBe(true);
  } finally {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  }
});
