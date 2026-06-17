/**
 * HomeBot RAG (Retrieval-Augmented Generation) Tools
 *
 * Indexes local documents into overlapping text chunks and enables fast
 * semantic search using TF-IDF cosine similarity.  No model download, no
 * network call, works offline immediately.
 *
 * Supported file types: .txt .md .json .csv .log .xml and all code files,
 * plus .pdf (via pdf-parse) and .docx (via mammoth) — the same parsers used
 * by the document tool.
 *
 * Index persists between sessions at userData/memory/rag-index.json
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { ToolDefinition, ToolHandler, ToolResult } from './types';
import { resolveUserPath } from './filesystem';
import { assertPermission, getSettings } from '../config-manager';

// ── Types ──────────────────────────────────────────────────────────────────

interface RagChunk {
  docId: string;
  filename: string;
  chunkIndex: number;
  text: string;
  tf: Record<string, number>;        // term → raw TF score (keyword search)
  embedding?: number[];               // semantic embedding vector (768-dim for nomic-embed-text)
}

interface RagStore {
  chunks: RagChunk[];
  idf: Record<string, number>; // term → IDF score (rebuilt after every index/clear)
  docIds: string[];            // ordered list of all indexed doc IDs
}

// ── Embedding config ──────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'nomic-embed-text';
const EMBEDDING_DIM   = 768;
/** Max chunks to embed in a single index call (rate-limit guard). */
const MAX_EMBED_BATCH = 100;

/**
 * Fetch an embedding from Ollama's /api/embeddings endpoint.
 * Returns null if Ollama is unreachable or the model isn't pulled.
 */
async function getEmbedding(text: string): Promise<number[] | null> {
  const ollamaUrl = getSettings().ollamaUrl || 'http://127.0.0.1:11434';
  try {
    const resp = await axios.post(`${ollamaUrl}/api/embeddings`, {
      model: EMBEDDING_MODEL,
      prompt: text.slice(0, 8000), // cap input length
    }, { timeout: 15000 });
    const vec = resp.data?.embedding;
    if (Array.isArray(vec) && vec.length === EMBEDDING_DIM) return vec;
    return null;
  } catch {
    return null;
  }
}

/**
 * Batch-embed multiple chunks. Silently returns null entries on failure.
 */
async function batchEmbed(texts: string[]): Promise<(number[] | null)[]> {
  // Run in parallel with a concurrency limit (avoid flooding Ollama)
  const CONCURRENCY = 4;
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const batch = texts.slice(i, i + CONCURRENCY);
    const embeddings = await Promise.all(batch.map(t => getEmbedding(t)));
    for (let j = 0; j < embeddings.length; j++) {
      results[i + j] = embeddings[j];
    }
  }
  return results;
}

/**
 * Cosine similarity between two dense vectors.
 */
function vectorCosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── In-memory state ────────────────────────────────────────────────────────

const ragStore: RagStore = { chunks: [], idf: {}, docIds: [] };

// ── Persistence ────────────────────────────────────────────────────────────

function getRagStorePath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    const base = app.isPackaged
      ? app.getPath('userData')
      : path.resolve(__dirname, '../../../../');
    return path.join(base, 'memory', 'rag-index.json');
  } catch {
    return path.resolve(__dirname, '../../../../memory/rag-index.json');
  }
}

function saveStore(): void {
  try {
    const p = getRagStorePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(ragStore, null, 2), 'utf-8');
  } catch { /* non-fatal — in-memory index still works */ }
}

function loadStore(): void {
  try {
    const p = getRagStorePath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      ragStore.chunks = data.chunks ?? [];
      ragStore.idf    = data.idf    ?? {};
      ragStore.docIds = data.docIds ?? [];
    }
  } catch { /* start fresh on parse error */ }
}

loadStore();

// ── Text extraction ────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB guard

