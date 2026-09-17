/**
 * problem-report.ts — "Report a problem": one readable text file a tester can
 * send, with what is needed to understand a failure and nothing secret.
 *
 * Contents: app/OS/hardware facts, the settings with every secret removed,
 * the tail of each log, and a summary of media jobs (state and last error).
 * Secrets are removed twice: settings fields whose NAME says key/token/secret/
 * password/credential, and any key-shaped VALUE anywhere in the text (API keys,
 * bearer tokens, private keys), because logs quote things settings never meant
 * to expose.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const REDACTED = '[removed]';

const SECRET_NAME = /(api[-_]?key|apikey|token|secret|password|passwd|credential|auth(?!or)|cookie|private[-_]?key|client[-_]?secret|session[-_]?id|bearer)/i;

/** Key-shaped values from the providers HomeBot talks to, plus generic bearer/basic tokens. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{30,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /hf_[A-Za-z0-9]{30,}/g,
  /gsk_[A-Za-z0-9]{30,}/g,
  /ya29\.[A-Za-z0-9_-]{20,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /enc:v1:[A-Za-z0-9+/=]{8,}/g,
  /(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** Replace every key-shaped value in free text. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, match => (/^(Bearer|Basic)\s/i.test(match) ? `${match.split(/\s+/)[0]} ${REDACTED}` : REDACTED));
  }
  return out;
}

/** A deep copy with secret-named fields removed and key-shaped strings scrubbed. */
export function redactSettings(value: unknown, depth = 0): unknown {
  if (depth > 12) return REDACTED;
  if (Array.isArray(value)) return value.map(item => redactSettings(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      // A secret is never a boolean or a number (maxTokens, useAuth: true stay readable).
      if (SECRET_NAME.test(key) && v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && typeof v !== 'number') {
        out[key] = REDACTED;
      } else {
        out[key] = redactSettings(v, depth + 1);
      }
    }
    return out;
  }
  return typeof value === 'string' ? scrubSecrets(value) : value;
}

export interface ProblemReportInputs {
  appVersion: string;
  generatedAt: Date;
  platform: { os: string; release: string; arch: string; cpu: string; cores: number; memoryGb: number };
  gpus?: string[];
  settings: unknown;
  logs: Array<{ name: string; tail: string }>;
  mediaJobs: Array<{ title: string; state: string; error?: string | null; updatedAt?: string }>;
  /** Result of the existing health checks (diagnostics.ts): disk, services, write access, GPU. */
  diagnostics?: unknown;
  note?: string;
}

/** The whole report as text. Every free-text part is scrubbed again on the way out. */
export function buildProblemReport(input: ProblemReportInputs): string {
  const lines: string[] = [];
  lines.push('HomeBot problem report', '======================', '');
  lines.push(`Created: ${input.generatedAt.toISOString()}`);
  lines.push(`HomeBot version: ${input.appVersion}`);
  const p = input.platform;
  lines.push(`System: ${p.os} ${p.release} (${p.arch}), ${p.cpu}, ${p.cores} threads, ${p.memoryGb} GB RAM`);
  if (input.gpus?.length) lines.push(`Graphics: ${input.gpus.join('; ')}`);
  if (input.note?.trim()) lines.push('', 'What happened (from the person reporting):', input.note.trim());
  lines.push('', 'Secrets (API keys, tokens, passwords) have been removed from this report.', '');
  lines.push('Settings', '--------', JSON.stringify(redactSettings(input.settings), null, 2), '');
  if (input.diagnostics !== undefined) {
    lines.push('Health checks', '-------------', JSON.stringify(redactSettings(input.diagnostics), null, 2), '');
  }
  lines.push('Media Studio videos', '-------------------');
  if (input.mediaJobs.length === 0) lines.push('(none)');
  for (const job of input.mediaJobs.slice(-30)) {
    lines.push(`- ${job.title} — ${job.state}${job.updatedAt ? ` (updated ${job.updatedAt})` : ''}${job.error ? ` — last error: ${job.error}` : ''}`);
  }
  lines.push('');
  for (const log of input.logs) {
    lines.push(`Log: ${log.name} (most recent lines)`, '-'.repeat(8 + log.name.length), log.tail || '(empty)', '');
  }
  return scrubSecrets(lines.join('\n'));
}

/** The last `maxLines` lines of a file, capped in bytes so a huge log cannot bloat the report. */
export function tailFile(file: string, maxLines = 200, maxBytes = 64 * 1024): string {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split(/\r?\n/);
      if (start > 0) lines.shift(); // first line may be cut mid-way
      return lines.slice(-maxLines).join('\n').trim();
    } finally { fs.closeSync(fd); }
  } catch {
    return '';
  }
}

/** Write the report into a folder the person can find, and return its path. */
export function writeProblemReport(input: ProblemReportInputs, folder: string): string {
  fs.mkdirSync(folder, { recursive: true });
  const stamp = input.generatedAt.toISOString().replace(/[:.]/g, '-');
  const file = path.join(folder, `homebot-problem-report-${stamp}.txt`);
  fs.writeFileSync(file, buildProblemReport(input), 'utf8');
  return file;
}

/** Plain system facts for the report. */
export function platformFacts(): ProblemReportInputs['platform'] {
  const cpus = os.cpus();
  return {
    os: os.type(), release: os.release(), arch: os.arch(),
    cpu: cpus[0]?.model?.trim() || 'unknown CPU', cores: cpus.length,
    memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
  };
}
