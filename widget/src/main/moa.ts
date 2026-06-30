/**
 * Mixture of Agents (MoA) — multi-model collaboration engine.
 *
 * Multiple "proposer" models generate independent responses in parallel,
 * each with a specialised role (analyst, devil's advocate, implementer).
 * An "aggregator" model synthesises those proposals into a single high-quality
 * answer that is streamed back to the user.
 *
 * Simple queries (greetings, tool calls, single-word answers) bypass MoA
 * and go straight to the default single-model path for speed.
 */
import axios from 'axios';
import { execFile } from 'child_process';
import { logTelemetryEvent } from './utils/logger';

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

/** Maximum time (ms) to wait for a single proposer before giving up. */
const PROPOSER_TIMEOUT_MS = 120_000;

/** Minimum number of successful proposals required to run aggregation. */
const MIN_PROPOSALS = 1;

// ── Recommended default configurations ──────────────────────────────────────

/** Opinionated default combos for users who don't know what to pick. */
export const MOA_PRESETS = {
  balanced: {
    label: 'Balanced (recommended)',
    description: 'General + coding models with gemma4 aggregation — needs 16+ GB VRAM',
    proposers: ['qwen2.5:7b', 'qwen2.5-coder:7b'],
    aggregator: 'gemma4:e4b'
  },
  codeHeavy: {
    label: 'Code-focused',
    description: 'Coding-optimised with strong aggregator — needs 16+ GB VRAM',
    proposers: ['qwen2.5-coder:7b', 'qwen2.5:7b'],
    aggregator: 'gemma4:e4b'
  },
  lightweight: {
    label: 'Lightweight',
    description: 'Two 7B proposers with qwen aggregation — needs 10+ GB VRAM',
    proposers: ['qwen2.5:7b', 'qwen2.5-coder:7b'],
    aggregator: 'qwen2.5:7b'
  }
} as const;

/** Best single-model choices by VRAM tier. */
export const SINGLE_MODEL_RECOMMENDATIONS: Array<{
  minVram: number;
  model: string;
  label: string;
}> = [
  { minVram: 8, model: 'gemma4:e4b', label: 'gemma4:e4b — most capable local model, needs 8+ GB VRAM' },
  { minVram: 4, model: 'qwen2.5:7b', label: 'qwen2.5:7b — best general + tool-calling model for 4+ GB VRAM' },
  { minVram: 2, model: 'qwen2.5:7b', label: 'qwen2.5:7b — may be tight on 2-3 GB but still best available' },
];

// ── Hardware detection & recommendation ─────────────────────────────────────

/** Model VRAM requirements in GB (approximate, quantised weights). */
const MODEL_VRAM: Record<string, number> = {
  'gemma4:e4b': 9.6,
  'qwen2.5:7b': 4.7,
  'qwen2.5-coder:7b': 4.4,
  'moondream': 1.7,
  'nomic-embed-text': 0.3,
  'deepseek-coder-v2:latest': 8.9,
};

/**
 * Pick the best MoA preset that fits within the user's available VRAM.
 * MoA runs proposers in parallel, so we need the sum of all proposer sizes
 * plus the aggregator. (Ollama shares layers, so real usage is lower, but
 * we budget conservatively.)
 */
export function recommendMoAPreset(
  vramGB: number
): { preset: keyof typeof MOA_PRESETS; reason: string } | null {
  // Calculate peak VRAM per preset: max single proposer + aggregator
  // (Ollama loads one model at a time by default, keeps others in VRAM if space allows)
  const presetFit = (Object.keys(MOA_PRESETS) as Array<keyof typeof MOA_PRESETS>).map(key => {
    const p = MOA_PRESETS[key];
    const proposerMax = Math.max(...p.proposers.map(m => MODEL_VRAM[m] ?? 4));
    const aggSize = MODEL_VRAM[p.aggregator] ?? 4;
    // Peak usage: largest proposer loaded + aggregator queued (Ollama swaps)
    // Conservative estimate: largest model + 1 GB overhead
    const peakVram = Math.max(proposerMax, aggSize) + 1;
    return { key, peakVram, label: p.label };
  });

  // Sort by quality (codeHeavy > balanced > lightweight) — reverse order of array
  const ranked: Array<keyof typeof MOA_PRESETS> = ['codeHeavy', 'balanced', 'lightweight'];
  for (const key of ranked) {
    const info = presetFit.find(p => p.key === key)!;
    if (vramGB >= info.peakVram) {
      return {
        preset: key,
        reason: `${MOA_PRESETS[key].label} fits your ${vramGB} GB VRAM (needs ~${info.peakVram.toFixed(0)} GB)`
      };
    }
  }

  return null; // Not enough VRAM for any preset
}

