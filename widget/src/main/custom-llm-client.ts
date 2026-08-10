/**
 * Custom LLM API client supporting multiple providers (OpenAI, Anthropic, OpenRouter, Custom)
 * Includes function calling support, retry logic, and provider auto-detection
 */
import axios from 'axios';
import { spawn } from 'child_process';
import type { CustomLLMConfig, CustomModelInfo, ModelMetadata } from '../shared/types';
import type { ToolDefinition } from './tools/types';
import { toOpenAITool, toAnthropicTool } from './tools/types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string }; source?: { type: string; media_type: string; data: string } }>;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/** Loopback MCP endpoint exposing HomeBot's permission-gated tools. */
export interface AssistantBridgeRef {
  url: string;
  token: string;
}

/**
 * Supplies the live bridge, set once by the main process at startup.
 *
 * A hook rather than a direct import of assistant-bridge: that module pulls in
 * the whole tool registry (and Electron with it), which would drag a heavyweight
 * import chain into every test that touches this client. Unset in tests, so the
 * claude-code provider stays chat-only there unless a bridge is passed
 * explicitly.
 */
let assistantBridgeProvider: (() => AssistantBridgeRef | null) | null = null;

export function setAssistantBridgeProvider(fn: (() => AssistantBridgeRef | null) | null): void {
  assistantBridgeProvider = fn;
}

interface StreamOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  apiConfig: CustomLLMConfig;
  tools?: ToolDefinition[];
  onChunk: (text: string) => void;
  onToolCall?: (toolCall: { name: string; arguments: any; id?: string }) => void;
  onEnd: () => void;
  onError: (err: any) => void;
  signal?: AbortSignal;
  /** When present, the claude-code provider gets HomeBot's gated toolset. */
  assistantBridge?: AssistantBridgeRef;
}

