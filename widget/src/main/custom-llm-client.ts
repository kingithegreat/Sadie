/**
 * Custom LLM API client supporting multiple providers (OpenAI, Anthropic, OpenRouter, Custom)
 */
import axios from 'axios';
import type { CustomLLMConfig, ImageAttachment } from '../shared/types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface StreamOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  apiConfig: CustomLLMConfig;
  onChunk: (text: string) => void;
  onEnd: () => void;
  onError: (err: any) => void;
  signal?: AbortSignal;
}

/**
 * Stream from OpenAI-compatible API (most common format)
 */
async function streamOpenAI(options: StreamOptions): Promise<void> {
  const { apiConfig, messages, model, temperature = 0.7, maxTokens = 2000, onChunk, onEnd, onError, signal } = options;
  
  try {
    const response = await axios.post(
      `${apiConfig.apiUrl}/chat/completions`,
      {
        model: model || apiConfig.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true
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
    );

    const stream = response.data as NodeJS.ReadableStream;
    
    stream.on('data', (chunk: Buffer) => {
      try {
        const lines = chunk.toString('utf8').split('\n').filter(line => line.trim());
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            if (data === '[DONE]') {
              onEnd();
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                onChunk(content);
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
 * Main streaming function that routes to the appropriate provider
 */
export async function streamFromCustomLLM(
  message: string,
  conversationHistory: ChatMessage[],
  apiConfig: CustomLLMConfig,
  systemPrompt: string,
  onChunk: (text: string) => void,
  onEnd: () => void,
  onError: (err: any) => void,
  abortSignal?: AbortSignal
): Promise<{ cancel: () => void }> {
  
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
    onChunk,
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
