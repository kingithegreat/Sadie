import type { PerfStatSummary } from './types';

/**
 * Pure builder for a copy-pasteable diagnostics "support report".
 *
 * Combines the locally-collected perf aggregates and the on-demand system
 * check into a single Markdown block so a user can paste a complete snapshot
 * of their environment when reporting an issue. No DOM / Electron access —
 * the caller supplies the data, which keeps this unit-testable.
 */

export interface SupportReportService {
  reachable: boolean;
  latencyMs: number | null;
}

export interface SupportReportSystemCheck {
  disk: { freeGB: number | null; ok: boolean; warning: string | null };
  ollama: SupportReportService;
  n8n: SupportReportService;
  qdrant: SupportReportService;
  permissions: { canWrite: boolean };
  hardware: { vramGB: number | null; gpuName: string | null; profile: string | null };
  timestamp: string;
}

export interface SupportReportInput {
  generatedAt?: string;
  appVersion?: string | null;
  platform?: string | null;
  perf?: { startup: PerfStatSummary; firstToken: PerfStatSummary } | null;
  systemCheck?: SupportReportSystemCheck | null;
}

function fmtMs(n: number | null | undefined): string {
  return n === null || n === undefined ? 'n/a' : `${Math.round(n)} ms`;
}

function serviceLine(label: string, s?: SupportReportService): string {
  if (!s) return `- ${label}: not checked`;
  const latency = s.latencyMs != null ? ` (${Math.round(s.latencyMs)} ms)` : '';
  return `- ${label}: ${s.reachable ? 'online' : 'offline'}${latency}`;
}

export function buildSupportReport(input: SupportReportInput): string {
  const lines: string[] = [];
  lines.push('# HomeBot — Support Report');
  lines.push('');
  lines.push(`- Generated: ${input.generatedAt ?? 'unknown'}`);
  lines.push(`- App version: ${input.appVersion ?? 'unknown'}`);
  lines.push(`- Platform: ${input.platform ?? 'unknown'}`);
  lines.push('');

  lines.push('## Performance');
  if (input.perf && (input.perf.startup.count > 0 || input.perf.firstToken.count > 0)) {
    const row = (label: string, s: PerfStatSummary) =>
      `- ${label}: p50 ${fmtMs(s.p50_ms)} · p95 ${fmtMs(s.p95_ms)} · avg ${fmtMs(s.avg_ms)} (n=${s.count})`;
    lines.push(row('Startup', input.perf.startup));
    lines.push(row('First token (TTFT)', input.perf.firstToken));
  } else {
    lines.push('- No performance samples recorded yet.');
  }
  lines.push('');

  lines.push('## System check');
  const sc = input.systemCheck;
  if (sc) {
    lines.push(`- Last run: ${sc.timestamp}`);
    const disk = sc.disk.freeGB != null ? `${sc.disk.freeGB.toFixed(1)} GB free` : 'unknown';
    lines.push(`- Disk: ${disk}${sc.disk.ok ? '' : ' (LOW)'}${sc.disk.warning ? ` — ${sc.disk.warning}` : ''}`);
    lines.push(serviceLine('Ollama', sc.ollama));
    lines.push(serviceLine('n8n', sc.n8n));
    lines.push(serviceLine('Qdrant', sc.qdrant));
    lines.push(`- Write permissions: ${sc.permissions.canWrite ? 'OK' : 'CANNOT WRITE'}`);
    const gpu = sc.hardware.vramGB != null
      ? `${sc.hardware.gpuName ?? 'GPU'} · ${sc.hardware.vramGB} GB${sc.hardware.profile ? ` · ${sc.hardware.profile}` : ''}`
      : 'not detected';
    lines.push(`- GPU: ${gpu}`);
  } else {
    lines.push('- Not run. Use "Run system check" in Settings → Diagnostics first.');
  }
  lines.push('');

  return lines.join('\n');
}
