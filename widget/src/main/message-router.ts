import { ipcMain, BrowserWindow, IpcMainEvent } from 'electron';
import axios from 'axios';
import streamFromSadieProxy from './stream-proxy-client';
import { SadieRequest, SadieResponse, SadieRequestWithImages, ImageAttachment, DocumentAttachment } from '../shared/types';
import { IPC_SEND_MESSAGE, SADIE_WEBHOOK_PATH, DEFAULT_OLLAMA_URL } from '../shared/constants';
import { getMainWindow } from './window-manager';
import { initializeTools, getOllamaTools, executeTool, ToolCall, ToolContext } from './tools';
import { documentToolHandlers } from './tools/documents';

const DEFAULT_TIMEOUT = 30000;
const OLLAMA_URL = process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;

// Image attachment limits (mirror renderer defaults)
const MAX_IMAGES = 5;
const MAX_PER_IMAGE = 5 * 1024 * 1024; // 5 MB
const MAX_TOTAL = 10 * 1024 * 1024; // 10 MB

function estimateSizeFromBase64(base64?: string) {
  if (!base64) return 0;
  // Rough estimate: every 4 base64 chars -> 3 bytes
  return Math.floor((base64.length * 3) / 4);
}

function validateImages(images?: any[]) {
  if (!images || !Array.isArray(images) || images.length === 0) return { ok: true };
  if (images.length > MAX_IMAGES) return { ok: false, code: 'IMAGE_LIMIT_EXCEEDED', message: `Too many images (max ${MAX_IMAGES}).` };

  let total = 0;
  for (const img of images) {
    let size = 0;
    if (typeof img.size === 'number') size = img.size;
    else if (typeof img.data === 'string') size = estimateSizeFromBase64(img.data);
    // if size still zero, we can't validate confidently; treat as ok
    if (size > MAX_PER_IMAGE) return { ok: false, code: 'IMAGE_LIMIT_EXCEEDED', message: `Image ${img.filename || ''} exceeds per-image limit (${MAX_PER_IMAGE} bytes).` };
    total += size;
    if (total > MAX_TOTAL) return { ok: false, code: 'IMAGE_LIMIT_EXCEEDED', message: `Total attachments exceed ${MAX_TOTAL} bytes.` };
  }
  return { ok: true };
}

/**
 * Parse documents and return their text content to be included in the message context
 */
async function parseDocuments(documents: DocumentAttachment[]): Promise<string[]> {
  const parsedTexts: string[] = [];
  
  for (const doc of documents) {
    try {
      const result = await documentToolHandlers.parse_document({
        document_id: doc.id,
        filename: doc.filename,
        data: doc.data,
        mime_type: doc.mimeType
      }, { executionId: `parse-${Date.now()}` });
      
      if (result.success && result.result) {
        // Get the full content
        const contentResult = await documentToolHandlers.get_document_content({
          document_id: doc.id
        }, { executionId: `content-${Date.now()}` });
        
        if (contentResult.success && contentResult.result?.content) {
          parsedTexts.push(`=== Document: ${doc.filename} ===\n${contentResult.result.content}\n=== End of ${doc.filename} ===`);
        }
      } else {
        console.error(`[SADIE] Failed to parse document ${doc.filename}:`, result.error);
        parsedTexts.push(`[Failed to parse document: ${doc.filename} - ${result.error}]`);
      }
    } catch (err: any) {
      console.error(`[SADIE] Error parsing document ${doc.filename}:`, err);
      parsedTexts.push(`[Error parsing document: ${doc.filename} - ${err.message}]`);
    }
  }
  
  return parsedTexts;
}

// Track active streams (Node Readable) by streamId so we can cancel them
const activeStreams: Map<string, { destroy?: () => void; stream?: NodeJS.ReadableStream }> = new Map();

// ============================================
// Conversation History Management
// ============================================
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// Store conversation history by conversation_id (limited to last N messages)
const conversationHistory: Map<string, ConversationMessage[]> = new Map();
const MAX_HISTORY_MESSAGES = 20; // Keep last 20 messages per conversation

function addToHistory(conversationId: string, role: 'user' | 'assistant', content: string) {
  if (!conversationHistory.has(conversationId)) {
    conversationHistory.set(conversationId, []);
  }
  
  const history = conversationHistory.get(conversationId)!;
  history.push({ role, content, timestamp: Date.now() });
  
  // Trim to max size
  while (history.length > MAX_HISTORY_MESSAGES) {
    history.shift();
  }
}