// Model metadata database
const MODEL_METADATA: Record<string, Partial<ModelMetadata>> = {
  'gpt-4': { contextWindow: 8192, maxTokens: 4096, supportsTools: true, supportsVision: false, supportsStreaming: true },
  'gpt-4-turbo': { contextWindow: 128000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'gpt-4o': { contextWindow: 128000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'gpt-4o-mini': { contextWindow: 128000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'gpt-3.5-turbo': { contextWindow: 16385, maxTokens: 4096, supportsTools: true, supportsVision: false, supportsStreaming: true },
  // Current generation. Explicit entries are required: the partial-match
  // fallback below would not match these IDs, and the defaults set
  // supportsTools:false — which silently disables tool calling.
  'claude-opus-5': { contextWindow: 1000000, maxTokens: 64000, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-sonnet-5': { contextWindow: 1000000, maxTokens: 64000, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-haiku-4-5': { contextWindow: 200000, maxTokens: 32000, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-opus-4': { contextWindow: 200000, maxTokens: 16384, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-sonnet-4': { contextWindow: 200000, maxTokens: 16384, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-3-5-sonnet': { contextWindow: 200000, maxTokens: 8192, supportsTools: true, supportsVision: true, supportsStreaming: true }, // Increased from 4096
  'claude-3-5-haiku': { contextWindow: 200000, maxTokens: 8192, supportsTools: true, supportsVision: true, supportsStreaming: true }, // Increased from 4096
  'claude-3-opus': { contextWindow: 200000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-3-sonnet': { contextWindow: 200000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-3-haiku': { contextWindow: 200000, maxTokens: 4096, supportsTools: true, supportsVision: false, supportsStreaming: true },
};

/**
 * Anthropic model IDs are dated and get RETIRED — a retired ID returns 404,
 * so a stale list here breaks every customer who picks Claude. The previous
 * list shipped six IDs that had all passed their retirement dates.
 *
 * Prefer undated aliases (`claude-opus-5`) over dated snapshots
 * (`claude-opus-5-20260115`): aliases track the current model in that tier and
 * don't expire. Re-check this list against Anthropic's model lifecycle page
 * whenever the app is released.
 */
const ANTHROPIC_MODELS: CustomModelInfo[] = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', description: 'Most capable — complex reasoning and agentic work', provider: 'anthropic', contextWindow: 1000000, costHint: '~$5/1M in · $25/1M out' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', description: 'Best balance of speed and intelligence', provider: 'anthropic', contextWindow: 1000000, costHint: '~$3/1M in · $15/1M out' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fastest and most affordable', provider: 'anthropic', contextWindow: 200000, costHint: '~$1/1M in · $5/1M out' },
];

/**
 * Models reachable through a local Claude Code CLI running on the user's own
 * Claude subscription. These are CLI aliases, not API model IDs — Claude Code
 * resolves each to the current model in that tier, so they don't go stale.
 * No API key is involved; usage draws on the user's subscription limits.
 */
const CLAUDE_CODE_MODELS: CustomModelInfo[] = [
  { id: 'haiku', name: 'Claude Haiku (subscription)', description: 'Fastest and lightest — quick questions', provider: 'claude-code', costHint: 'Lightest on your plan' },
  { id: 'sonnet', name: 'Claude Sonnet (subscription)', description: 'Balanced speed and intelligence — a good default', provider: 'claude-code', costHint: 'Included in your plan' },
  { id: 'opus', name: 'Claude Opus (subscription)', description: 'Most capable for complex coding and reasoning', provider: 'claude-code', costHint: 'Heavier on your plan' },
  { id: 'fable', name: 'Claude Fable (subscription)', description: 'Highest capability — hardest problems, long tasks', provider: 'claude-code', costHint: 'Heaviest on your plan' },
];

/**
 * Models offered when the provider is `codex` — OpenAI's Codex CLI signed in
 * with a ChatGPT account, so usage draws on the user's ChatGPT plan rather
 * than a metered API key. Same idea as CLAUDE_CODE_MODELS above.
 *
 * `default` lets the CLI pick whatever the account is entitled to, which is
 * the safest option when OpenAI rotates model names.
 */
const CODEX_MODELS: CustomModelInfo[] = [
  { id: 'default', name: 'Codex default (subscription)', description: 'Whatever your ChatGPT plan provides — safest choice', provider: 'codex', costHint: 'Included in your plan' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex (subscription)', description: 'Coding-tuned', provider: 'codex', costHint: 'Included in your plan' },
  { id: 'gpt-5.1', name: 'GPT-5.1 (subscription)', description: 'General purpose', provider: 'codex', costHint: 'Included in your plan' },
];

const OPENAI_MODELS: CustomModelInfo[] = [
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable, multimodal', provider: 'openai', costHint: '~$5/1M in' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast & affordable', provider: 'openai', costHint: '~$0.15/1M in' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: '128K context, vision', provider: 'openai', costHint: '~$10/1M in' },
  { id: 'gpt-4', name: 'GPT-4', description: 'High intelligence', provider: 'openai', costHint: '~$30/1M in' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast, cost-effective', provider: 'openai', costHint: '~$0.50/1M in' },
  { id: 'o1-preview', name: 'o1 Preview', description: 'Advanced reasoning', provider: 'openai', costHint: '~$15/1M in' },
  { id: 'o1-mini', name: 'o1 Mini', description: 'Fast reasoning', provider: 'openai', costHint: '~$3/1M in' },
];

// Groq — free tier, extremely fast inference for open-source models
const GROQ_MODELS: CustomModelInfo[] = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Best quality on Groq', provider: 'groq', contextWindow: 128000, costHint: 'Free tier' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', description: 'Fastest inference', provider: 'groq', contextWindow: 128000, costHint: 'Free tier' },
  { id: 'gemma2-9b-it', name: 'Gemma 2 9B', description: 'Google model, strong reasoning', provider: 'groq', contextWindow: 8192, costHint: 'Free tier' },
  { id: 'mistral-saba-24b', name: 'Mistral Saba 24B', description: 'Fast Mistral, multilingual', provider: 'groq', contextWindow: 32768, costHint: 'Free tier' },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: '32K context, MoE architecture', provider: 'groq', contextWindow: 32768, costHint: 'Free tier' },
  { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B', description: 'High quality', provider: 'groq', contextWindow: 128000, costHint: 'Free tier' },
];

// DeepSeek — GPT-4 class quality at ~20x lower cost than GPT-4o
const DEEPSEEK_MODELS: CustomModelInfo[] = [
  { id: 'deepseek-chat', name: 'DeepSeek V3', description: 'GPT-4 class quality', provider: 'deepseek', contextWindow: 64000, costHint: '~$0.27/1M in' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1', description: 'Reasoning model, rivals o1', provider: 'deepseek', contextWindow: 64000, costHint: '~$0.55/1M in' },
];

// Google AI Studio — Gemini models with generous free tier
const GOOGLE_AI_MODELS: CustomModelInfo[] = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Latest — thinking + tools, free tier', provider: 'google-ai-studio', contextWindow: 1048576, costHint: 'Free tier' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast & smart', provider: 'google-ai-studio', contextWindow: 1048576, costHint: 'Free tier' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: '1M context window', provider: 'google-ai-studio', contextWindow: 1048576, costHint: '~$1.25/1M in' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast', provider: 'google-ai-studio', contextWindow: 1048576, costHint: 'Free tier' },
];

// Gemini native API (generateContent endpoint)
const GOOGLE_GEMINI_NATIVE_MODELS: CustomModelInfo[] = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Latest & best free model — thinking + tools', provider: 'google-gemini', contextWindow: 1048576, costHint: 'Free tier' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast & smart', provider: 'google-gemini', contextWindow: 1048576, costHint: 'Free tier' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Large context and stronger reasoning', provider: 'google-gemini', contextWindow: 1048576, costHint: '~$1.25/1M in' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast and cost-efficient', provider: 'google-gemini', contextWindow: 1048576, costHint: 'Free tier' },
];

// Hugging Face Inference API — free tier, huge open-source model catalog
const HUGGINGFACE_MODELS: CustomModelInfo[] = [
  { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', description: 'Best open-source quality', provider: 'huggingface', contextWindow: 128000, costHint: 'Free tier' },
  { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', description: 'Strong multilingual reasoning', provider: 'huggingface', contextWindow: 128000, costHint: 'Free tier' },
  { id: 'mistralai/Mistral-Small-24B-Instruct-2501', name: 'Mistral Small 24B', description: 'Fast, efficient', provider: 'huggingface', contextWindow: 32768, costHint: 'Free tier' },
  { id: 'microsoft/Phi-4', name: 'Phi-4 14B', description: 'Compact, strong reasoning', provider: 'huggingface', contextWindow: 16384, costHint: 'Free tier' },
  { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B', description: 'Google model, strong quality', provider: 'huggingface', contextWindow: 8192, costHint: 'Free tier' },
];

// Cerebras — free tier, fastest inference (up to ~2000 tok/s)
const CEREBRAS_MODELS: CustomModelInfo[] = [
  { id: 'qwen-3-235b-a22b-instruct-2507', name: 'Qwen 3 235B', description: 'Best quality on Cerebras', provider: 'cerebras', contextWindow: 128000, costHint: 'Free tier' },
  { id: 'llama3.1-8b', name: 'Llama 3.1 8B', description: 'Ultra-fast inference', provider: 'cerebras', contextWindow: 128000, costHint: 'Free tier' },
  { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', description: 'Strong general-purpose model', provider: 'cerebras', contextWindow: 128000, costHint: 'Free tier' },
];

// SambaNova — free tier, fast Llama and DeepSeek models
const SAMBANOVA_MODELS: CustomModelInfo[] = [
  { id: 'Meta-Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', description: 'Best quality on SambaNova', provider: 'sambanova', contextWindow: 128000, costHint: 'Free tier' },
  { id: 'DeepSeek-R1-Distill-Llama-70B', name: 'DeepSeek R1 Distill 70B', description: 'Reasoning model', provider: 'sambanova', contextWindow: 128000, costHint: 'Free tier' },
  { id: 'Meta-Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B', description: 'Fast inference', provider: 'sambanova', contextWindow: 128000, costHint: 'Free tier' },
  { id: 'Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', description: 'Strong multilingual', provider: 'sambanova', contextWindow: 128000, costHint: 'Free tier' },
];

// Together AI — $5 free credits on signup, 200+ models
const TOGETHER_MODELS: CustomModelInfo[] = [
  { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', description: 'Best quality', provider: 'together', contextWindow: 128000, costHint: '~$0.88/1M in' },
  { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B Turbo', description: 'Fast & cheap', provider: 'together', contextWindow: 128000, costHint: '~$0.18/1M in' },
  { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B Turbo', description: 'Strong multilingual', provider: 'together', contextWindow: 128000, costHint: '~$1.20/1M in' },
  { id: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B', name: 'DeepSeek R1 Distill 70B', description: 'Reasoning model', provider: 'together', contextWindow: 128000, costHint: '~$0.88/1M in' },
  { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', name: 'Mixtral 8x22B', description: '65K context, MoE', provider: 'together', contextWindow: 65536, costHint: '~$1.20/1M in' },
];

// Canonical API base URLs for each named provider
export const PROVIDER_API_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  'google-ai-studio': 'https://generativelanguage.googleapis.com/v1beta/openai',
  'google-gemini': 'https://generativelanguage.googleapis.com/v1beta',
  huggingface: 'https://api-inference.huggingface.co/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  together: 'https://api.together.xyz/v1',
  // Kimi (Moonshot) speaks the OpenAI Chat Completions shape, so it needs no
  // bespoke client — only a base URL and a key from platform.moonshot.ai.
  moonshot: 'https://api.moonshot.ai/v1',
};

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizeModelsPayload(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.models)) return payload.models;
  if (payload.data && Array.isArray(payload.data.data)) return payload.data.data;
  if (typeof payload === 'object') return Object.values(payload);
  return [];
}

/**
 * Auto-detect provider from model name
 */
function detectProvider(modelName: string): CustomLLMConfig['provider'] {
  const lower = modelName.toLowerCase();
  if (lower.includes('gpt') || lower.startsWith('o1')) return 'openai';
  if (lower.includes('claude')) return 'anthropic';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('gemini')) return 'google-ai-studio';
  return 'custom';
}

/**
 * Get model metadata with defaults
 */
export function getModelMetadata(modelName: string): ModelMetadata {
  const defaults: ModelMetadata = {
    contextWindow: 8192,
    maxTokens: 4096,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true
  };

  // Check exact match
  if (MODEL_METADATA[modelName]) {
    return { ...defaults, ...MODEL_METADATA[modelName] };
  }

  // Check partial match — sort keys longest-first so "gpt-4o-mini" matches
  // before "gpt-4o" which matches before "gpt-4"
  const sortedKeys = Object.keys(MODEL_METADATA).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (modelName.includes(key)) {
      return { ...defaults, ...MODEL_METADATA[key] };
    }
  }

  // Heuristic: most cloud models on free-tier providers have large contexts
  const lower = modelName.toLowerCase();
  if (lower.includes('llama') || lower.includes('qwen') || lower.includes('mixtral') ||
      lower.includes('gemma') || lower.includes('deepseek') || lower.includes('mistral') ||
      lower.includes('phi')) {
    return { ...defaults, contextWindow: 128000, maxTokens: 4096, supportsStreaming: true };
  }

  return defaults;
}

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on certain errors
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        // Don't retry 4xx errors except 429 (rate limit)
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw error;
        }
      }
      
      // Don't retry on last attempt
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`[Custom LLM] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Stream from OpenAI-compatible API with function calling support
 */
/**
 * Creates a stateful filter that strips reasoning blocks from streamed text.
 * Supports: <think>, <thinking>, <THINK>, <THINKING> (case-insensitive).
 * Handles tags split across arbitrary SSE chunks.
 * Call `flush()` at stream end to recover any buffered partial-tag content.
 */
export function createThinkTagStripper(): ((text: string) => string) & { flush: () => string } {
  let insideThink = false;
  let buf = ''; // accumulates characters that might be part of a tag

  // Opening tags we recognise (lowercase for comparison)
  const OPEN_TAGS = ['<think>', '<thinking>'];
  // Matching close tags (same index)
  const CLOSE_TAGS = ['</think>', '</thinking>'];
  let activeCloseTag = ''; // set when we enter a think block

  function couldBeOpenTag(s: string): boolean {
    const lower = s.toLowerCase();
    return OPEN_TAGS.some(tag => tag.startsWith(lower));
  }
  function matchesOpenTag(s: string): number {
    const lower = s.toLowerCase();
    return OPEN_TAGS.findIndex(tag => tag === lower);
  }
  function couldBeCloseTag(s: string): boolean {
    const lower = s.toLowerCase();
    return activeCloseTag.startsWith(lower);
  }
  function matchesCloseTag(s: string): boolean {
    return s.toLowerCase() === activeCloseTag;
  }

  function strip(text: string): string {
    let output = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (buf.length > 0) {
        buf += ch;
        if (!insideThink) {
          if (couldBeOpenTag(buf)) {
            const idx = matchesOpenTag(buf);
            if (idx >= 0) { insideThink = true; activeCloseTag = CLOSE_TAGS[idx]; buf = ''; }
          } else {
            // Not a think tag — flush buffer as regular text
            output += buf;
            buf = '';
          }
        } else {
          if (couldBeCloseTag(buf)) {
            if (matchesCloseTag(buf)) { insideThink = false; activeCloseTag = ''; buf = ''; }
          } else {
            buf = ''; // discard (inside think block)
          }
        }
      } else if (ch === '<') {
        buf = '<';
      } else if (!insideThink) {
        output += ch;
      }
    }
    return output;
  }

  /** Call at stream end to flush any buffered partial-tag content. */
  strip.flush = function flush(): string {
    if (!buf) return '';
    // If we're outside a think block, the pending text is real content
    const out = insideThink ? '' : buf;
    buf = '';
    return out;
  };

  return strip;
}

async function streamOpenAI(options: StreamOptions): Promise<void> {
  const { apiConfig, messages, model, temperature = 0.5, maxTokens = 2000, tools, onChunk, onToolCall, onEnd, onError, signal } = options;
  
  // Convert tools to OpenAI format
  const openaiTools = tools?.map(tool => toOpenAITool(tool));
  
  try {
    const response = await retryWithBackoff(() => axios.post(
      `${apiConfig.apiUrl}/chat/completions`,
      {
        model: model || apiConfig.model,
        messages,
        temperature,
        ...(apiConfig.provider !== 'google-ai-studio' ? { max_tokens: maxTokens } : {}),
        stream: true,
        ...(openaiTools && openaiTools.length > 0 ? { tools: openaiTools, tool_choice: 'auto' } : {})
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.apiKey}`,
          ...(apiConfig.provider === 'openrouter' ? {
            'HTTP-Referer': 'https://homebot-app.local',
            'X-Title': 'HomeBot Desktop Assistant'
          } : {}),
          // Google AI Studio requires the API key both as Bearer and as a query param
          // when using its OpenAI-compatible endpoint; Bearer alone is sufficient.
          // No extra headers needed for groq/deepseek — standard Bearer auth.
        },
        responseType: 'stream',
        timeout: 0,
        signal
      }
    ), 3, 1000); // 3 retries, 1 second base delay

    const stream = response.data as NodeJS.ReadableStream;
    let currentToolCall: { id: string; name: string; arguments: string } | null = null;
    let ended = false;

    // Strip <think>/<thinking> reasoning blocks (DeepSeek R1, Qwen, etc.)
    const stripThinkTags = createThinkTagStripper();

    // SSE line buffer: TCP chunks can split mid-line, so we accumulate
    // partial lines and only process complete ones (terminated by \n).
    let lineBuf = '';

    const safeEnd = () => {
      if (!ended) {
        ended = true;
        // Flush any partial tag content buffered by the think-tag stripper
        const remainder = stripThinkTags.flush();
        if (remainder) onChunk(remainder);
        onEnd();
      }
    };

    stream.on('data', (chunk: Buffer) => {
      try {
        lineBuf += chunk.toString('utf8');
        const parts = lineBuf.split('\n');
        // Last element is either '' (line ended with \n) or an incomplete line
        lineBuf = parts.pop() || '';

        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.substring(6);
            if (data === '[DONE]') {
              // If we have a pending tool call, emit it
              if (currentToolCall && onToolCall) {
                try {
                  const args = JSON.parse(currentToolCall.arguments || '{}');
                  onToolCall({ id: currentToolCall.id, name: currentToolCall.name, arguments: args });
                } catch (e) {
                  console.error('[Custom LLM] Error parsing tool arguments:', e);
                }
                currentToolCall = null;
              }
              safeEnd();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;

              // Handle text content — strip <think>/<thinking> reasoning blocks
              if (delta?.content) {
                const cleaned = stripThinkTags(delta.content);
                if (cleaned) onChunk(cleaned);
              }
              
              // Handle tool calls (streaming)
              if (delta?.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  if (toolCall.id) {
                    // New tool call
                    if (currentToolCall && onToolCall) {
                      // Emit previous tool call
                      try {
                        const args = JSON.parse(currentToolCall.arguments || '{}');
                        onToolCall({ id: currentToolCall.id, name: currentToolCall.name, arguments: args });
                      } catch (e) {
                        console.error('[Custom LLM] Error parsing tool arguments:', e);
                      }
                    }
                    currentToolCall = {
                      id: toolCall.id,
                      name: toolCall.function?.name || '',
                      arguments: toolCall.function?.arguments || ''
                    };
                  } else if (currentToolCall && toolCall.function?.arguments) {
                    // Continue accumulating arguments
                    currentToolCall.arguments += toolCall.function.arguments;
                  }
                }
              }
            } catch (e) {
              // Ignore parsing errors for SSE chunks
            }
          }
        }
      } catch (e) {
        console.error('[Custom LLM] Error processing chunk:', e);
      }
    });
    
    stream.on('end', () => safeEnd());
    stream.on('error', (err) => onError(err));
  } catch (err: any) {
    onError(err);
  }
}

