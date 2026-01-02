/**
 * External Model Provider Support
 * Supports: Ollama (local), OpenAI, Anthropic, Google (Gemini)
 */

import { SADIE_SYSTEM_PROMPT } from '../../shared/system-prompt';

export type ModelProvider = 'ollama' | 'openai' | 'anthropic' | 'google';

export interface ProviderConfig {
  provider: ModelProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onToolCall?: (name: string, args: any) => void;
  onEnd: () => void;
  onError: (err: any) => void;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

// Default models for each provider
export const DEFAULT_MODELS: Record<ModelProvider, string> = {
  ollama: 'llama3.2:3b',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-haiku-20240307',
  google: 'gemini-1.5-flash'
};

// Provider display names
export const PROVIDER_NAMES: Record<ModelProvider, string> = {
  ollama: 'Ollama (Local)',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)'
};

// Available models per provider
export const AVAILABLE_MODELS: Record<ModelProvider, string[]> = {
  ollama: ['llama3.2:3b', 'llama3.1:8b', 'mistral:7b', 'codellama:7b', 'dolphin-llama3:8b', 'llava'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'],
  google: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro']
};

/**
 * Stream from OpenAI API
 */
export async function streamFromOpenAI(
  config: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  const { apiKey, model = DEFAULT_MODELS.openai, baseUrl = 'https://api.openai.com/v1' } = config;
  
  if (!apiKey) {
    callbacks.onError(new Error('OpenAI API key is required. Add it in Settings.'));
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.tool_calls && { tool_calls: m.tool_calls }),
          ...(m.tool_call_id && { tool_call_id: m.tool_call_id })
        })),
        tools: tools?.length ? tools : undefined,
        stream: true
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      callbacks.onError(new Error(`OpenAI API error: ${response.status} - ${errorText}`));
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError(new Error('No response body from OpenAI'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { id: string; name: string; arguments: string } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            // Finalize any pending tool call
            if (currentToolCall) {
              try {
                const args = JSON.parse(currentToolCall.arguments || '{}');
                callbacks.onToolCall?.(currentToolCall.name, args);
              } catch (e) {
                console.error('[OpenAI] Failed to parse tool args:', e);
              }
              currentToolCall = null;
            }
            callbacks.onEnd();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            
            if (delta?.content) {
              callbacks.onChunk(delta.content);
            }
            
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  // Finalize previous tool call
                  if (currentToolCall) {
                    try {
                      const args = JSON.parse(currentToolCall.arguments || '{}');
                      callbacks.onToolCall?.(currentToolCall.name, args);
                    } catch (e) {
                      console.error('[OpenAI] Failed to parse tool args:', e);
                    }
                  }
                  currentToolCall = { id: tc.id, name: tc.function?.name || '', arguments: '' };
                }
                if (tc.function?.name && currentToolCall) {
                  currentToolCall.name = tc.function.name;
                }
                if (tc.function?.arguments && currentToolCall) {
                  currentToolCall.arguments += tc.function.arguments;
                }
              }
            }
          } catch (e) {
            // Ignore parse errors for partial data
          }
        }
      }
    }
    
    callbacks.onEnd();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      callbacks.onEnd();
    } else {
      callbacks.onError(err);
    }
  }
}

/**
 * Stream from Anthropic API
 */