/** Minimum VRAM (GB) where MoA actually improves quality over single-model. */
export const MOA_MIN_VRAM_GB = 8;

/**
 * Unified hardware recommendation — returns either a MoA preset or a
 * single-model suggestion depending on available VRAM.
 *
 * Below 8 GB VRAM, MoA adds latency without improving quality because only
 * 3B models fit as proposers, and two 3B responses synthesised by a 3B
 * aggregator is worse than one 7B response.  RAG (already built) gives a
 * much bigger quality boost at zero VRAM cost for these users.
 */
export function recommendConfig(vramGB: number): {
  mode: 'moa' | 'single';
  preset?: keyof typeof MOA_PRESETS;
  model?: string;
  reason: string;
} | null {
  // ≥8 GB → MoA is worth it
  if (vramGB >= MOA_MIN_VRAM_GB) {
    const moaRec = recommendMoAPreset(vramGB);
    if (moaRec) {
      return { mode: 'moa', preset: moaRec.preset, reason: moaRec.reason };
    }
  }

  // <8 GB → single model + RAG
  for (const tier of SINGLE_MODEL_RECOMMENDATIONS) {
    if (vramGB >= tier.minVram) {
      return {
        mode: 'single',
        model: tier.model,
        reason: `${tier.label}. MoA needs 8+ GB VRAM — use RAG for a bigger quality boost.`,
      };
    }
  }

  return null; // <2 GB — nothing useful fits
}

/**
 * Detect GPU VRAM by running `nvidia-smi` (NVIDIA) or checking Ollama's
 * exposed GPU info via its API.
 * Returns VRAM in GB, or null if detection fails.
 */
export async function detectGpuVram(): Promise<{
  vramGB: number | null;
  gpuName: string | null;
  method: 'nvidia-smi' | 'ollama' | 'none';
}> {
  // Try nvidia-smi first (most reliable on Windows)
  try {
    const result = await new Promise<string>((resolve, reject) => {
      execFile(
        'nvidia-smi',
        ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
        { timeout: 5000 },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        }
      );
    });
    // Output like: "NVIDIA GeForce RTX 4070, 12288"
    const firstLine = result.split('\n')[0]?.trim();
    if (firstLine) {
      const parts = firstLine.split(',').map(s => s.trim());
      const gpuName = parts[0] || null;
      const memMB = parseInt(parts[1], 10);
      if (!isNaN(memMB) && memMB > 0) {
        return { vramGB: Math.round(memMB / 1024), gpuName, method: 'nvidia-smi' };
      }
    }
  } catch { /* nvidia-smi not available — try Ollama */ }

  // Fallback: check Ollama /api/ps for loaded model VRAM info
  try {
    const resp = await axios.get(`${DEFAULT_OLLAMA_URL}/api/ps`, { timeout: 3000 });
    const models = resp.data?.models;
    if (Array.isArray(models) && models.length > 0) {
      // Ollama reports size_vram in bytes for loaded models
      const totalVram = models.reduce((sum: number, m: any) => sum + (m.size_vram || 0), 0);
      if (totalVram > 0) {
        return { vramGB: Math.round(totalVram / (1024 ** 3)), gpuName: null, method: 'ollama' };
      }
    }
  } catch { /* Ollama not running */ }

  return { vramGB: null, gpuName: null, method: 'none' };
}

// ── Role-specialised proposer prompts ───────────────────────────────────────

/**
 * Each proposer gets a different system prompt suffix to encourage diversity.
 * The base system prompt (from settings) is prepended automatically.
 */