/**
 * Convert a messages array from OpenAI format to Anthropic format.
 * - System messages are separated out.
 * - tool (tool_result) messages are grouped into user content arrays.
 * - assistant messages with tool_calls are converted to tool_use content arrays.
 */
function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: any[] } {
  const rawSystem = messages.find(m => m.role === 'system')?.content || '';
  const system = typeof rawSystem === 'string' ? rawSystem : rawSystem.map(b => b.text || '').join('\n');
  const result: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'tool') {
      // Anthropic tool results go as user messages with content array.
      // Merge consecutive tool results into one user message.
      const last = result[result.length - 1];
      const resultBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id || '',
        content: msg.content
      };
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(resultBlock);
      } else {
        result.push({ role: 'user', content: [resultBlock] });
      }
      continue;
    }

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Convert OpenAI tool_calls to Anthropic tool_use content blocks.
      const content: any[] = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls) {
        let input: Record<string, any> = {};
        try { input = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore */ }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input
        });
      }
      result.push({ role: 'assistant', content });
      continue;
    }

    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const anthropicContent = msg.content.map(block => {
        if (block.type === 'image_url' && block.image_url?.url) {
          const match = block.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
          }
        }
        if (block.type === 'text') return { type: 'text', text: block.text || '' };
        return block;
      });
      result.push({ role: 'user', content: anthropicContent });
    } else {
      result.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
    }
  }

  return { system, messages: result };
}

