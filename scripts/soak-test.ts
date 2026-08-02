/**
 * Soak test CLI (Phase 0 — reliability)
 *
 * Runs the supervisor against the real local services (Ollama, n8n, Qdrant)
 * for a wall-clock duration, then writes a JSON report and exits 0/1 on the
 * verdict. This is the harness for the 24-hour soak on a real machine.
 *
 * Usage (from repo root):
 *   npm run soak                       # 2-minute smoke soak
 *   npm run soak -- --minutes 1440     # the real 24-hour soak
 *   npm run soak -- --minutes 60 --sample-seconds 30
 *
 * Env overrides: OLLAMA_URL, N8N_URL, QDRANT_URL.
 * Ollama and n8n are `required` (they gate the verdict); Qdrant is monitored
 * report-only. n8n gets an automatic recovery action (`docker start
 * homebot-n8n`), mirroring the app's startup lifecycle behaviour.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { runSoak } from '../src/supervisor/soak';
import { ServiceSpec, SoakReport } from '../src/supervisor/types';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const N8N_CONTAINER = 'homebot-n8n';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return null;
}

/** GET the URL; resolve true on any HTTP response < 500 within timeoutMs. */
function httpProbe(url: string, timeoutMs = 3_000): () => Promise<boolean> {
  return () =>
    new Promise<boolean>((resolve) => {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        resolve(res.statusCode !== undefined && res.statusCode < 500);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
}

/** Recovery for n8n: `docker start homebot-n8n` (same container the app manages). */
function dockerStartN8n(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile('docker', ['start', N8N_CONTAINER], { timeout: 20_000 }, (err) => {
      if (err) reject(new Error(`docker start ${N8N_CONTAINER} failed: ${err.message}`));
      else resolve();
    });
  });
}

function fmtBytes(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function printReport(report: SoakReport): void {
  console.log('\n──── Soak report ────');
  console.log(`Duration: ${(report.durationMs / 60_000).toFixed(1)} min · samples: ${report.samples} · events: ${report.eventCount}`);
  for (const [name, s] of Object.entries(report.services)) {
    const tag = s.required ? 'required' : 'monitored';
    console.log(
      `  ${name.padEnd(8)} [${tag}] uptime ${s.uptimePct.toFixed(1).padStart(5)}%  final=${s.finalState}  transitions=${s.transitions}  failures=${s.failures}  recoveries=${s.recoveries}`
    );
  }
  console.log(
    `Memory RSS: first ${fmtBytes(report.memory.firstRssBytes)} → last ${fmtBytes(report.memory.lastRssBytes)} (peak ${fmtBytes(report.memory.peakRssBytes)}, growth ${report.memory.growthPct.toFixed(1)}%)`
  );
  console.log(`VERDICT: ${report.verdict.toUpperCase()}`);
  for (const r of report.verdictReasons) console.log(`  ✗ ${r}`);
}

async function main(): Promise<void> {
  const minutes = parseFloat(arg('minutes') ?? '2');
  const sampleSeconds = parseFloat(arg('sample-seconds') ?? '60');
  if (!isFinite(minutes) || minutes <= 0) {
    console.error('Invalid --minutes value');
    process.exit(2);
  }

  const services: ServiceSpec[] = [
    {
      name: 'ollama',
      required: true,
      probe: httpProbe(OLLAMA_URL),
      // No safe cross-platform auto-restart for Ollama (runs as a user app /
      // OS service) — supervised report-only. The report shows the outage.
    },
    {
      name: 'n8n',
      required: true,
      probe: httpProbe(N8N_URL),
      recover: dockerStartN8n,
    },
    {
      name: 'qdrant',
      required: false,
      probe: httpProbe(QDRANT_URL),
    },
  ];

  console.log(`Soak: ${minutes} min · sampling every ${sampleSeconds}s`);
  console.log(`  ollama  ${OLLAMA_URL} (required)`);
  console.log(`  n8n     ${N8N_URL} (required, auto-recover via docker)`);
  console.log(`  qdrant  ${QDRANT_URL} (monitored)`);

  const report = await runSoak({
    services,
    durationMs: Math.round(minutes * 60_000),
    sampleIntervalMs: Math.round(sampleSeconds * 1_000),
    onSample: (s) => {
      const states = Object.entries(s.states)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      console.log(`[${new Date(s.at).toISOString()}] rss=${fmtBytes(s.rssBytes)} ${states}`);
    },
  });

  printReport(report);

  const logsDir = path.join(__dirname, '..', 'logs');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const file = path.join(logsDir, `soak-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`Report written: ${file}`);
  } catch (e) {
    console.warn('Could not write report file:', e instanceof Error ? e.message : String(e));
  }

  process.exit(report.verdict === 'pass' ? 0 : 1);
}

void main();
