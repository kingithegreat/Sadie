/**
 * The renderer's context windows must agree with the ones main actually uses.
 *
 * They were separate tables and they disagreed. main's MODEL_METADATA knew
 * claude-opus-5 has a 1,000,000-token window; the renderer's TokenCounter had
 * an Ollama-only table whose fuzzy match compares against `key.split(':')[0]`,
 * which no Claude id can match. Every cloud model fell through to an 8192
 * default, so on Opus 5 the counter sat near 100% full while 992k of the
 * window went unused.
 *
 * The renderer cannot import from main, so the shared table exists — and this
 * pins it to main's, because two tables that must agree and are never compared
 * will drift again.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CLOUD_CONTEXT_WINDOWS, getCloudContextLimit } from '../model-context';

/**
 * Read main's table from source rather than importing it: custom-llm-client
 * pulls in electron and the whole main-process graph, which a shared test has
 * no business loading.
 */
function contextWindowsFromMain(): Record<string, number> {
  const file = path.resolve(__dirname, '..', '..', 'main', 'custom-llm-client.ts');
  const src = fs.readFileSync(file, 'utf-8');
  const out: Record<string, number> = {};
  const re = /'([a-z0-9.\-]+)':\s*\{[^}]*contextWindow:\s*([0-9_]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out[m[1]] = Number(m[2].replace(/_/g, ''));
  }
  return out;
}

describe('cloud context windows', () => {
  const fromMain = contextWindowsFromMain();

  it('finds main\'s metadata at all', () => {
    // If this breaks, the parse below is silently checking nothing.
    expect(Object.keys(fromMain).length).toBeGreaterThan(5);
    expect(fromMain['claude-opus-5']).toBe(1_000_000);
  });

  it.each(Object.keys(CLOUD_CONTEXT_WINDOWS))('%s matches main', (model) => {
    // Only assert where main has an opinion; the shared table may carry ids
    // main has not needed yet.
    if (fromMain[model] === undefined) return;
    expect(CLOUD_CONTEXT_WINDOWS[model]).toBe(fromMain[model]);
  });

  it('resolves a dated model id to its family, not an older sibling', () => {
    // Longest-prefix, or "claude-opus-5-20260101" lands on claude-opus-4.
    expect(getCloudContextLimit('claude-opus-5-20260101')).toBe(1_000_000);
    expect(getCloudContextLimit('claude-opus-4-1')).toBe(200_000);
  });

  it('returns null for a local model, leaving the Ollama table in charge', () => {
    expect(getCloudContextLimit('qwen2.5:7b')).toBeNull();
    expect(getCloudContextLimit('')).toBeNull();
  });
});