/**
 * Stream from Anthropic API with tool calling support.
 */
/**
 * Whether a Claude model still accepts `temperature` / `top_p` / `top_k`.
 *
 * Sampling parameters were REMOVED on Opus 4.7 and later and on Sonnet 5:
 * sending one returns a 400, it is not ignored. Steer these models by
 * prompting instead. Older models (Opus 4.6, Sonnet 4.6, Haiku 4.5, Claude 3.x)
 * still accept them, and unknown/custom IDs default to accepting so a
 * self-hosted Anthropic-compatible endpoint keeps working.
 */
export function acceptsSamplingParams(model: string): boolean {
  const m = (model || '').toLowerCase();
  if (/claude-(opus|sonnet|fable|mythos)-5/.test(m)) return false;
  if (/claude-opus-4-[78]/.test(m)) return false;
  return true;
}

async function streamAnthropic(options: StreamOptions): Promise<void> {
  const { apiConfig, messages, model, temperature = 0.7, maxTokens = 2000,
          tools, onChunk, onToolCall, onEnd, onError, signal } = options;

  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
  const anthropicTools = tools && tools.length > 0 ? tools.map(toAnthropicTool) : undefined;

  // Undated alias as the fallback — a dated snapshot here eventually retires
  // and starts 404-ing for every user who never picked a model explicitly.
  const resolvedModel = model || apiConfig.model || 'claude-sonnet-5';

  try {
    const response = await axios.post(
      `${apiConfig.apiUrl}/messages`,
      {
        model: resolvedModel,
        max_tokens: maxTokens,
        // Omitted entirely on models that reject sampling parameters (400).
        ...(acceptsSamplingParams(resolvedModel) ? { temperature } : {}),
        system,
        messages: anthropicMessages,
        stream: true,
        ...(anthropicTools && anthropicTools.length > 0 ? { tools: anthropicTools } : {})
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiConfig.apiKey,
          'anthropic-version': '2023-06-01'
        },
        responseType: 'stream',
        timeout: 0,
        signal
      }
    );

    const stream = response.data as NodeJS.ReadableStream;
    let ended = false;
    const safeEnd = () => { if (!ended) { ended = true; onEnd(); } };

    // Track in-progress tool_use blocks by index
    type ToolUseBlock = { id: string; name: string; jsonBuf: string };
    const toolBlocks = new Map<number, ToolUseBlock>();

    stream.on('data', (chunk: Buffer) => {
      try {
        const lines = chunk.toString('utf8').split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.substring(6);
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { continue; }

          switch (parsed.type) {
            case 'content_block_start': {
              const cb = parsed.content_block;
              if (cb?.type === 'tool_use') {
                toolBlocks.set(parsed.index, { id: cb.id, name: cb.name, jsonBuf: '' });
              }
              break;
            }
            case 'content_block_delta': {
              const delta = parsed.delta;
              if (delta?.type === 'text_delta' && delta.text) {
                onChunk(delta.text);
              } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
                const block = toolBlocks.get(parsed.index);
                if (block) block.jsonBuf += delta.partial_json;
              }
              break;
            }
            case 'content_block_stop': {
              const block = toolBlocks.get(parsed.index);
              if (block && onToolCall) {
                let input: Record<string, any> = {};
                try { input = JSON.parse(block.jsonBuf || '{}'); } catch {
                  console.error('[Custom LLM] Anthropic: could not parse tool input JSON');
                }
                onToolCall({ id: block.id, name: block.name, arguments: input });
                toolBlocks.delete(parsed.index);
              }
              break;
            }
            case 'message_stop':
              safeEnd();
              break;
          }
        }
      } catch (e) {
        console.error('[Custom LLM] Error processing Anthropic chunk:', e);
      }
    });

    stream.on('end', () => safeEnd());
    stream.on('error', (err) => onError(err));
  } catch (err: any) {
    onError(err);
  }
}