export async function streamFromAnthropic(
  config: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  const { apiKey, model = DEFAULT_MODELS.anthropic, baseUrl = 'https://api.anthropic.com/v1' } = config;
  
  if (!apiKey) {
    callbacks.onError(new Error('Anthropic API key is required. Add it in Settings.'));
    return;
  }

  // Extract system message and convert to Anthropic format
  const systemMessage = messages.find(m => m.role === 'system')?.content || SADIE_SYSTEM_PROMPT;
  const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  // Convert tools to Anthropic format
  const anthropicTools = tools?.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters
  }));

  try {
    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemMessage,
        messages: chatMessages,
        tools: anthropicTools?.length ? anthropicTools : undefined,
        stream: true
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      callbacks.onError(new Error(`Anthropic API error: ${response.status} - ${errorText}`));
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError(new Error('No response body from Anthropic'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolUse: { id: string; name: string; input: string } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'content_block_start') {
              if (parsed.content_block?.type === 'tool_use') {
                currentToolUse = {
                  id: parsed.content_block.id,
                  name: parsed.content_block.name,
                  input: ''
                };
              }
            }
            
            if (parsed.type === 'content_block_delta') {
              if (parsed.delta?.type === 'text_delta') {
                callbacks.onChunk(parsed.delta.text);
              }
              if (parsed.delta?.type === 'input_json_delta' && currentToolUse) {
                currentToolUse.input += parsed.delta.partial_json;
              }
            }
            
            if (parsed.type === 'content_block_stop' && currentToolUse) {
              try {
                const args = JSON.parse(currentToolUse.input || '{}');
                callbacks.onToolCall?.(currentToolUse.name, args);
              } catch (e) {
                console.error('[Anthropic] Failed to parse tool input:', e);
              }
              currentToolUse = null;
            }
            
            if (parsed.type === 'message_stop') {
              callbacks.onEnd();
              return;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
    callbacks.onEnd();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      callbacks.onEnd();
    } else {
      callbacks.onError(err);
    }
  }
}

/**
 * Stream from Google Gemini API
 */
export async function streamFromGoogle(
  config: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  const { apiKey, model = DEFAULT_MODELS.google } = config;
  
  if (!apiKey) {
    callbacks.onError(new Error('Google API key is required. Add it in Settings.'));
    return;
  }

  // Convert messages to Gemini format
  const systemInstruction = messages.find(m => m.role === 'system')?.content || SADIE_SYSTEM_PROMPT;
  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  // Convert tools to Gemini format
  const geminiTools = tools?.length ? [{
    functionDeclarations: tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters
    }))
  }] : undefined;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        tools: geminiTools,
        generationConfig: {
          maxOutputTokens: 4096
        }
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      callbacks.onError(new Error(`Google API error: ${response.status} - ${errorText}`));
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError(new Error('No response body from Google'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      // Google returns JSON array chunks
      try {
        // Try to parse complete JSON objects
        const jsonMatch = buffer.match(/\{[\s\S]*?\}(?=\s*[,\]]|$)/g);
        if (jsonMatch) {
          for (const json of jsonMatch) {
            try {
              const parsed = JSON.parse(json);
              const parts = parsed.candidates?.[0]?.content?.parts;
              if (parts) {
                for (const part of parts) {
                  if (part.text) {
                    callbacks.onChunk(part.text);
                  }
                  if (part.functionCall) {
                    callbacks.onToolCall?.(part.functionCall.name, part.functionCall.args || {});
                  }
                }
              }
            } catch (e) {
              // Partial JSON, continue buffering
            }
          }
        }
      } catch (e) {
        // Continue buffering
      }
    }
    
    callbacks.onEnd();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      callbacks.onEnd();
    } else {
      callbacks.onError(err);
    }
  }
}

/**
 * Main entry point - routes to appropriate provider
 */
export async function streamFromProvider(
  config: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  console.log(`[Providers] Streaming from ${config.provider}, model: ${config.model || DEFAULT_MODELS[config.provider]}`);
  
  switch (config.provider) {
    case 'openai':
      return streamFromOpenAI(config, messages, tools, callbacks, abortSignal);
    case 'anthropic':
      return streamFromAnthropic(config, messages, tools, callbacks, abortSignal);
    case 'google':
      return streamFromGoogle(config, messages, tools, callbacks, abortSignal);
    case 'ollama':
    default:
      // Ollama is handled by the existing streamFromOllamaWithTools
      callbacks.onError(new Error('Use streamFromOllamaWithTools for Ollama provider'));
  }
}
