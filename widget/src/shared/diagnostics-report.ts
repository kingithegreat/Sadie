/**
 * diagnostics-report.ts — pure, dependency-free assembly of a copyable
 * plain-text diagnostics report for the Settings → Diagnostics & Performance
 * section. The "Copy diagnostics report" button hands the returned string to
 * the native clipboard so a user can paste it into a support email or GitHub
 * issue without having to dig through logs.
 *
 * Like sparkline.ts and perf-advice.ts this module has ZERO React/DOM/Electron
 * references, so the formatting, the "no data" fallbacks and the path redaction
 * are covered by fast node logic tests instead of a jsdom render. The renderer
 * just gathers the inputs (env + perf aggregates + app/runtime versions) and
 * calls buildDiagnosticsReport().
 */

import type { PerfStatSummary } from './types';
import { buildPerfAdvice } from './perf-advice';

export interface DiagnosticsReportEnv {
  isE2E?: boolean;
  isPackagedBuild?: boolean;
  isReleaseBuild?: boolean;
  userDataPath?: string;
}

export interface DiagnosticsReportInput {
  /** App version, e.g. from package.json. */
  appVersion?: string;
  /** process.platform, e.g. "win32" | "darwin" | "linux". */
  platform?: string;
  /** process.arch, e.g. "x64" | "arm64". */
  arch?: string;
  electronVersion?: string;
  nodeVersion?: string;
  chromeVersion?: string;
  env?: DiagnosticsReportEnv | null;
  /** Baseline perf aggregates from getPerfAggregates(). */
  perf?: { startup?: PerfStatSummary; firstToken?: PerfStatSummary } | null;
  /** Epoch ms the report was generated. Defaults to Date.now(). */
  generatedAt?: number;
}

const DASH = '—'; // em dash, used for "no value"

function val(s: string | undefined | null): string {
  const t = (s ?? '').toString().trim();
  return t.length ? t : DASH;
}

/** Integer ms with unit, or em-dash when there are no samples. */
function ms(stat: PerfStatSummary | undefined, key: 'p50_ms' | 'p95_ms'): string {
  if (!stat || !stat.count || stat.count <= 0) return DASH;
  const n = stat[key];
  if (!Number.isFinite(n)) return DASH;
  return `${Math.round(n)} ms`;
}

function sampleCount(stat: PerfStatSummary | undefined): number {
  return stat && Number.isFinite(stat.count) && stat.count > 0 ? stat.count : 0;
}

/**
 * Replace the user's home folder in an absolute path with `~` so the report is
 * safe to paste into a public issue. Handles Windows (`C:\Users\name\…`),
 * macOS (`/Users/name/…`) and Linux (`/home/name/…`). Idempotent and never
 * throws; returns the input unchanged when nothing matches.
 */
export function redactUserPath(p: string | undefined | null): string {
  const s = (p ?? '').toString();
  if (!s) return '';
  return s
    .replace(/^[A-Za-z]:\\Users\\[^\\/]+/i, '~')
    .replace(/^\/Users\/[^/]+/i, '~')
    .replace(/^\/home\/[^/]+/i, '~');
}

/**
 * Build a deterministic, human-readable diagnostics report. Never throws; any
 * missing field is rendered as an em-dash or a "No data yet" line so the report
 * is always well-formed even on a fresh install with no perf samples.
 */
export function buildDiagnosticsReport(input: DiagnosticsReportInput): string {
  const generatedAt = Number.isFinite(input.generatedAt as number)
    ? (input.generatedAt as number)
    : Date.now();
  const advice = buildPerfAdvice(input.perf);
  const startup = input.perf?.startup;
  const firstToken = input.perf?.firstToken;
  const env = input.env ?? {};

  const platformLine =
    val(input.platform) + (input.arch ? ` (${input.arch})` : '');

  const buildFlags: string[] = [];
  if (env.isPackagedBuild) buildFlags.push('packaged');
  if (env.isReleaseBuild) buildFlags.push('release');
  if (env.isE2E) buildFlags.push('e2e');
  const buildLine = buildFlags.length ? buildFlags.join(', ') : 'development';

  const lines: string[] = [];
  lines.push('# HomeBot diagnostics report');
  lines.push(`Generated: ${new Date(generatedAt).toISOString()}`);
  lines.push('');
  lines.push('## App');
  lines.push(`- Version: ${val(input.appVersion)}`);
  lines.push(`- Platform: ${platformLine}`);
  lines.push(`- Electron: ${val(input.electronVersion)}`);
  lines.push(`- Chrome: ${val(input.chromeVersion)}`);
  lines.push(`- Node: ${val(input.nodeVersion)}`);
  lines.push(`- Build: ${buildLine}`);
  lines.push(`- Data folder: ${val(redactUserPath(env.userDataPath) || undefined)}`);
  lines.push('');
  lines.push('## Performance (p95)');
  lines.push(`- Overall health: ${overallLabel(advice.overall)}`);
  lines.push(
    `- Startup: ${advice.startup.label} ${DASH} p95 ${ms(startup, 'p95_ms')} (p50 ${ms(startup, 'p50_ms')}, n=${sampleCount(startup)})`,
  );
  lines.push(
    `- First token: ${advice.firstToken.label} ${DASH} p95 ${ms(firstToken, 'p95_ms')} (p50 ${ms(firstToken, 'p50_ms')}, n=${sampleCount(firstToken)})`,
  );
  if (advice.hints.length) {
    lines.push('');
    lines.push('### Hints');
    for (const h of advice.hints) lines.push(`- ${h}`);
  }
  lines.push('');
  return lines.join('\n');
}

const OVERALL_LABELS: Record<string, string> = {
  good: 'Good',
  fair: 'A bit slow',
  slow: 'Slow',
  unknown: 'No data yet',
};
function overallLabel(rating: string): string {
  return OVERALL_LABELS[rating] ?? 'No data yet';
}