function getHistory(conversationId: string): ConversationMessage[] {
  return conversationHistory.get(conversationId) || [];
}

function clearHistory(conversationId: string) {
  conversationHistory.delete(conversationId);
}

function mapErrorToSadieResponse(error: any): SadieResponse {
  if (error.code === 'ECONNREFUSED') {
    return {
      success: false,
      error: true,
      message: 'Connection refused by backend.',
      details: error.message,
      response: 'NETWORK_ERROR'
    };
  }
  if (error.code === 'ECONNABORTED') {
    return {
      success: false,
      error: true,
      message: 'Request timed out.',
      details: error.message,
      response: 'TIMEOUT'
    };
  }
  return {
    success: false,
    error: true,
    message: 'Unknown error occurred.',
    details: error.message,
    response: 'UNKNOWN_ERROR'
  };
}

// SADIE system prompt for direct Ollama mode with tools
// Get actual user paths for the prompt
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
const USERNAME = require('os').userInfo().username;

const SADIE_SYSTEM_PROMPT = `You are Sadie — a sweet, supportive, privacy-first AI assistant that runs fully locally.
Be warm, helpful, and conversational. Keep responses concise but friendly.

You have access to various tools. IMPORTANT: When calling tools, you MUST provide complete, valid arguments.

=== USER SYSTEM INFO ===
- Username: ${USERNAME}
- Home directory: ${HOME_DIR}
- Desktop: ${HOME_DIR}/Desktop
- Documents: ${HOME_DIR}/Documents
- Downloads: ${HOME_DIR}/Downloads

=== FILE SYSTEM TOOLS ===
IMPORTANT PATH RULES:
1. Use simple relative paths like "Desktop/filename.txt" - they auto-expand to the user's home
2. When asked to put a file IN a folder, include the folder in the path: "Desktop/foldername/filename.txt"
3. To CREATE A FILE, use write_file (NOT create_directory)
4. To CREATE A FOLDER, use create_directory

Examples:
- "Create a folder called Projects on desktop" → create_directory with path="Desktop/Projects"
- "Create a file called notes.txt on desktop" → write_file with path="Desktop/notes.txt" content=""
- "Create hello.txt inside the Projects folder" → write_file with path="Desktop/Projects/hello.txt" content=""
- "Write 'Hello World' to test.txt" → write_file with path="Desktop/test.txt" content="Hello World"
- "List my Desktop" → list_directory with path="Desktop"
- "Read config.txt from desktop" → read_file with path="Desktop/config.txt"
- "Delete the test folder" → delete_file with path="Desktop/test" recursive=true

=== SYSTEM TOOLS ===
- "What's my system info?" → get_system_info
- "Open calculator" → launch_app with appName="calculator"
- "Open VS Code" → launch_app with appName="code"
- "What's 256 * 128?" → calculate with expression="256 * 128"
- "What time is it?" → get_current_time
- "What's on my clipboard?" → get_clipboard
- "Copy this: hello" → set_clipboard with text="hello"

=== WEB TOOLS ===
- "Search for Python tutorials" → web_search with query="Python tutorials"
- "What's the weather in London?" → get_weather with location="London"
- "Get content from this URL" → fetch_url with url="https://example.com"
- "Search the news about AI" → web_search with query="latest AI news"

Use web_search when you need current/up-to-date information or facts you're unsure about.
Use get_weather for weather questions.
Use fetch_url to read content from a specific webpage.

=== MEMORY TOOLS ===
- "Remember that I like dark mode" → remember with content="User prefers dark mode"
- "Remember my name is John" → remember with content="User's name is John" category="fact"
- "What do you remember about me?" → recall with query="user preferences and facts"
- "What's my name?" → recall with query="user's name"
- "List all memories" → list_memories
- "Forget memory xyz" → forget with memoryId="xyz"

Use remember to store important facts about the user that should persist across conversations.
Use recall to search your memories when the user asks about something you should know.
Proactively recall relevant memories when they might help answer a question.

=== AVAILABLE APPS ===
notepad, calculator, explorer, cmd, powershell, code (VS Code), chrome, firefox, edge, paint, word, excel, spotify, discord, terminal, settings, task manager

CRITICAL: Never call a tool with empty arguments. Always provide required parameters.`;