async function extractText(filePath: string): Promise<string> {
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_FILE_BYTES) {
    throw new Error(`File too large (${Math.round(stats.size / 1024 / 1024)} MB) — max 10 MB for indexing`);
  }

  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse');
    const buf = fs.readFileSync(filePath);
    const result = await pdfParse(buf);
    return result.text as string;
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  // All text-based files (code, markdown, CSV, JSON, etc.)
  return fs.readFileSync(filePath, 'utf-8');
}

// ── Chunking ───────────────────────────────────────────────────────────────

const CHUNK_WORDS   = 200;
const OVERLAP_WORDS =  40;

export function chunkText(text: string): string[] {
  // Split on paragraph breaks or sentence ends; fall back to raw words
  const segments = text.split(/(?<=[.!?])\s+|\n{2,}/).map(s => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let window: string[] = [];
  let wCount = 0;

  for (const seg of segments) {
    const words = seg.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    if (wCount + words.length > CHUNK_WORDS && window.length > 0) {
      chunks.push(window.join(' '));
      // Keep overlap so context isn't lost at chunk boundaries
      const keep = window.join(' ').split(/\s+/).slice(-OVERLAP_WORDS);
      window  = keep;
      wCount  = keep.length;
    }
    window.push(...words);
    wCount += words.length;
  }
  if (window.length > 0) chunks.push(window.join(' '));
  return chunks;
}

// ── TF-IDF utilities ───────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','shall',
  'that','this','these','those','it','its','from','by','up','out','as',
  'into','than','then','about','also','not','no','so','if','all','each',
  'can','just','over','some','such','more','other','after','before','what',
  'which','who','how','when','where','why','they','their','them','we','our',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function computeTf(tokens: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tokens) counts[t] = (counts[t] ?? 0) + 1;
  const total = tokens.length || 1;
  const tf: Record<string, number> = {};
  for (const k in counts) tf[k] = counts[k] / total;
  return tf;
}

function rebuildIdf(): void {
  const N = ragStore.chunks.length || 1;
  const df: Record<string, number> = {};
  for (const chunk of ragStore.chunks) {
    for (const term in chunk.tf) df[term] = (df[term] ?? 0) + 1;
  }
  ragStore.idf = {};
  for (const term in df) {
    ragStore.idf[term] = Math.log((N + 1) / (df[term] + 1)) + 1; // smoothed IDF
  }
}

function tfidfVec(tf: Record<string, number>): Record<string, number> {
  const vec: Record<string, number> = {};
  for (const term in tf) {
    vec[term] = tf[term] * (ragStore.idf[term] ?? 1);
  }
  return vec;
}

