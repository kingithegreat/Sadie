/**
 * IDE-6 opt-in ghost-text completion from a small local fill-in-the-middle model.
 * Never downloads by itself and never substitutes a larger general chat model.
 *
 * Reliability notes:
 * - The model stays loaded between keystrokes (keep_alive), so only the first
 *   request pays the cold load; it gets a longer budget than warm requests.
 * - The pinned default is a FIM-trained base model; any other installed
 *   qwen2.5-coder 0.5b/1.5b under the size cap is accepted as a fallback.
 * - Every request is logged with its latency; p50/p95 are kept in memory.
 */
import axios from 'axios';
import * as os from 'os';
import { getSettings } from './config-manager';
import { detectGpuVram } from './moa';
import { validateWorkspaceRoot } from './workspace-context';
import { resolveCloudLLM } from '../shared/cloud-llm';

export const PINNED_COMPLETION_MODEL = 'qwen2.5-coder:1.5b-base';
export const PINNED_COMPLETION_MODEL_GB = 1.0;
const COMPATIBLE = /^qwen2\.5-coder:(?:0\.5b|1\.5b)(?:-|$)/;
const MAX_MODEL_BYTES = 1.2 * 1024 ** 3;
export const COLD_TIMEOUT_MS = 8000;
export const WARM_TIMEOUT_MS = 1500;
const KEEP_ALIVE = '10m';

let busy = false;
let hardware: { at: number; vramGB: number | null } | undefined;
let warmModel: { name: string; at: number } | undefined;
const latencies: number[] = [];

export interface CompletionLatencyStats { count: number; p50Ms: number | null; p95Ms: number | null; lastMs: number | null }
function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}
export function completionLatencyStats(): CompletionLatencyStats {
  return { count: latencies.length, p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95), lastMs: latencies.length ? latencies[latencies.length - 1] : null };
}
function recordLatency(model: string, ms: number, cold: boolean, outcome: string): void {
  latencies.push(ms); if (latencies.length > 200) latencies.shift();
  const stats = completionLatencyStats();
  console.info(`[ide-completion] model=${model} latency=${ms}ms cold=${cold} outcome=${outcome} p50=${stats.p50Ms}ms p95=${stats.p95Ms}ms n=${stats.count}`);
}
export function resetCompletionStateForTests(): void { busy = false; hardware = undefined; warmModel = undefined; latencies.length = 0; }

function localEndpoint(): URL | null {
  const endpoint = new URL(getSettings().ollamaUrl || 'http://127.0.0.1:11434');
  return ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ? endpoint : null;
}
export function chooseCompletionModel(models: Array<{ name: string; size: number }>): { name: string; size: number } | undefined {
  const usable = models.filter(item => COMPATIBLE.test(item.name) && Number(item.size) > 0 && Number(item.size) <= MAX_MODEL_BYTES);
  return usable.find(item => item.name === PINNED_COMPLETION_MODEL) || usable.sort((a, b) => b.size - a.size)[0];
}
const setup = () => ({ model: PINNED_COMPLETION_MODEL, sizeGB: PINNED_COMPLETION_MODEL_GB, command: `ollama pull ${PINNED_COMPLETION_MODEL}` });

