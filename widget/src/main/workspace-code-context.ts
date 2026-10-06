import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { getSettings } from './config-manager';
import { canonicalWorkspacePath, validateWorkspaceRoot, withinRoot } from './workspace-context';

const IGNORE = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.next', '.venv', '__pycache__']);
const CODE = /\.(?:ts|tsx|js|jsx|json|py|lua|luau|rs|go|java|cs|c|cpp|h|css|html|md|yml|yaml|sql|sh|ps1)$/i;
export function readWorkspaceRules(rootInput: unknown) {
  const root = validateWorkspaceRoot(rootInput), candidates = ['AGENTS.md', 'CLAUDE.md', '.cursorrules'];
  try { for (const item of fs.readdirSync(path.join(root, '.cursor', 'rules'))) if (/\.(md|mdc)$/i.test(item)) candidates.push(`.cursor/rules/${item}`); } catch { /* optional */ }
  let remaining = 40_000;
  return candidates.slice(0, 30).flatMap(name => {
    try {
      const file = canonicalWorkspacePath(path.join(root, name));
      if (!withinRoot(root, file) || fs.statSync(file).size > 100_000 || remaining <= 0) return [];
      const text = fs.readFileSync(file, 'utf8').slice(0, remaining); remaining -= text.length;
      return [{ path: file, text }];
    } catch { return []; }
  });
}
const tokens = (text: string) => text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
const vectors = new Map<string, number[]>();
const cosine = (a: number[], b: number[]) => {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
};
/** A bounded fresh scan on every query; saved/removed bytes never serve stale chunks. */
export async function searchWorkspaceCode(rootInput: unknown, query: unknown, semantic = false) {
  const root = validateWorkspaceRoot(rootInput);
  if (typeof query !== 'string' || !query.trim() || query.length > 4000) throw new Error('Enter a codebase question of up to 4,000 characters.');
  const terms = new Set(tokens(query)), chunks: Array<{ path: string; line: number; text: string; score: number }> = [];
  let files = 0, bytes = 0, capped = false;
  function walk(folder: string, depth: number) {
    if (depth > 12 || files >= 400 || bytes >= 4 * 1024 * 1024) { capped = true; return; }
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (files >= 400 || bytes >= 4 * 1024 * 1024) { capped = true; break; }
      const file = path.join(folder, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) { if (!IGNORE.has(item.name)) walk(file, depth + 1); continue; }
      if (!CODE.test(item.name) || /^(?:\.env|.*\.(?:pem|key))/.test(item.name)) continue;
      const canonical = canonicalWorkspacePath(file);
      if (!withinRoot(root, canonical)) continue;
      const size = fs.statSync(file).size;
      if (size > 100_000 || bytes + size > 4 * 1024 * 1024) { capped = true; continue; }
      const text = fs.readFileSync(file, 'utf8'); if (text.includes('\0')) continue;
      files++; bytes += size;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 60) {
        const body = lines.slice(i, i + 80).join('\n'), words = tokens(body + ' ' + item.name);
        const score = words.reduce((sum, word) => sum + (terms.has(word) ? 1 : 0), 0) / Math.sqrt(Math.max(1, words.length));
        chunks.push({ path: file, line: i + 1, text: body, score });
      }
    }
  }
  walk(root, 0);
  chunks.sort((a, b) => b.score - a.score);
  let mode = 'local keyword search', note: string | undefined;
  // Explicit opt-in, loopback only, already-installed model only. No downloads.
  if (semantic) {
    try {
      const endpoint = new URL(getSettings().ollamaUrl || 'http://127.0.0.1:11434');
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('Semantic indexing requires a local model endpoint.');
      const base = endpoint.origin;
      const tags = await axios.get(`${base}/api/tags`, { timeout: 2000, maxRedirects: 0 });
      if (!(tags.data?.models || []).some((model: any) => /^nomic-embed-text(?::|$)/.test(model.name))) throw new Error('No installed local embedding model. Keyword search remains available.');
      const embed = async (text: string) => {
        const cached = vectors.get(text); if (cached) return cached;
        const result = await axios.post(`${base}/api/embeddings`, { model: 'nomic-embed-text', prompt: text.slice(0, 8000), keep_alive: 0 }, { timeout: 4000, maxRedirects: 0 });
        const vector = result.data?.embedding;
        if (!Array.isArray(vector) || vector.length > 4096 || !vector.length || vector.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('The local embedding model returned no usable vector.');
        if (vectors.size >= 96) vectors.clear(); vectors.set(text, vector); return vector;
      };
      const q = await embed(query);
      // One request at a time, max 12 candidate chunks, max 10s per search.
      const start = Date.now();
      for (const chunk of chunks.slice(0, 12)) {
        if (Date.now() - start > 10_000) { capped = true; break; }
        chunk.score += cosine(q, await embed(chunk.text));
      }
      chunks.sort((a, b) => b.score - a.score); mode = 'local semantic + keyword search';
    } catch (error) { note = (error as Error).message; }
  }
  return { matches: chunks.filter(chunk => chunk.score > 0).slice(0, 6), mode, note, capped, files, bytes };
}