export function cosineSim(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0, magA = 0, magB = 0;
  for (const k in a) { dot += a[k] * (b[k] ?? 0); magA += a[k] * a[k]; }
  for (const k in b) magB += b[k] * b[k];
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Tool definitions ───────────────────────────────────────────────────────

export const ragToolDefs: ToolDefinition[] = [
  {
    name: 'rag_index',
    description:
      'Index a local document (PDF, Word .docx, plain text, code, CSV, Markdown, etc.) ' +
      'so you can ask questions about it. Call rag_query afterwards to search the content. ' +
      'The index persists between sessions.',
    category: 'document',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to index (e.g. Desktop/report.pdf, ~/Documents/notes.txt)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'rag_query',
    description:
      'Search semantically across all indexed documents (or one specific document) using a ' +
      'natural-language question or phrase. Returns the most relevant excerpts. ' +
      'Use this to answer questions about files that were previously indexed with rag_index.',
    category: 'document',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The question or search phrase',
        },
        doc_id: {
          type: 'string',
          description: 'Optional: restrict search to one document (use doc_id from rag_list)',
        },
        top_k: {
          type: 'number',
          description: 'Number of chunks to return (default 4, max 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'rag_list',
    description: 'List all documents currently in the RAG index.',
    category: 'document',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'rag_clear',
    description: 'Remove a specific document from the RAG index to free memory.',
    category: 'document',
    parameters: {
      type: 'object',
      properties: {
        doc_id: {
          type: 'string',
          description: 'Document ID to remove (get it from rag_list)',
        },
      },
      required: ['doc_id'],
    },
  },
];

// ── Tool handlers ──────────────────────────────────────────────────────────

export const ragToolHandlers: Record<string, ToolHandler> = {

  rag_index: async (args): Promise<ToolResult> => {
    assertPermission('read_file');
    const rawPath = (args.path as string)?.trim();
    if (!rawPath) return { success: false, error: 'path is required' };

    const resolved = path.resolve(resolveUserPath(rawPath));
    const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (HOME && !resolved.toLowerCase().startsWith(HOME.toLowerCase())) {
      return { success: false, error: `Access denied: file must be within your home directory (${HOME})` };
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, error: `File not found: ${resolved}` };
    }
    if (fs.statSync(resolved).isDirectory()) {
      return { success: false, error: 'Path points to a directory — please specify a file' };
    }

    const filename = path.basename(resolved);
    // Deterministic ID based on the absolute path
    const docId = `rag:${resolved.replace(/\\/g, '/').replace(/[^a-zA-Z0-9/._-]/g, '_')}`;

    // Remove any stale chunks for this document before re-indexing
    ragStore.chunks = ragStore.chunks.filter(c => c.docId !== docId);
    ragStore.docIds = ragStore.docIds.filter(id => id !== docId);

    let text: string;
    try {
      text = await extractText(resolved);
    } catch (err: any) {
      return { success: false, error: `Could not read file: ${err.message}` };
    }

    const rawChunks = chunkText(text);
    if (rawChunks.length === 0) {
      return { success: false, error: 'File appears to be empty or contains no readable text' };
    }

    // Build TF vectors first (instant, always available)
    const newChunks: RagChunk[] = rawChunks.map((text, i) => ({
      docId, filename, chunkIndex: i,
      text,
      tf: computeTf(tokenize(text)),
    }));

    // Attempt semantic embedding via Ollama (non-blocking; falls back to TF-IDF only)
    const textsToEmbed = rawChunks.slice(0, MAX_EMBED_BATCH);
    const embeddings = await batchEmbed(textsToEmbed);
    let embeddedCount = 0;
    for (let i = 0; i < embeddings.length; i++) {
      if (embeddings[i]) {
        newChunks[i].embedding = embeddings[i]!;
        embeddedCount++;
      }
    }
    if (embeddedCount > 0) {
      console.log(`[RAG] Embedded ${embeddedCount}/${rawChunks.length} chunks via ${EMBEDDING_MODEL}`);
    } else {
      console.log(`[RAG] Embedding unavailable — using TF-IDF only (pull ${EMBEDDING_MODEL} for semantic search)`);
    }

    ragStore.chunks.push(...newChunks);
    ragStore.docIds.push(docId);
    rebuildIdf();
    saveStore();

    return {
      success: true,
      result: {
        doc_id: docId,
        filename,
        chunks_indexed: rawChunks.length,
        embedded: embeddedCount,
        total_chunks_in_index: ragStore.chunks.length,
        message: `Indexed ${rawChunks.length} chunks from "${filename}"${embeddedCount > 0 ? ` (${embeddedCount} semantically embedded)` : ' (TF-IDF only — pull nomic-embed-text for semantic search)'}. Use rag_query to ask questions about it.`,
      },
    };
  },

  rag_query: async (args): Promise<ToolResult> => {
    const query = (args.query as string)?.trim();
    if (!query) return { success: false, error: 'query is required' };
    if (ragStore.chunks.length === 0) {
      return { success: false, error: 'No documents indexed yet. Use rag_index to index a file first.' };
    }

    const topK       = Math.min(Math.max(1, (args.top_k as number) || 4), 10);
    const filterDocId = (args.doc_id as string) || undefined;

    let candidates = ragStore.chunks;
    if (filterDocId) {
      candidates = candidates.filter(c => c.docId === filterDocId);
      if (candidates.length === 0) {
        return { success: false, error: `No chunks found for doc_id "${filterDocId}". Run rag_list to see available documents.` };
      }
    }

    // ── Keyword scores (TF-IDF cosine similarity) ──
    const queryVec = tfidfVec(computeTf(tokenize(query)));
    const keywordScored = candidates
      .map((chunk, idx) => ({ idx, score: cosineSim(queryVec, tfidfVec(chunk.tf)) }))
      .sort((a, b) => b.score - a.score);

    // ── Semantic scores (embedding cosine similarity, if available) ──
    const hasEmbeddings = candidates.some(c => c.embedding);
    let semanticScored: { idx: number; score: number }[] = [];
    let searchMode: 'hybrid' | 'keyword' = 'keyword';

    if (hasEmbeddings) {
      const queryEmbedding = await getEmbedding(query);
      if (queryEmbedding) {
        searchMode = 'hybrid';
        semanticScored = candidates
          .map((chunk, idx) => ({
            idx,
            score: chunk.embedding ? vectorCosineSim(queryEmbedding, chunk.embedding) : 0,
          }))
          .sort((a, b) => b.score - a.score);
      }
    }

    // ── Reciprocal Rank Fusion (RRF) for hybrid mode ──
    // Combines keyword and semantic rankings into a single score.
    // RRF(d) = 1/(k+rank_keyword) + 1/(k+rank_semantic)
    // k=60 is standard; higher k reduces the impact of rank differences.
    const RRF_K = 60;
    type ScoredResult = { chunk: RagChunk; score: number };
    let fused: ScoredResult[];

    if (searchMode === 'hybrid') {
      // Build rank maps (0-indexed)
      const keywordRank = new Map<number, number>();
      keywordScored.forEach(({ idx }, rank) => keywordRank.set(idx, rank));
      const semanticRank = new Map<number, number>();
      semanticScored.forEach(({ idx }, rank) => semanticRank.set(idx, rank));
      const defaultRank = candidates.length; // unranked items get worst rank

      fused = candidates.map((chunk, idx) => {
        const kRank = keywordRank.get(idx) ?? defaultRank;
        const sRank = semanticRank.get(idx) ?? defaultRank;
        const rrfScore = 1 / (RRF_K + kRank) + 1 / (RRF_K + sRank);
        return { chunk, score: rrfScore };
      }).sort((a, b) => b.score - a.score);
    } else {
      // Keyword-only fallback
      fused = keywordScored.map(({ idx, score }) => ({
        chunk: candidates[idx],
        score,
      }));
    }

    // Filter out near-zero scores; always return at least 1 result
    const MIN_RELEVANCE_SCORE = searchMode === 'hybrid' ? 0 : 0.05;
    const aboveThreshold = fused.filter(x => x.score > MIN_RELEVANCE_SCORE);
    const scored = (aboveThreshold.length > 0 ? aboveThreshold : fused.slice(0, 1)).slice(0, topK);
    const lowConfidence = aboveThreshold.length === 0;

    return {
      success: true,
      result: {
        query,
        search_mode: searchMode,
        chunks_searched: candidates.length,
        ...(lowConfidence ? { low_confidence: true, note: 'No chunks closely matched the query; showing best available result.' } : {}),
        results: scored.map(({ chunk, score }) => ({
          doc_id:      chunk.docId,
          filename:    chunk.filename,
          chunk_index: chunk.chunkIndex,
          relevance:   Math.round(score * 10000) / 10000,
          text:        chunk.text,
        })),
      },
    };
  },

  rag_list: async (): Promise<ToolResult> => {
    if (ragStore.docIds.length === 0) {
      return { success: true, result: { message: 'No documents indexed yet.', documents: [] } };
    }
    const documents = ragStore.docIds.map(id => {
      const chunks = ragStore.chunks.filter(c => c.docId === id);
      return { doc_id: id, filename: chunks[0]?.filename ?? id, chunk_count: chunks.length };
    });
    return {
      success: true,
      result: {
        total_documents: documents.length,
        total_chunks:    ragStore.chunks.length,
        documents,
      },
    };
  },

  rag_clear: async (args): Promise<ToolResult> => {
    const docId = (args.doc_id as string)?.trim();
    if (!docId) return { success: false, error: 'doc_id is required' };

    const before = ragStore.chunks.length;
    ragStore.chunks = ragStore.chunks.filter(c => c.docId !== docId);
    ragStore.docIds = ragStore.docIds.filter(id => id !== docId);

    const removed = before - ragStore.chunks.length;
    if (removed === 0) return { success: false, error: `No document found with id "${docId}"` };

    rebuildIdf();
    saveStore();
    return {
      success: true,
      result: { removed_chunks: removed, message: `Removed ${removed} chunks for "${docId}" from the RAG index.` },
    };
  },
};

