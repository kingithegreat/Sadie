/**
 * SADIE RAG (Retrieval-Augmented Generation) Tools
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
import { ToolDefinition, ToolHandler, ToolResult } from './types';
import { resolveUserPath } from './filesystem';
import { assertPermission } from '../config-manager';

// ── Types ──────────────────────────────────────────────────────────────────

interface RagChunk {
  docId: string;
  filename: string;
  chunkIndex: number;
  text: string;
  tf: Record<string, number>; // term → raw TF score
}

interface RagStore {
  chunks: RagChunk[];
  idf: Record<string, number>; // term → IDF score (rebuilt after every index/clear)
  docIds: string[];            // ordered list of all indexed doc IDs
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

    for (let i = 0; i < rawChunks.length; i++) {
      ragStore.chunks.push({
        docId, filename, chunkIndex: i,
        text: rawChunks[i],
        tf: computeTf(tokenize(rawChunks[i])),
      });
    }
    ragStore.docIds.push(docId);
    rebuildIdf();
    saveStore();

    return {
      success: true,
      result: {
        doc_id: docId,
        filename,
        chunks_indexed: rawChunks.length,
        total_chunks_in_index: ragStore.chunks.length,
        message: `Indexed ${rawChunks.length} chunks from "${filename}". Use rag_query to ask questions about it.`,
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

    const queryVec = tfidfVec(computeTf(tokenize(query)));
    // Filter out near-zero scores (incidental term overlap, statistical noise).
    // Always return at least 1 result (best available) so the call never comes back empty.
    const MIN_RELEVANCE_SCORE = 0.05;
    const allScored = candidates
      .map(chunk => ({ chunk, score: cosineSim(queryVec, tfidfVec(chunk.tf)) }))
      .sort((a, b) => b.score - a.score);
    const aboveThreshold = allScored.filter(x => x.score >= MIN_RELEVANCE_SCORE);
    const scored = (aboveThreshold.length > 0 ? aboveThreshold : allScored.slice(0, 1)).slice(0, topK);
    const lowConfidence = aboveThreshold.length === 0;

    return {
      success: true,
      result: {
        query,
        chunks_searched: candidates.length,
        ...(lowConfidence ? { low_confidence: true, note: 'No chunks closely matched the query; showing best available result.' } : {}),
        results: scored.map(({ chunk, score }) => ({
          doc_id:      chunk.docId,
          filename:    chunk.filename,
          chunk_index: chunk.chunkIndex,
          relevance:   Math.round(score * 1000) / 1000,
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
