/**
 * document-tools.test.ts
 * Tests for src/main/tools/documents.ts
 *
 * The module-level parsedDocuments Map persists between handlers in the same
 * Jest module instance.  We use clearDocuments() to reset between tests.
 */

// Mock heavy parser deps so tests don't need the actual binaries
jest.mock('pdf-parse', () => jest.fn().mockResolvedValue({ text: 'PDF text content', numpages: 2 }), { virtual: true });
jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: 'Word document text content' }),
}));

// Mock fs.promises to avoid real disk I/O in parse_document_from_path tests
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: jest.fn(),
      readFile: jest.fn(),
    },
  };
});

import { documentToolHandlers, documentToolDefs, storeDocument, getDocument, clearDocuments } from '../tools/documents';
import * as fs from 'fs';

const fsMock = fs.promises as jest.Mocked<typeof fs.promises>;

// Helper: base64-encode a string
function b64(text: string): string {
  return Buffer.from(text).toString('base64');
}

beforeEach(() => {
  clearDocuments();
  jest.clearAllMocks();
});

// ── storeDocument / getDocument / clearDocuments ───────────────────────────

describe('storeDocument / getDocument / clearDocuments', () => {
  test('stores and retrieves a document', () => {
    storeDocument('doc-1', 'notes.txt', 'text/plain', 'Hello world content');
    const doc = getDocument('doc-1');
    expect(doc).toBeDefined();
    expect(doc!.filename).toBe('notes.txt');
    expect(doc!.text).toBe('Hello world content');
    expect(doc!.wordCount).toBe(3);
  });

  test('returns undefined for unknown id', () => {
    expect(getDocument('no-such-doc')).toBeUndefined();
  });

  test('clearDocuments removes all entries', () => {
    storeDocument('d1', 'a.txt', 'text/plain', 'text');
    storeDocument('d2', 'b.txt', 'text/plain', 'more text');
    clearDocuments();
    expect(getDocument('d1')).toBeUndefined();
    expect(getDocument('d2')).toBeUndefined();
  });
});

// ── parse_document ─────────────────────────────────────────────────────────