export async function completeWorkspaceCode(root: unknown, prefix: unknown, suffix: unknown) {
  validateWorkspaceRoot(root);
  if (typeof prefix !== 'string' || typeof suffix !== 'string' || prefix.length > 40_000 || suffix.length > 20_000) throw new Error('Completion context is too large or invalid.');
  if (busy) return { text: '', reason: 'A local completion is already running.' };
  if (os.freemem() < 2 * 1024 ** 3) return { text: '', reason: 'Local completion is paused until at least 2 GB RAM is free.' };
  busy = true;
  let model: { name: string; size: number } | undefined, started = 0, cold = false;
  try {
    const endpoint = localEndpoint();
    if (!endpoint) return { text: '', reason: 'Completion requires a model running on this PC.' };
    let tags;
    try { tags = await axios.get(`${endpoint.origin}/api/tags`, { timeout: 1000, maxRedirects: 0 }); }
    catch { return { text: '', reason: 'Ollama is not running on this PC. Start Ollama, then try again.', setup: setup() }; }
    model = chooseCompletionModel(tags.data?.models || []);
    if (!model) return { text: '', reason: `The small completion model ${PINNED_COMPLETION_MODEL} (~${PINNED_COMPLETION_MODEL_GB} GB) is not installed. Install it to turn on Tab completion. No download was started.`, setup: setup() };
    if (!hardware || Date.now() - hardware.at > 5 * 60_000) hardware = { at: Date.now(), vramGB: (await detectGpuVram()).vramGB };
    if (!hardware.vramGB || hardware.vramGB < 4) return { text: '', reason: 'Completion requires a confirmed GPU with at least 4 GB memory.' };
    const loaded = await axios.get(`${endpoint.origin}/api/ps`, { timeout: 1000, maxRedirects: 0 });
    const running: any[] = loaded.data?.models || [];
    const occupied = running.filter(item => item.name !== model!.name).reduce((sum: number, item: any) => sum + Math.max(0, Number(item.size_vram) || 0), 0);
    if (hardware.vramGB * 1024 ** 3 - occupied < Number(model.size) * 2 + 256 * 1024 ** 2) return { text: '', reason: 'Completion is paused because other models occupy the available GPU memory.' };
    cold = !running.some(item => item.name === model!.name) && !(warmModel?.name === model.name && Date.now() - warmModel.at < 9 * 60_000);
    started = Date.now();
    const result = await axios.post(`${endpoint.origin}/api/generate`, {
      model: model.name, raw: true, stream: false, keep_alive: KEEP_ALIVE,
      prompt: `<|fim_prefix|>${prefix.slice(-8000)}<|fim_suffix|>${suffix.slice(0, 4000)}<|fim_middle|>`,
      options: { temperature: 0, num_predict: 64, num_ctx: 2048, stop: ['<|endoftext|>', '<|fim_suffix|>', '<|fim_prefix|>', '<|fim_middle|>', '<|file_sep|>'] },
    }, { timeout: cold ? COLD_TIMEOUT_MS : WARM_TIMEOUT_MS, maxRedirects: 0 });
    warmModel = { name: model.name, at: Date.now() };
    const text = typeof result.data?.response === 'string' ? result.data.response.slice(0, 4000) : '';
    const latencyMs = Date.now() - started;
    recordLatency(model.name, latencyMs, cold, text ? 'ok' : 'empty');
    return { text, model: model.name, latencyMs, cold, stats: completionLatencyStats(), reason: text ? undefined : 'The local model returned no completion.' };
  } catch (error) {
    if (model && started) recordLatency(model.name, Date.now() - started, cold, 'error');
    const timedOut = /timeout/i.test((error as Error).message || '');
    return { text: '', reason: timedOut ? `The local model took longer than ${cold ? COLD_TIMEOUT_MS : WARM_TIMEOUT_MS} ms${cold ? ' while loading; the next try should be faster' : ''}.` : `Local completion unavailable: ${(error as Error).message}` };
  } finally { busy = false; }
}

/** User-initiated install of the pinned small model only, and only while Online is on. */
export async function installCompletionModel() {
  let online = false; try { online = resolveCloudLLM(getSettings()).intended; } catch { online = false; }
  if (!online) return { installed: false, reason: `Turn on Online in Settings to download ${PINNED_COMPLETION_MODEL} (~${PINNED_COMPLETION_MODEL_GB} GB), or run "ollama pull ${PINNED_COMPLETION_MODEL}" yourself.` };
  const endpoint = localEndpoint();
  if (!endpoint) return { installed: false, reason: 'Completion requires Ollama running on this PC.' };
  try {
    await axios.post(`${endpoint.origin}/api/pull`, { name: PINNED_COMPLETION_MODEL, stream: false }, { timeout: 30 * 60_000, maxRedirects: 0 });
    return { installed: true, model: PINNED_COMPLETION_MODEL };
  } catch (error) { return { installed: false, reason: `Download failed: ${(error as Error).message}` }; }
}