// Vision model for image analysis
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava';
// Default model for chat (should support tools)
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
// Uncensored model
const OLLAMA_UNCENSORED_MODEL = process.env.OLLAMA_UNCENSORED_MODEL || 'dolphin-llama3:8b';

// Current mode (can be toggled via IPC)
let uncensoredModeEnabled = false;

export function setUncensoredMode(enabled: boolean) {
  uncensoredModeEnabled = enabled;
  console.log(`[SADIE] Uncensored mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

export function getUncensoredMode(): boolean {
  return uncensoredModeEnabled;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: any[];
}

// Stream from Ollama with tool calling support
async function streamFromOllamaWithTools(
  message: string, 
  images: ImageAttachment[] | undefined,
  conversationId: string,
  onChunk: (text: string) => void, 
  onToolCall: (toolName: string, args: any) => void,
  onToolResult: (result: any) => void,
  onEnd: () => void, 
  onError: (err: any) => void,
  requestConfirmation?: (msg: string) => Promise<boolean>
): Promise<{ cancel: () => void }> {
  const controller = new AbortController();
  let ended = false;
  let chunkCount = 0;
  
  const safeEnd = (reason: string) => {
    console.log(`[SADIE] safeEnd called: reason=${reason}, ended=${ended}, chunks=${chunkCount}`);
    if (!ended) {
      ended = true;
      onEnd();
    }
  };
  
  const safeError = (err: any, source: string) => {
    console.error(`[SADIE] safeError called: source=${source}, ended=${ended}, chunks=${chunkCount}, error=`, err?.message || err);
    if (!ended) {
      ended = true;
      onError(err);
    }
  };
  
  // Check if we have images - use vision model if so (vision models typically don't support tools)
  const hasImages = images && images.length > 0;
  // Select model: vision > uncensored > normal
  const chatModel = uncensoredModeEnabled ? OLLAMA_UNCENSORED_MODEL : OLLAMA_CHAT_MODEL;
  const model = hasImages ? OLLAMA_VISION_MODEL : chatModel;
  
  // Extract base64 image data for Ollama
  const imageData: string[] = [];
  if (hasImages) {
    for (const img of images) {
      let base64 = img.data || img.base64 || '';
      if (!base64 && img.dataUrl) {
        const match = img.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (match) base64 = match[1];
      }
      if (base64) {
        imageData.push(base64);
      }
    }
  }
  
  // Build messages array for chat API - include conversation history
  const history = getHistory(conversationId);
  const messages: ChatMessage[] = [
    { role: 'system', content: SADIE_SYSTEM_PROMPT },
  ];
  
  // Add conversation history (last N messages for context)
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }
  
  // Add current user message
  messages.push({ 
    role: 'user', 
    content: message,
    ...(imageData.length > 0 ? { images: imageData } : {})
  });
  
  // Get tools (disable for vision models and uncensored mode as they don't support tools well)
  const tools = (hasImages || uncensoredModeEnabled) ? undefined : getOllamaTools();
  
  console.log(`[SADIE] streamFromOllamaWithTools: model=${model}, images=${imageData.length}, tools=${tools?.length || 0}, history=${history.length}, uncensored=${uncensoredModeEnabled}, message="${message.substring(0, 30)}..."`);
  
  // Tool execution context
  const toolContext: ToolContext = {
    executionId: `exec-${Date.now()}`,
    requestConfirmation
  };

  // Recursive function to handle tool calls
  async function processResponse(): Promise<void> {
    try {
      const requestBody: any = {
        model,
        messages,
        stream: true
      };
      
      if (tools && tools.length > 0) {
        requestBody.tools = tools;
      }
      
      const response = await axios.post(`${OLLAMA_URL}/api/chat`, requestBody, {
        responseType: 'stream',
        timeout: 0,
        signal: controller.signal
      });

      console.log('[SADIE] Ollama chat stream connected...');
      const stream = response.data as NodeJS.ReadableStream;
      
      let assistantContent = '';
      let pendingToolCalls: any[] = [];
      
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          try {
            const lines = chunk.toString('utf8').split('\n').filter(line => line.trim());
            for (const line of lines) {
              if (!line) continue;
              const parsed = JSON.parse(line);
              
              // Handle content chunks
              if (parsed.message?.content) {
                chunkCount++;
                assistantContent += parsed.message.content;
                onChunk(parsed.message.content);
              }
              
              // Handle tool calls
              if (parsed.message?.tool_calls) {
                pendingToolCalls = parsed.message.tool_calls;
              }
              
              if (parsed.done) {
                console.log(`[SADIE] Response done, chunks=${chunkCount}, toolCalls=${pendingToolCalls.length}`);
                resolve();
              }
            }
          } catch (e) {
            // Partial JSON, ignore
          }
        });
        
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      
      // Process tool calls if any
      if (pendingToolCalls.length > 0) {
        // Add assistant message with tool calls to history
        messages.push({
          role: 'assistant',
          content: assistantContent,
          tool_calls: pendingToolCalls
        });
        
        // Execute each tool call
        for (const toolCall of pendingToolCalls) {
          const toolName = toolCall.function?.name;
          const toolArgs = toolCall.function?.arguments || {};
          
          console.log(`[SADIE] Executing tool: ${toolName}`, toolArgs);
          onToolCall(toolName, toolArgs);
          
          // Parse arguments if they're a string
          let args = toolArgs;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { }
          }
          
          const result = await executeTool(
            { name: toolName, arguments: args },
            toolContext
          );
          
          console.log(`[SADIE] Tool result:`, result);
          onToolResult(result);
          
          // Add tool result to messages
          messages.push({
            role: 'tool',
            content: JSON.stringify(result)
          });
        }
        
        // Continue the conversation with tool results
        await processResponse();
      } else {
        // No more tool calls, we're done
        safeEnd('conversation-complete');
      }
      
    } catch (err: any) {
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        safeEnd('cancelled');
      } else {
        console.error('[SADIE] Chat error:', err?.message || err);
        safeError(err, 'chat-error');
      }
    }
  }
  
  // Start processing
  processResponse();
  
  return {
    cancel: () => {
      console.log('[SADIE] Stream cancel requested');
      controller.abort();
    }
  };
}

// Legacy streamFromOllama for backward compatibility (no tools)
async function streamFromOllama(
  message: string, 
  images: ImageAttachment[] | undefined,
  conversationId: string,
  onChunk: (text: string) => void, 
  onEnd: () => void, 
  onError: (err: any) => void,
  requestConfirmation?: (msg: string) => Promise<boolean>
): Promise<{ cancel: () => void }> {
  return streamFromOllamaWithTools(
    message,
    images,
    conversationId,
    onChunk,
    () => {}, // ignore tool calls
    () => {}, // ignore tool results
    onEnd,
    onError,
    requestConfirmation
  );
}

export function registerMessageRouter(mainWindow: BrowserWindow, n8nUrl: string) {
    // Initialize tools system
    initializeTools();
    
    // Track pending confirmation requests
    const pendingConfirmations = new Map<string, { resolve: (confirmed: boolean) => void }>();
    
    // Handle confirmation responses from renderer
    ipcMain.on('sadie:confirmation-response', (_event: IpcMainEvent, data: { confirmationId: string; confirmed: boolean }) => {
      const pending = pendingConfirmations.get(data.confirmationId);
      if (pending) {
        pending.resolve(data.confirmed);
        pendingConfirmations.delete(data.confirmationId);
      }
    });
    
    // Create confirmation requester for a specific event sender
    function createConfirmationRequester(sender: Electron.WebContents, streamId: string) {
      return async (message: string): Promise<boolean> => {
        const confirmationId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
        return new Promise<boolean>((resolve) => {
          // Set a timeout to auto-reject after 60 seconds
          const timeout = setTimeout(() => {
            pendingConfirmations.delete(confirmationId);
            resolve(false);
          }, 60000);
          
          pendingConfirmations.set(confirmationId, {
            resolve: (confirmed: boolean) => {
              clearTimeout(timeout);
              resolve(confirmed);
            }
          });
          
          // Send confirmation request to renderer
          sender.send('sadie:confirmation-request', { confirmationId, message, streamId });
        });
      };
    }
    
    // Streaming responses via HTTP chunked response (POST -> stream)
    ipcMain.on('sadie:stream-message', async (event: IpcMainEvent, request: SadieRequestWithImages & { streamId?: string }) => {
      const streamId = request?.streamId || `stream-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

      if (!request || typeof request !== 'object' || !request.user_id || !request.message || !request.conversation_id) {
        event.sender.send('sadie:stream-error', { error: true, message: 'Invalid request format.', streamId });
        return;
      }

      // Validate images (if provided) to guard the backend from oversized payloads
      const validation = validateImages((request as any).images);
      if (!validation.ok) {
        event.sender.send('sadie:stream-error', { error: true, code: validation.code, message: validation.message, streamId });
        return;
      }

      // Get conversation ID for history tracking
      const convId = request.conversation_id || 'default';
      
      // Create confirmation requester for this stream
      const requestConfirmation = createConfirmationRequester(event.sender, streamId);

      try {
        const streamUrl = `${n8nUrl}${SADIE_WEBHOOK_PATH}/stream`;

        // notify renderer that stream is starting
        event.sender.send('sadie:stream-start', { streamId });

        // Check if we should use direct Ollama mode (bypass n8n)
        const useDirectOllama = process.env.SADIE_DIRECT_OLLAMA === 'true' || process.env.SADIE_DIRECT_OLLAMA === '1';
        
        // Parse any attached documents and build enhanced message
        let enhancedMessage = request.message;
        if (request.documents && request.documents.length > 0) {
          console.log(`[SADIE] Parsing ${request.documents.length} document(s)...`);
          const documentContents = await parseDocuments(request.documents);
          if (documentContents.length > 0) {
            enhancedMessage = documentContents.join('\n\n') + '\n\n' + request.message;
          }
        }
        
        // Add user message to conversation history
        addToHistory(convId, 'user', enhancedMessage);
        
        // Track assistant response for history
        let assistantResponse = '';
        
        console.log('[SADIE] Stream request:', {
          streamId,
          useDirectOllama,
          env: process.env.SADIE_DIRECT_OLLAMA,
          streamUrl,
          conversationId: convId,
          historyLength: getHistory(convId).length,
          hasDocuments: request.documents?.length || 0,
          message: enhancedMessage.substring(0, 50)
        });
        
        if (useDirectOllama) {
          // Direct Ollama streaming - no n8n required
          const handler = await streamFromOllama(
            enhancedMessage,
            request.images,
            convId,
            (chunk) => {
              if (!activeStreams.has(streamId)) return;
              assistantResponse += chunk;
              event.sender.send('sadie:stream-chunk', { chunk, streamId });
            },
            () => {
              // Add assistant response to history
              if (assistantResponse.trim()) {
                addToHistory(convId, 'assistant', assistantResponse);
              }
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              activeStreams.delete(streamId);
            },
            (err) => {
              try { event.sender.send('sadie:stream-error', { error: true, message: 'Ollama error', details: err?.message || err, streamId }); } catch (e) {}
              activeStreams.delete(streamId);
            },
            requestConfirmation  // Pass confirmation requester
          );
          activeStreams.set(streamId, { destroy: handler.cancel });
          return;
        }

        // POST the request and expect a streaming (chunked) response
        const useProxy = !!(process.env.SADIE_PROXY_URL || process.env.SADIE_USE_PROXY === 'true');
        if (useProxy) {
          const proxyOpts = {
            proxyUrl: process.env.SADIE_PROXY_URL,
            apiKey: process.env.PROXY_API_KEYS || process.env.PROXY_API_KEY
          };

          const handler = streamFromSadieProxy(request, (chunk) => {
            try {
              // Only forward chunks while the stream is still active
              if (!activeStreams.has(streamId)) return;
              // forward raw chunk to renderer
              event.sender.send('sadie:stream-chunk', { chunk: chunk.toString?.() || String(chunk), streamId });
            } catch (err) {}
          }, () => {
            try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
            activeStreams.delete(streamId);
          }, (err) => {
            try { event.sender.send('sadie:stream-error', { error: true, message: 'Streaming error', details: err, streamId }); } catch (e) {}
            activeStreams.delete(streamId);
          }, proxyOpts);

          // store cancellation function
          activeStreams.set(streamId, { destroy: handler.cancel });
        } else {
          const res = await axios.post(streamUrl, request, {
            responseType: 'stream',
            timeout: 0,
            headers: { 'Content-Type': 'application/json' }
          });

          const stream = res.data as NodeJS.ReadableStream;

          // store stream and request so it can be cancelled/aborted quickly
          const req = (res as any)?.request;
          activeStreams.set(streamId, {
            stream,
            // call request.abort if available and also destroy the response stream
            destroy: () => {
              try { req?.abort?.(); } catch (e) {}
              try { (stream as any).destroy?.(); } catch (e) {}
            }
          });

          stream.on('data', (chunk: Buffer) => {
          try {
            // Only forward chunks while the stream is still active (not cancelled)
            if (!activeStreams.has(streamId)) return;
            const text = chunk.toString('utf8');
            // Forward raw chunk to renderer; renderer will append it to the assistant message
            event.sender.send('sadie:stream-chunk', { chunk: text, streamId });
          } catch (err) {
            // ignore chunk parse errors
          }
        });

          stream.on('end', () => {
            try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
            activeStreams.delete(streamId);
          });

          stream.on('error', (err: any) => {
            try { event.sender.send('sadie:stream-error', { error: true, message: 'Streaming error', details: err, streamId }); } catch (e) {}
            try { (stream as any).destroy(); } catch (e) {}
            activeStreams.delete(streamId);
          });
        }
      } catch (error: any) {
        // n8n failed - try direct Ollama as fallback
        console.log('[SADIE] n8n unavailable, falling back to direct Ollama...');
        try {
          let fallbackResponse = '';
          const handler = await streamFromOllama(
            request.message,
            request.images,
            convId,
            (chunk: string) => {
              if (!activeStreams.has(streamId)) return;
              fallbackResponse += chunk;
              event.sender.send('sadie:stream-chunk', { chunk, streamId });
            },
            () => {
              if (fallbackResponse.trim()) {
                addToHistory(convId, 'assistant', fallbackResponse);
              }
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              activeStreams.delete(streamId);
            },
            (err: any) => {
              try { event.sender.send('sadie:stream-error', { error: true, message: 'Ollama error', details: err?.message || err, streamId }); } catch (e) {}
              activeStreams.delete(streamId);
            }
          );
          activeStreams.set(streamId, { destroy: handler.cancel });
        } catch (ollamaError: any) {
          event.sender.send('sadie:stream-error', { error: true, message: 'Both n8n and Ollama unavailable', details: ollamaError?.message || ollamaError, streamId });
        }
      }
    });

    // Cancel a running stream by id (or all if no id provided)
    ipcMain.on('sadie:stream-cancel', (_event: IpcMainEvent, payload: { streamId?: string }) => {
      const { streamId } = payload || {};
      if (!streamId) {
        // cancel all
        for (const [id, entry] of activeStreams.entries()) {
          try { entry.destroy?.(); } catch (e) {}
          try { (entry.stream as any)?.destroy?.(); } catch (e) {}
          activeStreams.delete(id);
        }
        return;
      }

      const entry = activeStreams.get(streamId);
      if (entry) {
        // If we're running in an E2E environment, send a best-effort cancel
        // POST to the upstream mock so it stops emitting immediately. This
        // helps make cancel behavior deterministic in tests.
        try {
          if (process.env.SADIE_E2E === '1') {
            // Don't await — fire and forget
            axios.post(`${n8nUrl}/__sadie_e2e_cancel`, { streamId }).catch(() => {});
          }
        } catch (e) {}
        // Remove from the active map immediately so any in-flight data handlers
        // will stop forwarding further chunks.
        activeStreams.delete(streamId);
        // notify renderer the stream ended due to cancel
        _event?.sender?.send('sadie:stream-end', { streamId, cancelled: true });
        // then attempt to abort/destroy the underlying stream/request
        try { entry.destroy?.(); } catch (e) {}
        try { (entry.stream as any)?.destroy?.(); } catch (e) {}
      }
    });
  ipcMain.handle(IPC_SEND_MESSAGE, async (_event, request: SadieRequestWithImages | SadieRequest) => {
    if (!request || typeof request !== 'object' || !request.user_id || !request.message || !request.conversation_id) {
      return {
        success: false,
        error: true,
        message: 'Invalid request format.',
        response: 'VALIDATION_ERROR'
      };
    }

    // Validate images if present
    const validation = validateImages((request as any).images);
    if (!validation.ok) {
      return {
        success: false,
        error: true,
        code: validation.code,
        message: validation.message
      } as any;
    }

    try {
      const response = await axios.post(`${n8nUrl}${SADIE_WEBHOOK_PATH}`, request, {
        timeout: DEFAULT_TIMEOUT,
        headers: { 'Content-Type': 'application/json' }
      });
      return {
        success: true,
        data: response.data
      };
    } catch (error: any) {
      return mapErrorToSadieResponse(error);
    }
  });
}