/**
 * Claude Code's own tools, denied so the CLI acts as a plain text generator.
 * HomeBot runs its own agentic loop and permission gate; letting Claude Code
 * touch the filesystem or shell would bypass both. Denying them also strips
 * their schemas from the prompt, which is most of the token saving below.
 */
const CLAUDE_CODE_DENIED_TOOLS = [
  'Task', 'Artifact', 'Bash', 'CronCreate', 'CronDelete', 'CronList', 'DesignSync',
  'Edit', 'EnterWorktree', 'ExitWorktree', 'Glob', 'Grep', 'Monitor', 'NotebookEdit',
  'PowerShell', 'PushNotification', 'Read', 'RemoteTrigger', 'ReportFindings',
  'ScheduleWakeup', 'SendMessage', 'Skill', 'TaskOutput', 'TaskStop', 'TodoWrite',
  'ToolSearch', 'WebFetch', 'WebSearch', 'Workflow', 'Write',
].join(' ');

/** Flatten a conversation into a single prompt. Each CLI invocation is stateless. */
function toClaudeCodeTranscript(messages: ChatMessage[]): { system: string; prompt: string } {
  const systemParts: string[] = [];
  const turns: string[] = [];

  for (const msg of messages) {
    const text = typeof msg.content === 'string'
      ? msg.content
      : msg.content.map(p => (p.type === 'text' ? (p.text || '') : '')).filter(Boolean).join('\n');
    if (!text.trim()) continue;

    if (msg.role === 'system') { systemParts.push(text); continue; }
    turns.push(`${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${text}`);
  }

  // Only the final user turn is unprefixed — a bare prompt reads more naturally
  // to the model than a transcript when there is no prior history.
  const prompt = turns.length === 1 && turns[0].startsWith('User: ')
    ? turns[0].slice(6)
    : turns.join('\n\n');

  return { system: systemParts.join('\n\n'), prompt };
}

/**
 * Stream from a local Claude Code CLI authenticated with the user's own Claude
 * subscription (Pro/Max) — no API key, no per-token billing.
 *
 * Trade-offs, verified by measurement rather than assumed:
 *  - Passing --system-prompt (replacing Claude Code's coding persona), denying
 *    its tools, and clearing MCP servers cuts per-call context from ~32.8k
 *    tokens to ~780. Without those flags this is unusably expensive against
 *    subscription rate limits.
 *  - Claude Code's OWN tools stay denied. Measured, not assumed: in -p mode it
 *    executes them with `permission_denials: 0` — a non-interactive session has
 *    no approval step, so allowing them would mean an assistant that touches
 *    the machine unprompted. When an assistantBridge is supplied it instead
 *    receives HomeBot's tools over loopback MCP, so every call runs through
 *    assertPermission + the confirmation modal + the destructive blocklist.
 *    Without a bridge this stays chat-only.
 *  - `--bare` would trim more, but it explicitly disables OAuth and forces an
 *    API key, defeating the entire point of this provider. Do not add it.
 */