export const PROPOSER_ROLES: Array<{ name: string; suffix: string }> = [
  {
    name: 'Careful Analyst',
    suffix:
      '\n\nYou are the CAREFUL ANALYST on this team. ' +
      'Focus on accuracy, edge cases, and potential pitfalls. ' +
      'If you spot any assumptions in the question, call them out. ' +
      'Prioritise correctness over brevity.'
  },
  {
    name: "Devil's Advocate",
    suffix:
      "\n\nYou are the DEVIL'S ADVOCATE on this team. " +
      'Challenge the obvious answer. Consider alternative interpretations. ' +
      'Point out what could go wrong with the straightforward approach. ' +
      'Offer a contrarian viewpoint when appropriate.'
  },
  {
    name: 'Practical Implementer',
    suffix:
      '\n\nYou are the PRACTICAL IMPLEMENTER on this team. ' +
      'Focus on actionable, concrete steps. Give working examples. ' +
      'Prioritise what the user can do right now over theoretical discussion. ' +
      'Keep it pragmatic and direct.'
  },
  {
    name: 'Creative Explorer',
    suffix:
      '\n\nYou are the CREATIVE EXPLORER on this team. ' +
      'Think outside the box. Suggest approaches the user might not have considered. ' +
      'Draw connections to other domains. Offer novel perspectives.'
  },
  {
    name: 'Domain Synthesiser',
    suffix:
      '\n\nYou are the DOMAIN SYNTHESISER on this team. ' +
      'Connect this question to broader patterns and best practices. ' +
      'Reference established approaches where relevant. Give a well-rounded view.'
  }
];

/**
 * Get the role-specialised system prompt for a given proposer index.
 * Wraps around if there are more proposers than roles.
 */
export function getProposerRole(index: number): { name: string; suffix: string } {
  return PROPOSER_ROLES[index % PROPOSER_ROLES.length];
}

// ── Complexity detection ────────────────────────────────────────────────────

/**
 * Patterns that signal a query is too simple to benefit from MoA.
 * These go straight through to the normal single-model path.
 */
const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|yo|sup|howdy|greetings|good\s*(morning|afternoon|evening)|what'?s\s*up|hiya)[\s!?.]*$/i,
  /^\/\w+/,                    // slash commands
  /^(yes|no|ok|okay|sure|thanks|thank\s*you|bye|goodbye)[\s!?.]*$/i,
];

/**
 * Patterns that signal a query will benefit from multi-model collaboration:
 * reasoning, analysis, comparison, explanation, creative writing, debugging.
 */
const COMPLEX_PATTERNS = [
  /\b(explain|analyze|analyse|compare|contrast|evaluate|summarize|summarise|critique|review)\b/i,
  /\b(why|how\s+does|how\s+would|what\s+if|pros?\s+and\s+cons?)\b/i,
  /\b(write\s+(?:a|an|me)\s+\w{4,}|create\s+(?:a|an)\s+\w{4,}|design|plan|strategy|brainstorm)\b/i,
  /\b(debug|troubleshoot|fix|diagnose|optimise|optimize|refactor)\b/i,
  /\b(step[\s-]by[\s-]step|in\s+detail|thoroughly|comprehensive)\b/i,
  /\b(essay|article|report|story|poem|code|script|function|algorithm)\b/i,
];

/**
 * Patterns that downgrade complexity — if these match alongside a complex
 * keyword, the query is probably too trivial for MoA.
 */
const TRIVIAL_MODIFIERS = [
  /\b(quick|simple|short|brief|one[\s-]?line|tl;?dr)\b/i,
  /\bwrite\s+a\s+(quick\s+)?note\b/i,
  /\bexplain\s+what\s+(this|that)\s+(button|icon|setting|option)\b/i,
  /\bjust\s+(tell|give|show)\s+me\b/i,
];

/**
 * Determine whether a user message is complex enough to benefit from MoA.
 * Returns true if MoA should be used, false for the fast single-model path.
 */
