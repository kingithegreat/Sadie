/**
 * Going and finding out what actually works.
 *
 * The judgement about what the answers MEAN lives in
 * `shared/capability-report.ts`, which is pure and tested. This file only does
 * the asking, so the two can be reasoned about separately: a wrong verdict is a
 * logic bug, a wrong reading is a probe bug.
 *
 * Rules this follows, taken from `agent-reach doctor`:
 *
 *  - Every probe is READ-ONLY and cheap. A diagnostic that changes state, costs
 *    money, or burns a rate limit is one people learn not to run.
 *  - A probe that cannot run reports "don't know" rather than a guess. There is
 *    no value in a green tick nobody earned.
 */

import { app } from 'electron';
import type { CapabilityInput } from '../shared/capability-report';

/** Nothing here may hang the panel; a slow service is a broken one for this purpose. */
const PROBE_TIMEOUT_MS = 4000;

async function reachable(url: string): Promise<boolean> {
  try {
    const axios = (await import('axios')).default;
    const res = await axios.get(url, { timeout: PROBE_TIMEOUT_MS, validateStatus: () => true });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Models installed locally, or null when Ollama could not be asked. */
async function ollamaModelCount(base: string): Promise<number | null> {
  try {
    const axios = (await import('axios')).default;
    const res = await axios.get(`${base}/api/tags`, { timeout: PROBE_TIMEOUT_MS });
    const models = res.data?.models;
    return Array.isArray(models) ? models.length : 0;
  } catch {
    return null;
  }
}

/**
 * Is ffmpeg actually runnable?
 *
 * Checked by running it, not by looking for a file. `render_qa` learned this
 * the hard way with ffprobe: a binary that is present but not executable, or
 * present for a different architecture, looks identical to a working one until
 * a render fails.
 */
async function ffmpegRunnable(): Promise<boolean> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    await promisify(execFile)('ffmpeg', ['-version'], { timeout: PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

function freeDiskGB(dir: string): number | null {
  try {
    // statfs is available on Electron 28+; anything older reports unknown
    // rather than pretending.
    const fs = require('fs') as typeof import('fs');
    const st = (fs as any).statfsSync?.(dir);
    if (!st) return null;
    const bytes = Number(st.bavail) * Number(st.bsize);
    return Number.isFinite(bytes) ? bytes / 1024 ** 3 : null;
  } catch {
    return null;
  }
}

export interface ProbeSettings {
  ollamaUrl?: string;
  n8nUrl?: string;
  qdrantUrl?: string;
  chatModel?: string;
  useCustomLLM?: boolean;
  webReaderFallbackEnabled?: boolean;
  [key: string]: unknown;
}

/**
 * Ask every question the report needs answering.
 *
 * Probes run in parallel — asked one at a time, four unreachable services is
 * sixteen seconds of a blank panel.
 */
export async function probeCapabilities(settings: ProbeSettings): Promise<CapabilityInput> {
  const ollamaBase = (settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const n8nBase = (settings.n8nUrl || 'http://localhost:5678').replace(/\/+$/, '');
  const qdrantBase = (settings.qdrantUrl || 'http://localhost:6333').replace(/\/+$/, '');

  const [modelCount, n8nUp, qdrantUp, ffmpeg] = await Promise.all([
    ollamaModelCount(ollamaBase),
    reachable(`${n8nBase}/healthz`),
    reachable(`${qdrantBase}/healthz`),
    ffmpegRunnable(),
  ]);

  // Which search providers are configured. Read from settings rather than by
  // searching: a probe that runs a real search spends a quota every time
  // someone opens Home.
  const configuredSearchProviders: string[] = [];
  if ((settings as any).searxngUrl) configuredSearchProviders.push('SearXNG');
  if ((settings as any).tavilyApiKey) configuredSearchProviders.push('Tavily');
  if ((settings as any).serperApiKey) configuredSearchProviders.push('Serper');
  if ((settings as any).braveApiKey) configuredSearchProviders.push('Brave');

  let cloudConfigured = false;
  try {
    const { resolveCloudLLM } = await import('../shared/cloud-llm');
    cloudConfigured = resolveCloudLLM({ ...(settings as any), useCustomLLM: true }).active;
  } catch {
    cloudConfigured = false;
  }

  return {
    ollamaReachable: modelCount !== null,
    localModelCount: modelCount ?? 0,
    localModelSelected: !!(settings.chatModel && String(settings.chatModel).trim()),

    cloudAllowed: !!settings.useCustomLLM,
    cloudConfigured,

    configuredSearchProviders,
    // Not probed: finding out costs a real search, and the free path is blocked
    // often enough that a stale "fine" would be worse than admitting we did not
    // look. The report renders this as unknown-and-unverified.
    freeSearchBlocked: null,

    readerFallbackEnabled: !!settings.webReaderFallbackEnabled,

    ffmpegAvailable: ffmpeg,
    n8nReachable: n8nUp,
    qdrantReachable: qdrantUp,

    freeDiskGB: freeDiskGB(app.getPath('userData')),
  };
}