// ── Auto-injection helper ──────────────────────────────────────────────────

const RAG_AUTO_THRESHOLD = 0.15;

// Cache the last query embedding to avoid re-computing for the same message
// (ragSearch is called once per user message and the query doesn't change).
let _cachedQueryEmbedding: { query: string; vec: number[] | null } | null = null;

/**
 * Search the RAG index for a user query and return the best matching chunk
 * if its relevance exceeds the threshold. Uses hybrid search (semantic +
 * keyword) when embeddings are available, falls back to TF-IDF only.
 *
 * Returns null when the index is empty or nothing is relevant — callers
 * should treat null as "no RAG context to inject".
 */
export function ragSearch(query: string, threshold = RAG_AUTO_THRESHOLD): { text: string; filename: string; score: number } | null {
  if (ragStore.chunks.length === 0) return null;

  // ── Keyword search (always available) ──
  const queryVec = tfidfVec(computeTf(tokenize(query)));
  let keywordBest: { text: string; filename: string; score: number } | null = null;
  for (const chunk of ragStore.chunks) {
    const score = cosineSim(queryVec, tfidfVec(chunk.tf));
    if (score >= threshold && (!keywordBest || score > keywordBest.score)) {
      keywordBest = { text: chunk.text, filename: chunk.filename, score };
    }
  }

  // ── Semantic search (if any chunks have embeddings) ──
  // Use cached embedding for the same query to avoid redundant Ollama calls.
  // Since ragSearch is synchronous in the caller, we can only use the cache
  // if a prior async call pre-warmed it. Otherwise keyword-only is returned.
  const hasEmbeddings = ragStore.chunks.some(c => c.embedding);
  if (hasEmbeddings && _cachedQueryEmbedding?.query === query && _cachedQueryEmbedding.vec) {
    const qVec = _cachedQueryEmbedding.vec;
    let semanticBest: { text: string; filename: string; score: number } | null = null;
    for (const chunk of ragStore.chunks) {
      if (!chunk.embedding) continue;
      const score = vectorCosineSim(qVec, chunk.embedding);
      if (!semanticBest || score > semanticBest.score) {
        semanticBest = { text: chunk.text, filename: chunk.filename, score };
      }
    }
    // Return semantic result if it's better, else keyword
    if (semanticBest && (!keywordBest || semanticBest.score > 0.3)) {
      return semanticBest;
    }
  }

  return keywordBest;
}

/**
 * Pre-warm the embedding cache for ragSearch. Call this asynchronously
 * before ragSearch so the synchronous function can use cached embeddings.
 */
export async function ragSearchWarmup(query: string): Promise<void> {
  if (ragStore.chunks.length === 0 || !ragStore.chunks.some(c => c.embedding)) return;
  const vec = await getEmbedding(query);
  _cachedQueryEmbedding = { query, vec };
}
