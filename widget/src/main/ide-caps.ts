/**
 * IDE safety caps. Each cap is configurable in settings.json ("ide.caps.*"),
 * but only within a safe range; out-of-range values are clamped with a notice.
 */
import { readIdeUserSettingsRaw } from './ide-user-settings';

export interface IdeCaps {
  /** Files indexed for Quick Open and the TypeScript language service. */
  maxFiles: number;
  /** Largest single file the language service will read. */
  maxFileBytes: number;
  /** Deepest folder level indexed. */
  maxDepth: number;
  /** File-finder time budget. */
  findTimeoutMs: number;
  /** Largest file the editor opens or saves. */
  maxEditableBytes: number;
}
const MB = 1024 * 1024;
export const IDE_CAP_DEFAULTS: IdeCaps = { maxFiles: 2000, maxFileBytes: 2 * MB, maxDepth: 30, findTimeoutMs: 2000, maxEditableBytes: 2 * MB };
export const IDE_CAP_LIMITS: Record<keyof IdeCaps, { min: number; max: number }> = {
  maxFiles: { min: 100, max: 20_000 },
  maxFileBytes: { min: 64 * 1024, max: 10 * MB },
  maxDepth: { min: 2, max: 64 },
  findTimeoutMs: { min: 250, max: 10_000 },
  maxEditableBytes: { min: 64 * 1024, max: 10 * MB },
};

export function clampIdeCaps(input: unknown): { caps: IdeCaps; warnings: string[] } {
  const caps = { ...IDE_CAP_DEFAULTS }, warnings: string[] = [];
  if (input === undefined) return { caps, warnings };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { caps, warnings: ['"ide.caps" must be an object; defaults are used.'] };
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(name in IDE_CAP_LIMITS)) { warnings.push(`Unknown cap "ide.caps.${name}" was ignored.`); continue; }
    const capName = name as keyof IdeCaps, limit = IDE_CAP_LIMITS[capName];
    if (typeof value !== 'number' || !Number.isFinite(value)) { warnings.push(`"ide.caps.${name}" must be a number; the default ${IDE_CAP_DEFAULTS[capName]} is used.`); continue; }
    const clamped = Math.round(Math.min(limit.max, Math.max(limit.min, value)));
    if (clamped !== value) warnings.push(`"ide.caps.${name}" ${value} is outside the safe range ${limit.min}–${limit.max}; using ${clamped}.`);
    caps[capName] = clamped;
  }
  return { caps, warnings };
}

export function getIdeCaps(): IdeCaps { return clampIdeCaps(readIdeUserSettingsRaw().value['ide.caps']).caps; }
export const formatBytes = (bytes: number) => bytes >= MB ? `${+(bytes / MB).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
