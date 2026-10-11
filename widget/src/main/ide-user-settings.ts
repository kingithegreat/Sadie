/**
 * User-level IDE settings file: <userData>/settings.json (JSON with comments).
 * Read-only from the main process; a missing or invalid file means defaults.
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export const IDE_SETTINGS_MAX_BYTES = 256 * 1024;
export function ideUserSettingsPath(): string { return path.join(app.getPath('userData'), 'settings.json'); }

/** Strip // and /* *\/ comments and trailing commas, leaving string contents intact. */
export function stripJsonComments(text: string): string {
  let out = '', inString = false, quote = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index], next = text[index + 1];
    if (inString) { out += character; if (character === '\\') { out += next ?? ''; index++; } else if (character === quote) inString = false; continue; }
    if (character === '"') { inString = true; quote = character; out += character; continue; }
    if (character === '/' && next === '/') { while (index < text.length && text[index] !== '\n') index++; out += '\n'; continue; }
    if (character === '/' && next === '*') { index += 2; while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) { if (text[index] === '\n') out += '\n'; index++; } index++; continue; }
    out += character;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

let cache: { file: string; mtimeMs: number; size: number; value: Record<string, unknown> } | undefined;
/** Parsed raw object (unvalidated). Callers validate the keys they consume. */
export function readIdeUserSettingsRaw(file = ideUserSettingsPath()): { value: Record<string, unknown>; error?: string } {
  try {
    const stat = fs.statSync(file);
    if (cache && cache.file === file && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return { value: cache.value };
    if (stat.size > IDE_SETTINGS_MAX_BYTES) return { value: {}, error: `settings.json is larger than ${IDE_SETTINGS_MAX_BYTES / 1024} KB and was ignored.` };
    const parsed = JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8')));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { value: {}, error: 'settings.json must contain a JSON object ({ ... }).' };
    cache = { file, mtimeMs: stat.mtimeMs, size: stat.size, value: parsed };
    return { value: parsed };
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { value: {} };
    return { value: {}, error: `settings.json could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}
export function resetIdeUserSettingsCache(): void { cache = undefined; }