async function streamClaudeCode(options: StreamOptions): Promise<void> {
  const { apiConfig, messages, model, onChunk, onEnd, onError, signal } = options;

  const { system, prompt } = toClaudeCodeTranscript(messages);

  if (!prompt.trim()) {
    onError(new Error('Nothing to send to Claude Code.'));
    return;
  }

  // apiUrl doubles as an optional override for the CLI location; most users
  // leave it blank and we resolve `claude` from PATH.
  const configuredPath = apiConfig.apiUrl?.trim();
  const bin = configuredPath || (process.platform === 'win32' ? 'claude.exe' : 'claude');

  // Claude Code's native tools are ALWAYS denied. With a bridge, HomeBot's own
  // gated tools are offered in their place over loopback MCP.
  const bridge = options.assistantBridge ?? assistantBridgeProvider?.() ?? undefined;
  const mcpServers = bridge
    ? { homebot: { type: 'http', url: bridge.url, headers: { Authorization: `Bearer ${bridge.token}` } } }
    : {};

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--model', model || 'sonnet',
    '--disallowed-tools', CLAUDE_CODE_DENIED_TOOLS,
    '--mcp-config', JSON.stringify({ mcpServers }),
  ];
  if (system.trim()) args.push('--system-prompt', system);

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(bin, args, { windowsHide: true });
  } catch (err: any) {
    onError(new Error(`Could not start Claude Code (${bin}): ${err?.message || err}`));
    return;
  }

  let ended = false;
  const safeEnd = () => { if (!ended) { ended = true; onEnd(); } };
  const safeError = (err: any) => { if (!ended) { ended = true; onError(err); } };

  const onAbort = () => { try { child.kill(); } catch { /* already gone */ } };
  signal?.addEventListener('abort', onAbort, { once: true });
  const cleanup = () => signal?.removeEventListener('abort', onAbort);

  let stdoutBuf = '';
  let stderrBuf = '';
  let sawText = false;

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf8');

    // NDJSON: complete lines only; keep any trailing partial for the next chunk.
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let evt: any;
      try { evt = JSON.parse(trimmed); } catch { continue; }

      if (evt.type === 'stream_event') {
        const inner = evt.event;
        // text_delta only — thinking_delta is internal reasoning and must not
        // be surfaced as assistant output.
        if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
          const text = inner.delta.text;
          if (text) { sawText = true; onChunk(text); }
        }
        continue;
      }

      if (evt.type === 'result') {
        if (evt.is_error) {
          safeError(new Error(evt.result || evt.api_error_status || 'Claude Code reported an error.'));
        } else {
          // Fallback for a non-streaming result (no partial deltas arrived).
          if (!sawText && typeof evt.result === 'string' && evt.result) onChunk(evt.result);
          safeEnd();
        }
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString('utf8'); });

  child.on('error', (err: any) => {
    cleanup();
    if (err?.code === 'ENOENT') {
      safeError(new Error(
        'Claude Code was not found. Install it and sign in with your Claude subscription, ' +
        'or set the CLI path in Settings.'
      ));
    } else {
      safeError(err);
    }
  });

  child.on('close', (code: number | null) => {
    cleanup();
    if (ended) return;
    if (code === 0) { safeEnd(); return; }
    if (signal?.aborted) { safeEnd(); return; }
    const detail = stderrBuf.trim().split('\n').slice(-3).join(' ').slice(0, 400);
    safeError(new Error(`Claude Code exited with code ${code}${detail ? `: ${detail}` : ''}`));
  });

  try {
    child.stdin?.write(prompt);
    child.stdin?.end();
  } catch (err: any) {
    safeError(new Error(`Could not send the prompt to Claude Code: ${err?.message || err}`));
  }
}

/**
 * Stream from OpenAI's Codex CLI, signed in with a ChatGPT account so usage
 * draws on the user's plan instead of a metered API key. Sibling of
 * streamClaudeCode above.
 *
 * Two deliberate differences from the Claude path:
 *
 *  - No tool bridge. Codex has a known bug where `--json` output goes
 *    malformed once MCP servers are active (openai/codex#15451), and a
 *    corrupted stream is worse than no tools. Codex is chat-only until that
 *    is fixed; Claude keeps HomeBot's gated tools.
 *  - Text arrives per ITEM, not per token: the `--json` stream emits
 *    `item.completed` events carrying a finished `agent_message`. So replies
 *    land in one or two chunks rather than typing out. That is the CLI's
 *    granularity, not a bug here.
 */
async function streamCodex(options: StreamOptions): Promise<void> {
  const { apiConfig, messages, model, onChunk, onEnd, onError, signal } = options;

  // Codex has no --system-prompt flag, so the system text is folded into the
  // prompt body. toClaudeCodeTranscript already does exactly that shaping.
  const { system, prompt } = toClaudeCodeTranscript(messages);
  if (!prompt.trim()) {
    onError(new Error('Nothing to send to Codex.'));
    return;
  }
  const fullPrompt = system.trim() ? `${system.trim()}\n\n---\n\n${prompt}` : prompt;

  // apiUrl doubles as an optional override for the CLI location.
  const configuredPath = apiConfig.apiUrl?.trim();
  const bin = configuredPath || (process.platform === 'win32' ? 'codex.cmd' : 'codex');

  const args = [
    'exec',
    '--json',
    // HomeBot chats are not necessarily inside a git repo; without this Codex
    // refuses to run at all.
    '--skip-git-repo-check',
    // Don't leave session files behind for what is a chat turn.
    '--ephemeral',
  ];
  // 'default' means "let the CLI choose what the plan allows" — pass nothing.
  // Model ids come from CODEX_MODELS, never from user input.
  if (model && model !== 'default') args.push('-m', model);
  // Sandbox is left at the CLI default (read-only). HomeBot's own permission
  // gate is the authority on side effects; a chat provider must not be able to
  // write files on its own.
  //
  // '-' makes Codex read the PROMPT from stdin. That is the security-critical
  // choice: on Windows the CLI installs as codex.cmd, and modern Node refuses
  // to spawn .cmd without shell:true (spawn EINVAL — CVE-2024-27980). With a
  // shell, anything in argv is concatenated unescaped, so a prompt containing
  // & or | would execute commands. Sending the prompt over stdin keeps every
  // untrusted byte off the command line; only our own literal flags remain.
  args.push('-');

  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(bin, args, { windowsHide: true, shell: needsShell });
  } catch (err: any) {
    onError(new Error(`Could not start Codex (${bin}): ${err?.message || err}`));
    return;
  }

  // Write the prompt, then CLOSE stdin. Codex waits on stdin ("Reading
  // additional input from stdin...") and never finishes the turn while the
  // pipe is open — invisible from a terminal, where the shell had already
  // closed it for us.
  try {
    child.stdin?.write(fullPrompt);
    child.stdin?.end();
  } catch (err: any) {
    onError(new Error(`Could not send the prompt to Codex: ${err?.message || err}`));
    return;
  }

  let ended = false;
  const safeEnd = () => { if (!ended) { ended = true; onEnd(); } };
  const safeError = (err: any) => { if (!ended) { ended = true; onError(err); } };

  const onAbort = () => { try { child.kill(); } catch { /* already gone */ } };
  signal?.addEventListener('abort', onAbort, { once: true });
  const cleanup = () => signal?.removeEventListener('abort', onAbort);

  let stdoutBuf = '';
  let stderrBuf = '';
  let sawText = false;

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf8');
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let evt: any;
      try { evt = JSON.parse(trimmed); } catch { continue; }

      // Assistant text lands as a completed item of type agent_message.
      if (evt.type === 'item.completed' && evt.item?.type === 'agent_message') {
        const text = typeof evt.item.text === 'string' ? evt.item.text : '';
        if (text) { sawText = true; onChunk(text); }
      } else if (evt.type === 'turn.failed' || evt.type === 'error') {
        const msg = evt.error?.message || evt.message || 'Codex reported an error.';
        safeError(new Error(String(msg)));
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString('utf8'); });

  child.on('error', (err: any) => {
    cleanup();
    safeError(new Error(
      err?.code === 'ENOENT'
        ? `Codex CLI not found (${bin}). Install it with: npm install -g @openai/codex`
        : `Codex failed to start: ${err?.message || err}`,
    ));
  });

  child.on('close', (code: number | null) => {
    cleanup();
    if (sawText) { safeEnd(); return; }
    const detail = stderrBuf.trim().slice(0, 400);
    if (code === 0) {
      safeError(new Error(`Codex returned no output.${detail ? ` ${detail}` : ''}`));
    } else {
      // The most common first-run failure is simply not being signed in.
      const hint = /not.*(logged|signed) in|auth/i.test(detail)
        ? ' Run `codex login` once to sign in with your ChatGPT account.'
        : '';
      safeError(new Error(`Codex exited with code ${code}.${detail ? ` ${detail}` : ''}${hint}`));
    }
  });
}

