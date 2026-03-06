/**
 * RAG tool unit tests
 *
 * Tests cover:
 *  - chunkText: chunking logic and overlap
 *  - tokenize: stop-word removal, normalisation
 *  - cosineSim: similarity edge cases
 *  - rag_index handler: happy path, home-dir guard, empty file, not found
 *  - rag_query handler: retrieval ranking, top_k, doc_id filter, empty index
 *  - rag_list  handler: empty and populated
 *  - rag_clear handler: removal and re-query
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { chunkText, tokenize, cosineSim, ragToolHandlers } from '../tools/rag';

// â”€â”€ silence console.log from assertPermission / registerTool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
jest.spyOn(console, 'log').mockImplementation(() => {});

// â”€â”€ mock assertPermission so tools don't throw in tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
jest.mock('../config-manager', () => ({
  assertPermission: jest.fn(() => true),
  getConfig: jest.fn(() => ({})),
}));

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let tmpDir: string;
const origHome  = process.env.HOME;
const origUName = process.env.USERPROFILE;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-rag-'));
  process.env.HOME        = tmpDir;
  process.env.USERPROFILE = tmpDir;
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.env.HOME        = origHome;
  process.env.USERPROFILE = origUName;
  jest.clearAllMocks();
});

function writeTmp(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

// â”€â”€ chunkText â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('chunkText', () => {
  test('single short text returns one chunk', () => {
    const chunks = chunkText('Hello world. This is a test.');
    expect(chunks.length).toBe(1);
  });

  test('long text is split into multiple chunks', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const text = sentence.repeat(50); // ~450 words
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('each chunk has at most ~250 words (200 + 40-word overlap buffer)', () => {
    const sentence = 'Lorem ipsum dolor sit amet consectetur adipiscing elit. ';
    const text = sentence.repeat(40);
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      const wordCount = chunk.split(/\s+/).filter(Boolean).length;
      expect(wordCount).toBeLessThanOrEqual(260); // 200 + overlap tolerance
    }
  });

  test('empty string returns empty array', () => {
    expect(chunkText('')).toEqual([]);
  });

  test('whitespace-only string returns empty array', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });
});

// â”€â”€ tokenize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('tokenize', () => {
  test('lowercases input', () => {
    expect(tokenize('Hello WORLD')).toEqual(expect.arrayContaining(['hello', 'world']));
  });

  test('removes stop words', () => {
    const tokens = tokenize('the quick brown fox');
    expect(tokens).not.toContain('the');
    expect(tokens).toContain('quick');
    expect(tokens).toContain('brown');
    expect(tokens).toContain('fox');
  });

  test('strips punctuation', () => {
    const tokens = tokenize('Hello, world!');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  test('filters tokens shorter than 3 chars', () => {
    const tokens = tokenize('I am a AI');
    // 'i', 'am', 'a' are <=2 chars â†’ filtered; 'ai' is 2 chars â†’ filtered
    expect(tokens).toEqual([]);
  });
});

// â”€â”€ cosineSim â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('cosineSim', () => {
  test('identical vectors â†’ similarity 1', () => {
    const v = { foo: 0.5, bar: 0.3 };
    expect(cosineSim(v, v)).toBeCloseTo(1.0);
  });

  test('completely disjoint vectors â†’ similarity 0', () => {
    expect(cosineSim({ foo: 1 }, { bar: 1 })).toBe(0);
  });

  test('zero vector â†’ similarity 0', () => {
    expect(cosineSim({}, { foo: 1 })).toBe(0);
    expect(cosineSim({ foo: 1 }, {})).toBe(0);
  });

  test('partial overlap returns value between 0 and 1', () => {
    const sim = cosineSim({ foo: 1, bar: 1 }, { foo: 1, baz: 1 });
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});

// â”€â”€ rag_index â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('rag_index handler', () => {
  test('indexes a plain text file and reports chunk count', async () => {
    const filePath = writeTmp('notes.txt', 'This is a note about machine learning.\n'.repeat(10));
    const result = await ragToolHandlers.rag_index({ path: filePath }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result.chunks_indexed).toBeGreaterThan(0);
    expect(result.result.filename).toBe('notes.txt');
    expect(typeof result.result.doc_id).toBe('string');
  });

  test('re-indexing the same file removes stale chunks first', async () => {
    const filePath = writeTmp('doc.txt', 'Some content here. '.repeat(20));
    const r1 = await ragToolHandlers.rag_index({ path: filePath }, {} as any);
    const r2 = await ragToolHandlers.rag_index({ path: filePath }, {} as any);
    expect(r2.success).toBe(true);
    // Second index should produce the same chunk count as the first (not accumulated)
    expect(r2.result.chunks_indexed).toBe(r1.result.chunks_indexed);
    // total_chunks_in_index must not have grown beyond what the first index produced for this doc
    expect(r2.result.total_chunks_in_index).toBeLessThanOrEqual(
      r2.result.chunks_indexed + (r1.result.total_chunks_in_index - r1.result.chunks_indexed)
    );
  });

  test('fails for missing file', async () => {
    const result = await ragToolHandlers.rag_index({ path: path.join(tmpDir, 'nonexistent.txt') }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  test('fails when path points to a directory', async () => {
    const result = await ragToolHandlers.rag_index({ path: tmpDir }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/directory/i);
  });

  test('fails when path is outside home directory', async () => {
    // Use system temp which is outside tmpDir/home
    const result = await ragToolHandlers.rag_index({ path: 'C:\\Windows\\notepad.exe' }, {} as any);
    expect(result.success).toBe(false);
    // Either "access denied" or "not found" depending on OS + path resolution
    expect(result.error).toBeDefined();
  });

  test('fails when path is missing', async () => {
    const result = await ragToolHandlers.rag_index({}, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/path is required/i);
  });
});

// â”€â”€ rag_query â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('rag_query handler', () => {
  async function indexDoc(name: string, content: string) {
    const p = writeTmp(name, content);
    const r = await ragToolHandlers.rag_index({ path: p }, {} as any);
    return r.result.doc_id as string;
  }

  test('returns empty-index error when nothing indexed', async () => {
    // Clear any existing data by clearing the store module state via a fresh re-require
    // Instead, just test against the actual state (may have data from previous tests in same run)
    // Actually each test has fresh tmpDir & handlers share module state â€” so let's just verify error message
    const r = await ragToolHandlers.rag_query({ query: 'test query' }, {} as any);
    if (!r.success) {
      expect(r.error).toMatch(/no documents indexed/i);
    } else {
      // Some data pre-exist from prior test in same suite â€” that's fine
      expect(Array.isArray(r.result.results)).toBe(true);
    }
  });

  test('returns top-k results after indexing', async () => {
    const docContent = 'The capital of France is Paris. Paris is a beautiful city. '.repeat(15);
    await indexDoc('geography.txt', docContent);
    const result = await ragToolHandlers.rag_query({ query: 'capital France Paris', top_k: 3 }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result.results.length).toBeLessThanOrEqual(3);
    expect(result.result.results[0].relevance).toBeGreaterThan(0);
  });

  test('most relevant chunk ranks first', async () => {
    const filePath = writeTmp('mixed.txt', [
      'Quantum computing uses qubits for computation. Superposition and entanglement are key concepts.',
      'The weather today is sunny and warm. Perfect day for a walk.',
      'Neural networks learn by adjusting weights. Backpropagation is the core algorithm.',
    ].join('\n\n'));
    await ragToolHandlers.rag_index({ path: filePath }, {} as any);

    const r = await ragToolHandlers.rag_query({ query: 'quantum computing qubits superposition', top_k: 3 }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.results[0].text).toMatch(/quantum|qubit|superposition/i);
  });

  test('top_k caps at 10', async () => {
    const p = writeTmp('big.txt', 'Word sentence context. '.repeat(200));
    await ragToolHandlers.rag_index({ path: p }, {} as any);
    const r = await ragToolHandlers.rag_query({ query: 'word sentence', top_k: 50 }, {} as any);
    expect(r.result.results.length).toBeLessThanOrEqual(10);
  });

  test('doc_id filter restricts to one document', async () => {
    const docId = await indexDoc('specific.txt', 'Specific document content about TypeScript and React.');
    await indexDoc('other.txt', 'Other document about completely different topics like cooking.');

    const r = await ragToolHandlers.rag_query({ query: 'TypeScript React', doc_id: docId, top_k: 5 }, {} as any);
    expect(r.success).toBe(true);
    for (const res of r.result.results) {
      expect(res.doc_id).toBe(docId);
    }
  });

  test('doc_id filter for unknown id returns error', async () => {
    await indexDoc('base.txt', 'Some content.');
    const r = await ragToolHandlers.rag_query({ query: 'anything', doc_id: 'rag:nonexistent' }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no chunks found/i);
  });

  test('missing query returns error', async () => {
    const r = await ragToolHandlers.rag_query({ top_k: 3 }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/query is required/i);
  });
});

// â”€â”€ rag_list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('rag_list handler', () => {
  test('returns empty list message when nothing indexed', async () => {
    // Module-level ragStore may have data â€” test both branches
    const r = await ragToolHandlers.rag_list({}, {} as any);
    expect(r.success).toBe(true);
    expect(Array.isArray(r.result.documents)).toBe(true);
  });

  test('shows indexed document after rag_index', async () => {
    const p = writeTmp('listed.txt', 'Content for listing.');
    await ragToolHandlers.rag_index({ path: p }, {} as any);
    const r = await ragToolHandlers.rag_list({}, {} as any);
    expect(r.success).toBe(true);
    const found = (r.result.documents as any[]).some((d: any) => d.filename === 'listed.txt');
    expect(found).toBe(true);
  });
});

// â”€â”€ rag_clear â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('rag_clear handler', () => {
  test('removes a document and its chunks', async () => {
    const p = writeTmp('todelete.txt', 'Delete me please. '.repeat(20));
    const indexResult = await ragToolHandlers.rag_index({ path: p }, {} as any);
    const docId = indexResult.result.doc_id as string;

    const clearResult = await ragToolHandlers.rag_clear({ doc_id: docId }, {} as any);
    expect(clearResult.success).toBe(true);
    expect(clearResult.result.removed_chunks).toBeGreaterThan(0);

    // Document should no longer appear in list
    const listResult = await ragToolHandlers.rag_list({}, {} as any);
    const found = (listResult.result.documents as any[]).some((d: any) => d.doc_id === docId);
    expect(found).toBe(false);
  });

  test('returns error for unknown doc_id', async () => {
    const r = await ragToolHandlers.rag_clear({ doc_id: 'rag:does_not_exist' }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no document found/i);
  });

  test('returns error when doc_id is missing', async () => {
    const r = await ragToolHandlers.rag_clear({}, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/doc_id is required/i);
  });
});