export function shouldUseMoA(message: string): boolean {
  const trimmed = message.trim();

  // Very short messages are never complex
  if (trimmed.length < 12) return false;

  // Quick exit for known-simple patterns
  for (const pat of SIMPLE_PATTERNS) {
    if (pat.test(trimmed)) return false;
  }

  // Check for complexity signals
  for (const pat of COMPLEX_PATTERNS) {
    if (pat.test(trimmed)) {
      // Downgrade if a trivial modifier is also present
      for (const triv of TRIVIAL_MODIFIERS) {
        if (triv.test(trimmed)) return false;
      }
      return true;
    }
  }

  // Heuristic: longer messages (>80 chars) with a question mark are likely complex
  if (trimmed.length > 80 && trimmed.includes('?')) return true;

  // Default: don't use MoA for ambiguous queries to keep latency low
  return false;
}

// ── Proposer ────────────────────────────────────────────────────────────────

interface ProposerResult {
  model: string;
  role: string;
  content: string;
  durationMs: number;
  error?: string;
}

/**
 * Send a query to a single Ollama model and collect the full (non-streamed)
 * response. We still use `stream: true` internally but consume all chunks
 * in-memory so that we can detect errors early.
 */
async function queryProposer(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string; images?: string[] }>,
  signal: AbortSignal
): Promise<ProposerResult> {
  const start = Date.now();
  try {
    const response = await axios.post(
      `${DEFAULT_OLLAMA_URL}/api/chat`,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        stream: true,
        keep_alive: '30m'
      },
      { responseType: 'stream', timeout: PROPOSER_TIMEOUT_MS, signal }
    );

    let content = '';
    const stream = response.data as NodeJS.ReadableStream;

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        try {
          const lines = chunk.toString('utf8').split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) content += parsed.message.content;
            if (parsed.done) resolve();
          }
        } catch { /* partial JSON line — ignore */ }
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    return { model, role: '', content: content.trim(), durationMs: Date.now() - start };
  } catch (err: any) {
    return {
      model,
      role: '',
      content: '',
      durationMs: Date.now() - start,
      error: err?.message || String(err)
    };
  }
}

// ── Aggregator ──────────────────────────────────────────────────────────────

/**
 * Build the aggregator prompt from multiple proposer outputs.
 */