function toGeminiContents(messages: ChatMessage[]): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const out: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
    const text = typeof msg.content === 'string'
      ? msg.content
      : msg.content
          .map((part) => (part.type === 'text' ? (part.text || '') : ''))
          .filter(Boolean)
          .join('\n');
    if (!text.trim()) continue;
    out.push({ role, parts: [{ text }] });
  }
  return out;
}

async function streamGoogleGeminiNative(options: StreamOptions): Promise<void> {
  const { apiConfig, messages, model, temperature = 0.5, maxTokens = 2000, onChunk, onEnd, onError, signal } = options;
  try {
    const baseUrl = trimTrailingSlash(apiConfig.apiUrl || PROVIDER_API_URLS['google-gemini']);
    const selectedModel = model || apiConfig.model || 'gemini-2.5-flash';
    const endpoint = `${baseUrl}/models/${encodeURIComponent(selectedModel)}:streamGenerateContent?alt=sse`;

    const systemText = messages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => p.text || '').join('\n')))
      .join('\n\n')
      .trim();

    const payload: any = {
      contents: toGeminiContents(messages),
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens
      }
    };

    if (systemText) {
      payload.systemInstruction = { parts: [{ text: systemText }] };
    }

    const response = await axios.post(
      endpoint,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiConfig.apiKey || ''
        },
        timeout: 120000,
        responseType: 'stream',
        signal
      }
    );

    let buffer = '';
    const stream = response.data as NodeJS.ReadableStream;
    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      let boundary = buffer.indexOf('\n');
      while (boundary !== -1) {
        const line = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 1);
        if (line.startsWith('data: ')) {
          const json = line.slice(6);
          try {
            const parsed = JSON.parse(json);
            const parts = parsed?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              for (const p of parts) {
                if (typeof p?.text === 'string' && p.text) onChunk(p.text);
              }
            }
          } catch { /* skip malformed SSE lines */ }
        }
        boundary = buffer.indexOf('\n');
      }
    });
    stream.on('end', () => onEnd());
    stream.on('error', (err: any) => onError(err));
  } catch (err: any) {
    onError(err);
  }
}

/**
 * Auto-configure API settings based on model name
 */
export function autoConfigureCustomLLM(config: CustomLLMConfig): CustomLLMConfig {
  const validated = { ...config };

  // Auto-detect provider if not set
  if (config.model && !config.provider) {
    validated.provider = detectProvider(config.model);
  }

  // Auto-fill canonical API URL for named providers that don't have one yet
  if (!validated.apiUrl && validated.provider && PROVIDER_API_URLS[validated.provider]) {
    validated.apiUrl = PROVIDER_API_URLS[validated.provider];
  }

  // Add metadata if not present
  if (!validated.metadata && validated.model) {
    validated.metadata = getModelMetadata(validated.model);
  }

  return validated;
}

export async function fetchAvailableCustomModels(config: Partial<CustomLLMConfig>): Promise<CustomModelInfo[]> {
  // Claude Code is a local CLI — it has no /models endpoint and needs no apiUrl,
  // so answer before the apiUrl guard below.
  if (config?.provider === 'claude-code') return CLAUDE_CODE_MODELS;
  if (config?.provider === 'codex') return CODEX_MODELS;

  if (!config || !config.apiUrl) {
    throw new Error('Enter an API URL to fetch models.');
  }

  const provider = config.provider || 'openai';

  // Return curated model lists for known providers
  if (provider === 'anthropic') return ANTHROPIC_MODELS;
  if (provider === 'openai') return OPENAI_MODELS;
  if (provider === 'groq') return GROQ_MODELS;
  if (provider === 'deepseek') return DEEPSEEK_MODELS;
  if (provider === 'google-ai-studio') return GOOGLE_AI_MODELS;
  if (provider === 'google-gemini') return GOOGLE_GEMINI_NATIVE_MODELS;
  if (provider === 'huggingface') return HUGGINGFACE_MODELS;
  if (provider === 'cerebras') return CEREBRAS_MODELS;
  if (provider === 'sambanova') return SAMBANOVA_MODELS;
  if (provider === 'together') return TOGETHER_MODELS;

  const base = trimTrailingSlash(config.apiUrl);
  const endpoint = /\/models$/i.test(base) ? base : `${base}/models`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  const needsApiKey = provider !== 'custom';
  const apiKey = config.apiKey?.trim();

  if (needsApiKey && !apiKey) {
    throw new Error('Add your API key to connect to this provider.');
  }

  if (apiKey) {
    const authHeader = provider === 'openrouter' ? `Bearer ${apiKey}` : `Bearer ${apiKey}`;
    headers['Authorization'] = authHeader;
  }

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://homebot-desktop.local';
    headers['X-Title'] = 'HomeBot Desktop';
  }

  try {
    const response = await axios.get(endpoint, {
      headers,
      timeout: 10000
    });

    let list = normalizeModelsPayload(response.data);
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('No models were returned — double-check your endpoint.');
    }

    const mapped = list.map((item: any) => {
      const id = item?.id || item?.model || item?.slug || item?.name;
      if (!id) return null;
      const contextWindow = item?.context_window || item?.context_length;
      return {
        id,
        name: item?.display_name || item?.name || id,
        description: item?.description || item?.owned_by || item?.organization || '',
        provider,
        contextWindow
      } as CustomModelInfo;
    }).filter(Boolean) as CustomModelInfo[];

    if (mapped.length === 0) {
      throw new Error('Models response could not be parsed.');
    }

    const seen = new Set<string>();
    return mapped.filter(model => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
      const detail = (err.response?.data as any)?.error?.message || err.response?.statusText || err.message;
      throw new Error(detail || 'Failed to reach custom API.');
    }
    throw err;
  }
}