describe('parse_document handler', () => {
  const handler = documentToolHandlers.parse_document;

  test('returns failure when document_id is missing', async () => {
    const res = await handler({ data: b64('hello') }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/document_id/i);
  });

  test('returns failure when data is missing', async () => {
    const res = await handler({ document_id: 'x' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/data/i);
  });

  test('parses plain text content', async () => {
    const content = 'The quick brown fox jumps over the lazy dog';
    const res = await handler({
      document_id: 'doc-txt',
      filename: 'test.txt',
      data: b64(content),
      mime_type: 'text/plain',
    }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.document_id).toBe('doc-txt');
    expect(res.result.word_count).toBe(9);
    expect(res.result.preview).toContain('quick brown fox');
  });

  test('parses markdown content', async () => {
    const md = '# Title\nSome **bold** content here.';
    const res = await handler({
      document_id: 'doc-md',
      filename: 'readme.md',
      data: b64(md),
    }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.preview).toContain('Title');
  });

  test('parses JSON content', async () => {
    const json = JSON.stringify({ key: 'value', count: 42 });
    const res = await handler({
      document_id: 'doc-json',
      filename: 'data.json',
      data: b64(json),
    }, {} as any);
    expect(res.success).toBe(true);
  });

  test('parses TypeScript code file', async () => {
    const ts = 'export function add(a: number, b: number): number { return a + b; }';
    const res = await handler({
      document_id: 'doc-ts',
      filename: 'util.ts',
      data: b64(ts),
    }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.preview).toContain('add');
  });

  test('returns cached result for duplicate document_id', async () => {
    const content = 'First parse content';
    await handler({ document_id: 'cached', filename: 'a.txt', data: b64(content) }, {} as any);
    // Second call with different data should return cached
    const res = await handler({ document_id: 'cached', filename: 'b.txt', data: b64('different') }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.message).toMatch(/already parsed/i);
  });

  test('parses PDF via pdf-parse mock', async () => {
    const res = await handler({
      document_id: 'doc-pdf',
      filename: 'report.pdf',
      data: b64('fake pdf bytes'),
      mime_type: 'application/pdf',
    }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.word_count).toBeGreaterThan(0);
  });

  test('parses Word .docx via mammoth mock', async () => {
    const res = await handler({
      document_id: 'doc-docx',
      filename: 'report.docx',
      data: b64('fake docx bytes'),
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.word_count).toBeGreaterThan(0);
  });

  test('returns failure for unsupported file type', async () => {
    const res = await handler({
      document_id: 'doc-exe',
      filename: 'program.exe',
      data: b64('binary'),
      mime_type: 'application/octet-stream',
    }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unsupported|failed/i);
  });

  test('truncates preview to 500 chars with ellipsis', async () => {
    const longText = 'word '.repeat(200); // 1000 chars
    const res = await handler({
      document_id: 'doc-long',
      filename: 'long.txt',
      data: b64(longText),
    }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.preview.length).toBeLessThanOrEqual(503); // 500 + "..."
    expect(res.result.preview).toMatch(/\.\.\.$/);
  });
});

// ── get_document_content ───────────────────────────────────────────────────

describe('get_document_content handler', () => {
  const handler = documentToolHandlers.get_document_content;

  test('returns failure when document_id is missing', async () => {
    const res = await handler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/document_id/i);
  });

  test('returns failure for unknown document_id', async () => {
    const res = await handler({ document_id: 'ghost' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  test('returns full content for stored document', async () => {
    storeDocument('stored-1', 'notes.txt', 'text/plain', 'Full document content here');
    const res = await handler({ document_id: 'stored-1' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.content).toBe('Full document content here');
    expect(res.result.filename).toBe('notes.txt');
  });

  test('includes word_count in response', async () => {
    storeDocument('stored-2', 'doc.txt', 'text/plain', 'one two three four five');
    const res = await handler({ document_id: 'stored-2' }, {} as any);
    expect(res.result.word_count).toBe(5);
  });
});

// ── list_documents ─────────────────────────────────────────────────────────

describe('list_documents handler', () => {
  const handler = documentToolHandlers.list_documents;

  test('returns empty list initially', async () => {
    const res = await handler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(0);
    expect(res.result.documents).toEqual([]);
  });

  test('lists all stored documents', async () => {
    storeDocument('a', 'a.txt', 'text/plain', 'content a');
    storeDocument('b', 'b.txt', 'text/plain', 'content b');
    const res = await handler({}, {} as any);
    expect(res.result.count).toBe(2);
    const ids = res.result.documents.map((d: any) => d.document_id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  test('each entry includes filename and word_count', async () => {
    storeDocument('x', 'test.md', 'text/markdown', 'hello world');
    const res = await handler({}, {} as any);
    const doc = res.result.documents[0];
    expect(doc.filename).toBe('test.md');
    expect(doc.word_count).toBe(2);
  });
});

// ── search_document ────────────────────────────────────────────────────────

describe('search_document handler', () => {
  const handler = documentToolHandlers.search_document;

  beforeEach(() => {
    storeDocument('search-doc', 'article.txt', 'text/plain',
      'Line one has apples\nLine two has bananas\nLine three has apples again\nLine four has oranges'
    );
  });

  test('returns failure when document_id is missing', async () => {
    const res = await handler({ query: 'apples' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/document_id|query/i);
  });

  test('returns failure when query is missing', async () => {
    const res = await handler({ document_id: 'search-doc' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/document_id|query/i);
  });

  test('returns failure for unknown document', async () => {
    const res = await handler({ document_id: 'ghost', query: 'anything' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  test('finds case-insensitive matches by default', async () => {
    const res = await handler({ document_id: 'search-doc', query: 'APPLES' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.match_count).toBe(2);
  });

  test('respects case_sensitive=true', async () => {
    const res = await handler({ document_id: 'search-doc', query: 'APPLES', case_sensitive: true }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.match_count).toBe(0);
  });

  test('returns zero matches for absent query', async () => {
    const res = await handler({ document_id: 'search-doc', query: 'mango' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.match_count).toBe(0);
  });

  test('includes line_number in each match', async () => {
    const res = await handler({ document_id: 'search-doc', query: 'bananas' }, {} as any);
    expect(res.result.match_count).toBe(1);
    expect(res.result.matches[0].line_number).toBe(2);
  });

  test('includes surrounding context in matches', async () => {
    const res = await handler({ document_id: 'search-doc', query: 'bananas', context_lines: 1 }, {} as any);
    expect(res.result.matches[0].context).toContain('apples');
  });
});

// ── parse_document_from_path ───────────────────────────────────────────────

describe('parse_document_from_path handler', () => {
  const handler = documentToolHandlers.parse_document_from_path;

  test('returns failure when path is missing', async () => {
    const res = await handler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/path/i);
  });

  test('returns failure for path outside home directory', async () => {
    // A path like /etc/passwd or C:\Windows
    const res = await handler({ path: '/etc/passwd' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/access denied|path is required/i);
  });

  test('returns failure when stat reports it is a directory', async () => {
    const homedir = process.env.HOME || process.env.USERPROFILE || '';
    fsMock.stat.mockResolvedValueOnce({ isDirectory: () => true, size: 0 } as any);
    const res = await handler({ path: `${homedir}/Documents` }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/directory/i);
  });

  test('returns failure when file exceeds 5 MB limit', async () => {
    const homedir = process.env.HOME || process.env.USERPROFILE || '';
    fsMock.stat.mockResolvedValueOnce({ isDirectory: () => false, size: 6 * 1024 * 1024 } as any);
    const res = await handler({ path: `${homedir}/bigfile.bin` }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/too large/i);
  });

  test('parses a text file from disk', async () => {
    const homedir = process.env.HOME || process.env.USERPROFILE || '';
    const content = 'Hello from disk file content';
    fsMock.stat.mockResolvedValueOnce({ isDirectory: () => false, size: content.length } as any);
    fsMock.readFile.mockResolvedValueOnce(Buffer.from(content) as any);
    const res = await handler({ path: `${homedir}/Desktop/notes.txt` }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.word_count).toBe(5);
  });
});

// ── Tool definitions ───────────────────────────────────────────────────────

describe('documentToolDefs', () => {
  test('exports 5 tool definitions', () => {
    expect(documentToolDefs).toHaveLength(5);
  });

  test('all definitions have name and category', () => {
    for (const def of documentToolDefs) {
      expect(def.name).toBeTruthy();
      expect(def.category).toBe('document');
    }
  });

  test('parse_document requires document_id and data', () => {
    const def = documentToolDefs.find(d => d.name === 'parse_document')!;
    expect(def.parameters.required).toContain('document_id');
    expect(def.parameters.required).toContain('data');
  });

  test('search_document requires document_id and query', () => {
    const def = documentToolDefs.find(d => d.name === 'search_document')!;
    expect(def.parameters.required).toContain('document_id');
    expect(def.parameters.required).toContain('query');
  });
});