function buildAggregatorPrompt(userMessage: string, proposals: ProposerResult[]): string {
  const proposalBlocks = proposals
    .filter(p => p.content)
    .map((p, i) => `--- Proposal ${i + 1} (from ${p.model}) ---\n${p.content}`)
    .join('\n\n');

  return (
    `You are an expert synthesiser. The user asked:\n"${userMessage}"\n\n` +
    `${proposals.filter(p => p.content).length} specialist models have provided independent answers below. ` +
    `Your job is to produce a single, high-quality answer by:\n` +
    `1. Identifying the strongest points from each proposal\n` +
    `2. Resolving any contradictions using your own judgement\n` +
    `3. Combining the best parts into a clear, coherent response\n` +
    `4. Adding any missing information if necessary\n\n` +
    `Do NOT mention that multiple models were consulted. ` +
    `Just give the best final answer directly.\n\n` +
    `${proposalBlocks}`
  );
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface MoACallbacks {
  /** Called with each text chunk from the aggregator stream */
  onChunk: (text: string) => void;
  /** Called once when the aggregator finishes */
  onEnd: () => void;
  /** Called on fatal error */
  onError: (err: any) => void;
  /** (optional) Called with proposer status updates for UI */
  onProposerStatus?: (model: string, status: 'started' | 'done' | 'error') => void;
}

export interface MoAOptions {
  /** Proposer model names (e.g. ['qwen2.5:7b','mistral:7b','deepseek-coder:7b']) */
  proposers: string[];
  /** Aggregator model name (e.g. 'qwen2.5:14b') */
  aggregator: string;
  /** System prompt for proposers */
  systemPrompt: string;
  /** Chat history (user + assistant turns, no system) */
  history: Array<{ role: string; content: string; images?: string[] }>;
  /** The new user message */
  userMessage: string;
}

/**
 * Run the full Mixture of Agents pipeline:
 * 1. Fan out the query to all proposer models in parallel
 * 2. Collect their complete responses
 * 3. Stream the aggregator's synthesised response back via callbacks
 *
 * Returns a cancel handle.
 */
export async function runMoAPipeline(
  opts: MoAOptions,
  callbacks: MoACallbacks
): Promise<{ cancel: () => void }> {
  const controller = new AbortController();
  const pipelineStart = Date.now();

  // Build the message list (history + current user message)
  const messages = [
    ...opts.history.map(m => ({ role: m.role, content: m.content, images: m.images })),
    { role: 'user', content: opts.userMessage }
  ];

  // UI indicator that MoA is active — name the proposers
  const modelNames = opts.proposers.map(m => m.split(':')[0]).join(', ');
  callbacks.onChunk(`🧠 *Consulting ${opts.proposers.length} specialist models (${modelNames})…*\n\n`);

  // ── Phase 1: Proposers (parallel) ────────────────────────────────────────
  const proposerPromises = opts.proposers.map((model, i) => {
    const role = getProposerRole(i);
    const rolePrompt = opts.systemPrompt + role.suffix;
    callbacks.onProposerStatus?.(model, 'started');
    return queryProposer(model, rolePrompt, messages, controller.signal)
      .then(result => {
        result.role = role.name;
        callbacks.onProposerStatus?.(model, result.error ? 'error' : 'done');
        // Stream live progress to the chat
        const shortName = model.split(':')[0];
        if (result.error) {
          callbacks.onChunk(`  ❌ ${shortName} failed\n`);
        } else {
          callbacks.onChunk(`  ✅ ${shortName} responded (${role.name})\n`);
        }
        return result;
      });
  });

  let proposals: ProposerResult[];
  try {
    proposals = await Promise.all(proposerPromises);
  } catch (err: any) {
    callbacks.onError(err);
    return { cancel: () => controller.abort() };
  }

  // Check that we have enough successful proposals
  const successful = proposals.filter(p => p.content.length > 0);
  if (successful.length < MIN_PROPOSALS) {
    const failedModels = proposals.filter(p => p.error).map(p => `${p.model}: ${p.error}`).join('; ');
    callbacks.onChunk(`⚠️ MoA: Not enough proposals succeeded (${successful.length}/${opts.proposers.length}). ${failedModels}\n\n`);
    // If we have at least one, still try to aggregate; otherwise error out
    if (successful.length === 0) {
      callbacks.onError(new Error('All proposer models failed'));
      return { cancel: () => controller.abort() };
    }
  }

  // Log timing
  for (const p of proposals) {
    const status = p.error ? `❌ ${p.error}` : `✅ ${p.content.length} chars`;
    console.log(`[MoA] Proposer ${p.model} [${p.role}]: ${status} (${p.durationMs}ms)`);
  }

  // Separator before synthesis
  callbacks.onChunk(`\n🔄 *Synthesising best answer from ${successful.length} proposals…*\n\n`);

  // ── Phase 2: Aggregator (streamed) ───────────────────────────────────────
  const aggregatorPrompt = buildAggregatorPrompt(opts.userMessage, successful);

  try {
    const response = await axios.post(
      `${DEFAULT_OLLAMA_URL}/api/chat`,
      {
        model: opts.aggregator,
        messages: [
          { role: 'system', content: aggregatorPrompt },
          { role: 'user', content: opts.userMessage }
        ],
        stream: true,
        keep_alive: '30m'
      },
      { responseType: 'stream', timeout: 0, signal: controller.signal }
    );

    const stream = response.data as NodeJS.ReadableStream;

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        try {
          const lines = chunk.toString('utf8').split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              callbacks.onChunk(parsed.message.content);
            }
            if (parsed.done) resolve();
          }
        } catch { /* partial JSON */ }
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    callbacks.onEnd();
  } catch (err: any) {
    if (err?.name === 'CanceledError' || controller.signal.aborted) {
      callbacks.onEnd();
    } else {
      callbacks.onError(err);
    }
  }

  // ── Telemetry ──────────────────────────────────────────────────────────
  const totalDurationMs = Date.now() - pipelineStart;
  logTelemetryEvent('moa_pipeline', {
    proposerCount: opts.proposers.length,
    proposers: opts.proposers,
    aggregator: opts.aggregator,
    successfulCount: successful.length,
    proposerDurations: proposals.map(p => ({ model: p.model, role: p.role, ms: p.durationMs, ok: !p.error })),
    totalDurationMs
  });

  return { cancel: () => controller.abort() };
}
