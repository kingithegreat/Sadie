/** Opt-in FIM only. Never download or substitute a larger general chat model. */
import axios from 'axios';
import * as os from 'os';
import { getSettings } from './config-manager';
import { detectGpuVram } from './moa';
import { validateWorkspaceRoot } from './workspace-context';
let busy = false;
let hardware: { at: number; vramGB: number | null } | undefined;
export async function completeWorkspaceCode(root: unknown, prefix: unknown, suffix: unknown) {
  validateWorkspaceRoot(root);
  if (typeof prefix !== 'string' || typeof suffix !== 'string' || prefix.length > 40_000 || suffix.length > 20_000) throw new Error('Completion context is too large or invalid.');
  if (busy) return { text: '', reason: 'A local completion is already running.' };
  if (os.freemem() < 2 * 1024 ** 3) return { text: '', reason: 'Local completion is paused until at least 2 GB RAM is free.' };
  busy = true;
  try {
    const endpoint = new URL(getSettings().ollamaUrl || 'http://127.0.0.1:11434');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) return { text: '', reason: 'Completion requires a model running on this PC.' };
    const tags = await axios.get(`${endpoint.origin}/api/tags`, { timeout: 1000, maxRedirects: 0 });
    const model = (tags.data?.models || []).filter((item: any) => /^qwen2\.5-coder:(?:0\.5b|1\.5b)(?:-|$)/.test(item.name) && Number(item.size) > 0 && Number(item.size) <= 1.2 * 1024 ** 3).sort((a: any, b: any) => a.size - b.size)[0];
    if (!model) return { text: '', reason: 'No compatible small FIM model is installed. The installed 7B coder is too large for this completion budget. No download was started.' };
    if (!hardware || Date.now() - hardware.at > 5 * 60_000) hardware = { at: Date.now(), vramGB: (await detectGpuVram()).vramGB };
    if (!hardware.vramGB || hardware.vramGB < 4) return { text: '', reason: 'Completion requires a confirmed GPU with at least 4 GB memory.' };
    const loaded = await axios.get(`${endpoint.origin}/api/ps`, { timeout: 1000, maxRedirects: 0 });
    const occupied = (loaded.data?.models || []).filter((item: any) => item.name !== model.name).reduce((sum: number, item: any) => sum + Math.max(0, Number(item.size_vram) || 0), 0);
    if (hardware.vramGB * 1024 ** 3 - occupied < Number(model.size) * 2 + 256 * 1024 ** 2) return { text: '', reason: 'Completion is paused because other models occupy the available GPU memory.' };
    const started = Date.now();
    const result = await axios.post(`${endpoint.origin}/api/generate`, {
      model: model.name, raw: true, stream: false, keep_alive: 0,
      prompt: `<|fim_prefix|>${prefix.slice(-8000)}<|fim_suffix|>${suffix.slice(0, 4000)}<|fim_middle|>`,
      options: { temperature: 0, num_predict: 64, num_ctx: 2048, stop: ['<|endoftext|>', '<|fim_suffix|>', '<|fim_prefix|>'] },
    }, { timeout: 800, maxRedirects: 0 });
    const text = typeof result.data?.response === 'string' ? result.data.response.slice(0, 4000) : '';
    return { text, model: model.name, latencyMs: Date.now() - started, reason: text ? undefined : 'The local model returned no completion.' };
  } catch (error) { return { text: '', reason: `Local completion unavailable: ${(error as Error).message}` }; }
  finally { busy = false; }
}
