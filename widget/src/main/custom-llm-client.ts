/**
 * Custom LLM API client supporting multiple providers (OpenAI, Anthropic, OpenRouter, Custom)
 * Includes function calling support, retry logic, and provider auto-detection
 */
import axios, { AxiosError } from 'axios';
import type { CustomLLMConfig, CustomModelInfo, ModelMetadata } from '../shared/types';
import type { ToolDefinition, OpenAITool, toOpenAITool } from './tools/types';

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
  'gpt-3.5-turbo': { contextWindow: 16385, maxTokens: 4096, supportsTools: true, supportsVision: false, supportsStreaming: true },
  'claude-3-5-sonnet': { contextWindow: 200000, maxTokens: 8192, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-3-opus': { contextWindow: 200000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
  'claude-3-sonnet': { contextWindow: 200000, maxTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true },
};

const ANTHROPIC_MODELS: CustomModelInfo[] = [
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Most capable Claude model', provider: 'anthropic' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fast Claude 3.5 tier', provider: 'anthropic' },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Creative + high cognitive load', provider: 'anthropic' },
  { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', description: 'Balanced latency + IQ', provider: 'anthropic' },
  { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Fast, cost-efficient', provider: 'anthropic' },
];

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
function detectProvider(modelName: string): 'openai' | 'anthropic' | 'openrouter' | 'custom' {
  const lower = modelName.toLowerCase();
  if (lower.includes('gpt') || lower.includes('o1')) return 'openai';
  if (lower.includes('claude')) return 'anthropic';
  return 'custom';
}

/**
 * Get model metadata with defaults
 */
export function getModelMetadata(modelName: string): ModelMetadata {
  const defaults: ModelMetadata = {
    contextWindow: 4096,
    maxTokens: 2000,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true
  };
  
  // Check exact match
  if (MODEL_METADATA[modelName]) {
    return { ...defaults, ...MODEL_METADATA[modelName] };
  }
  
  // Check partial match
  for (const [key, metadata] of Object.entries(MODEL_METADATA)) {
    if (modelName.includes(key)) {
      return { ...defaults, ...metadata };
    }
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
async function streamOpenAI(options: StreamOptions): Promise<void> {
  const { apiConfig, messages, model, temperature = 0.7, maxTokens = 2000, tools, onChunk, onToolCall, onEnd, onError, signal } = options;
  
  // Convert tools to OpenAI format
  const openaiTools = tools?.map(tool => {
    const { toOpenAITool } = require('./tools/types');
    return toOpenAITool(tool);
  });
  
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
          } : {})
        },
        responseType: 'stream',
        timeout: 0,
        signal
      }
    ), 3, 1000); // 3 retries, 1 second base delay

    const stream = response.data as NodeJS.ReadableStream;
    let currentToolCall: { id: string; name: string; arguments: string } | null = null;
    
    stream.on('data', (chunk: Buffer) => {
      try {
        const lines = chunk.toString('utf8').split('\n').filter(line => line.trim());
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
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
              onEnd();
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              
              // Handle text content
              if (delta?.content) {
                onChunk(delta.content);
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
    
    stream.on('end', () => onEnd());
    stream.on('error', (err) => onError(err));
  } catch (err: any) {
    onError(err);
  }
}

/**
 * Stream from Anthropic API (different format)
 */
async function streamAnthropic(options: StreamOptions): Promise<void> {
  const { apiConfig, messages, model, temperature = 0.7, maxTokens = 2000, onChunk, onEnd, onError, signal } = options;
  
  // Anthropic requires system message to be separate
  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const anthropicMessages = messages.filter(m => m.role !== 'system');
  
  try {
    const response = await axios.post(
      `${apiConfig.apiUrl}/messages`,
      {
        model: model || apiConfig.model || 'claude-3-5-sonnet-20241022',
        max_tokens: maxTokens,
        temperature,
        system: systemMessage,
        messages: anthropicMessages,
        stream: true
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
    
    stream.on('data', (chunk: Buffer) => {
      try {
        const lines = chunk.toString('utf8').split('\n').filter(line => line.trim());
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                onChunk(parsed.delta.text);
              }
              
              if (parsed.type === 'message_stop') {
                onEnd();
                return;
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
        }
      } catch (e) {
        console.error('[Custom LLM] Error processing Anthropic chunk:', e);
      }
    });
    
    stream.on('end', () => onEnd());
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
  
  // Auto-detect provider if not set correctly
  if (config.model && !config.provider) {
    validated.provider = detectProvider(config.model);
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

  if (provider === 'anthropic') {
    return ANTHROPIC_MODELS;
  }

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
  
  // Validate and enhance config
  apiConfig = validateCustomLLMConfig(apiConfig);
  
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
    case 'custom':
    default:
      // OpenAI format is most common, use as default
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
