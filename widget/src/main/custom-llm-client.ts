/**
 * Custom LLM API client supporting multiple providers (OpenAI, Anthropic, OpenRouter, Custom)
 * Includes function calling support, retry logic, and provider auto-detection
 */
import axios from 'axios';
import type { CustomLLMConfig, CustomModelInfo, ModelMetadata } from '../shared/types';
import type { ToolDefinition } from './tools/types';
import { toOpenAITool, toAnthropicTool } from './tools/types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
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
}

// Model metadata database
const MODEL_METADATA: Record<string, Partial<ModelMetadata>> = {
  'gpt-4': { contextWindow: 8192, maxTokens: 4096, supportsTools: true, supportsVision: false, supportsStreaming: true },
  'gpt-4-turbo': { contextWindow: 128000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'gpt-4o': { contextWindow: 128000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'gpt-4o-mini': { contextWindow: 128000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'gpt-3.5-turbo': { contextWindow: 16385, maxTokens: 4096, supportsTools: true, supportsVision: false, supportsStreaming: true },
  'claude-opus-4': { contextWindow: 200000, maxTokens: 16384, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-sonnet-4': { contextWindow: 200000, maxTokens: 16384, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-3-5-sonnet': { contextWindow: 200000, maxTokens: 8192, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-3-5-haiku': { contextWindow: 200000, maxTokens: 8192, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-3-opus': { contextWindow: 200000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-3-sonnet': { contextWindow: 200000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-3-haiku': { contextWindow: 200000, maxTokens: 4096, supportsTools: true, supportsVision: false, supportsStreaming: true },
};

const ANTHROPIC_MODELS: CustomModelInfo[] = [
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most capable, reasoning & complex tasks', provider: 'anthropic', costHint: '~$15/1M in' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Fast, intelligent, great for tools', provider: 'anthropic', costHint: '~$3/1M in' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'High intelligence, fast', provider: 'anthropic', costHint: '~$3/1M in' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fast & affordable', provider: 'anthropic', costHint: '~$0.80/1M in' },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Complex tasks, creative', provider: 'anthropic', costHint: '~$15/1M in' },
  { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Fastest, cost-efficient', provider: 'anthropic', costHint: '~$0.25/1M in' },
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
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: '32K context, strong reasoning', provider: 'groq', contextWindow: 32768, costHint: 'Free tier' },
  { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B', description: 'High quality', provider: 'groq', contextWindow: 128000, costHint: 'Free tier' },
];

// DeepSeek — GPT-4 class quality at ~20x lower cost than GPT-4o
const DEEPSEEK_MODELS: CustomModelInfo[] = [
  { id: 'deepseek-chat', name: 'DeepSeek V3', description: 'GPT-4 class quality', provider: 'deepseek', contextWindow: 64000, costHint: '~$0.27/1M in' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1', description: 'Reasoning model, rivals o1', provider: 'deepseek', contextWindow: 64000, costHint: '~$0.55/1M in' },
];

// Google AI Studio — Gemini models with generous free tier
const GOOGLE_AI_MODELS: CustomModelInfo[] = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast & smart', provider: 'google-ai-studio', contextWindow: 1048576, costHint: 'Free tier' },
  { id: 'gemini-2.0-flash-thinking-exp', name: 'Gemini 2.0 Flash Thinking', description: 'Reasoning mode', provider: 'google-ai-studio', contextWindow: 1048576, costHint: 'Free tier' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: '1M context window', provider: 'google-ai-studio', contextWindow: 1048576, costHint: '~$1.25/1M in' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast', provider: 'google-ai-studio', contextWindow: 1048576, costHint: 'Free tier' },
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
  huggingface: 'https://api-inference.huggingface.co/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  together: 'https://api.together.xyz/v1',
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
        max_tokens: maxTokens,
        stream: true,
        ...(openaiTools && openaiTools.length > 0 ? { tools: openaiTools, tool_choice: 'auto' } : {})
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.apiKey}`,
          ...(apiConfig.provider === 'openrouter' ? {
            'HTTP-Referer': 'https://sadie-app.local',
            'X-Title': 'SADIE Desktop Assistant'
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
  const system = messages.find(m => m.role === 'system')?.content || '';
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

    result.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
  }

  return { system, messages: result };
}

/**
 * Stream from Anthropic API with tool calling support.
 */
async function streamAnthropic(options: StreamOptions): Promise<void> {
  const { apiConfig, messages, model, temperature = 0.7, maxTokens = 2000,
          tools, onChunk, onToolCall, onEnd, onError, signal } = options;

  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
  const anthropicTools = tools && tools.length > 0 ? tools.map(toAnthropicTool) : undefined;

  try {
    const response = await axios.post(
      `${apiConfig.apiUrl}/messages`,
      {
        model: model || apiConfig.model || 'claude-3-5-sonnet-20241022',
        max_tokens: maxTokens,
        temperature,
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
    headers['HTTP-Referer'] = 'https://sadie-desktop.local';
    headers['X-Title'] = 'SADIE Desktop';
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
  onToolCall?: (toolCall: { name: string; arguments: any; id?: string }) => void
): Promise<{ cancel: () => void }> {
  
  // Validate config (don't assign — validateCustomLLMConfig returns {valid,error}, not a config)
  const validation = validateCustomLLMConfig(apiConfig);
  if (!validation.valid) {
    onError(new Error(validation.error || 'Invalid custom LLM config'));
    return { cancel: () => {} };
  }
  
  // Auto-configure provider detection and metadata
  apiConfig = autoConfigureCustomLLM(apiConfig);
  
  // Build messages array
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: message }
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

    case 'openai':
    case 'openrouter':
    case 'groq':
    case 'deepseek':
    case 'google-ai-studio':
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