/**
 * Main streaming function that routes to the appropriate provider
 * Now supports tool calling for OpenAI-compatible APIs
 */
export async function streamFromCustomLLM(
  message: string,
  conversationHistory: ChatMessage[],
  apiConfig: CustomLLMConfig,
  systemPrompt: string,
  onChunk: (text: string) => void,
  onEnd: () => void,
  onError: (err: any) => void,
  abortSignal?: AbortSignal,
  tools?: ToolDefinition[],
  onToolCall?: (toolCall: { name: string; arguments: any; id?: string }) => void,
  imageData?: Array<{ base64: string; mimeType?: string }>
): Promise<{ cancel: () => void }> {

  const validation = validateCustomLLMConfig(apiConfig);
  if (!validation.valid) {
    onError(new Error(validation.error || 'Invalid custom LLM config'));
    return { cancel: () => {} };
  }

  apiConfig = autoConfigureCustomLLM(apiConfig);

  // Build the user message — multimodal if images are present
  let userContent: ChatMessage['content'] = message;
  if (imageData && imageData.length > 0 && message) {
    const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: message },
    ];
    for (const img of imageData) {
      const mime = img.mimeType || 'image/png';
      parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${img.base64}` } });
    }
    userContent = parts;
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userContent }
  ];
  
  const options: StreamOptions = {
    model: apiConfig.model || 'gpt-3.5-turbo',
    messages,
    apiConfig,
    maxTokens: getModelMetadata(apiConfig.model || '').maxTokens,
    tools,
    onChunk,
    onToolCall,
    onEnd,
    onError,
    signal: abortSignal
  };
  
  // Route to appropriate provider
  switch (apiConfig.provider) {
    case 'anthropic':
      streamAnthropic(options);
      break;

    case 'claude-code':
      streamClaudeCode(options);
      break;

    case 'codex':
      streamCodex(options);
      break;

    case 'openai':
    case 'openrouter':
    case 'groq':
    case 'deepseek':
    case 'google-ai-studio':
      streamOpenAI(options);
      break;
    case 'google-gemini':
      streamGoogleGeminiNative(options);
      break;
    case 'huggingface':
    case 'cerebras':
    case 'sambanova':
    case 'together':
    case 'custom':
    default:
      streamOpenAI(options);
      break;
  }
  
  return {
    cancel: () => {
      // AbortController will handle cancellation
    }
  };
}

/**
 * Validate custom LLM configuration
 */
export function validateCustomLLMConfig(config?: CustomLLMConfig): { valid: boolean; error?: string } {
  if (!config) {
    return { valid: false, error: 'No custom LLM configuration provided' };
  }

  // Claude Code runs as a local subprocess on the user's own subscription:
  // there is no endpoint to call and no API key to supply. apiUrl, if set at
  // all, is an optional override for the CLI's location.
  if (config.provider === 'claude-code') {
    if (!config.model) {
      return { valid: false, error: 'Choose which Claude model to use' };
    }
    return { valid: true };
  }

  // Codex is the same shape: a local CLI signed in to a ChatGPT account, so
  // no endpoint and no key. 'default' is always acceptable.
  if (config.provider === 'codex') {
    if (!config.model) {
      return { valid: false, error: 'Choose which Codex model to use' };
    }
    return { valid: true };
  }

  if (!config.apiUrl) {
    return { valid: false, error: 'API URL is required' };
  }

  if (!config.apiKey && config.provider !== 'custom') {
    return { valid: false, error: 'API key is required for this provider' };
  }

  if (!config.model && config.provider !== 'custom') {
    return { valid: false, error: 'Model name is required' };
  }
  
  return { valid: true };
}

/**
 * One-shot, non-streaming generation from whichever cloud provider is active.
 *
 * Exists because three separate features — quiz generation, conversation
 * titles, and code-model routing — each hand-rolled the same axios call:
 *
 *     const apiUrl = cfg.apiUrl || PROVIDER_API_URLS[cfg.provider] || '';
 *     axios.post(`${apiUrl}/chat/completions`, ...)
 *
 * That shape assumes every cloud provider is an HTTP endpoint. `claude-code`
 * is not — it is a local CLI subprocess with no apiUrl and no entry in
 * PROVIDER_API_URLS, so apiUrl resolved to '' and axios threw "Invalid URL".
 * Observed live: the Quiz panel showing "Invalid URL" and refusing to start
 * while the Claude subscription provider was selected.
 *
 * Rather than patch a claude-code branch into three places (and miss the
 * fourth next time), this routes through streamFromCustomLLM — which already
 * knows how to reach every provider, subprocess ones included — and buffers
 * the result. One dispatch table, not four.
 */
export async function generateFromCustomLLM(
  apiConfig: CustomLLMConfig,
  systemPrompt: string,
  userPrompt: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;

  return new Promise<string>((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const controller = new AbortController();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      reject(new Error(`Generation timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    void streamFromCustomLLM(
      userPrompt,
      [],                       // no history: these are one-shot utility calls
      apiConfig,
      systemPrompt,
      (text) => { buffer += text; },
      () => finish(() => resolve(buffer)),
      (err) => finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
      controller.signal,
    ).catch((err) => finish(() => reject(err instanceof Error ? err : new Error(String(err)))));
  });
}
