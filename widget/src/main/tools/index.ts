/**
 * SADIE Tool Registry & Executor
 * 
 * Central registry for all tools and execution engine.
 */

import { 
  ToolDefinition, 
  ToolHandler, 
  ToolResult, 
  ToolContext, 
  RegisteredTool,
  OllamaTool,
  toOllamaTool,
  ToolCall
} from './types';
import { fileSystemTools } from './filesystem';
import { systemToolDefs, systemToolHandlers } from './system';
import { webToolDefs, webToolHandlers } from './web';
import { voiceToolDefs, voiceToolHandlers } from './voice';
import { memoryToolDefs, memoryToolHandlers } from './memory';
import { documentToolDefs, documentToolHandlers } from './documents';
import { nbaQueryDef, nbaQueryHandler } from './nba';

// Global tool registry
const toolRegistry = new Map<string, RegisteredTool>();

// Pending confirmations for tools that require user approval
const pendingConfirmations = new Map<string, {
  toolName: string;
  args: Record<string, any>;
  context: ToolContext;
  resolve: (confirmed: boolean) => void;
}>();

/**
 * Register a tool with the system
 */
export function registerTool(name: string, definition: ToolDefinition, handler: ToolHandler): void {
  toolRegistry.set(name, { definition, handler });
  console.log(`[SADIE Tools] Registered tool: ${name}`);
}

/**
 * Get all registered tool definitions
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return Array.from(toolRegistry.values()).map(t => t.definition);
}

/**
 * Get tool definitions in Ollama format
 */
export function getOllamaTools(): OllamaTool[] {
  return getAllToolDefinitions().map(toOllamaTool);
}

/**
 * Check if a tool exists
 */
export function hasTool(name: string): boolean {
  return toolRegistry.has(name);
}

/**
 * Get a specific tool
 */
export function getTool(name: string): RegisteredTool | undefined {
  return toolRegistry.get(name);
}

/**
 * Execute a tool call
 */
export async function executeTool(
  call: ToolCall,
  context: ToolContext
): Promise<ToolResult> {
  const tool = toolRegistry.get(call.name);
  
  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${call.name}`
    };
  }
  
  console.log(`[SADIE Tools] Executing: ${call.name}`, call.arguments);
  
  // Check if confirmation is required
  console.log(`[SADIE Tools] requiresConfirmation=${tool.definition.requiresConfirmation}, hasCallback=${!!context.requestConfirmation}`);
  if (tool.definition.requiresConfirmation && context.requestConfirmation) {
    const confirmMessage = formatConfirmationMessage(call.name, call.arguments);
    console.log(`[SADIE Tools] Requesting confirmation: ${confirmMessage}`);
    const confirmed = await context.requestConfirmation(confirmMessage);
    
    if (!confirmed) {
      console.log(`[SADIE Tools] User cancelled operation`);
      return {
        success: false,
        error: 'Operation cancelled by user'
      };
    }
    console.log(`[SADIE Tools] User confirmed operation`);
  }
  
  try {
    const result = await tool.handler(call.arguments, context);
    console.log(`[SADIE Tools] Result:`, result.success ? 'success' : result.error);
    return result;
  } catch (err: any) {
    console.error(`[SADIE Tools] Error executing ${call.name}:`, err);
    return {
      success: false,
      error: `Tool execution failed: ${err.message}`
    };
  }
}

/**
 * Execute multiple tool calls in sequence
 */
export async function executeToolCalls(
  calls: ToolCall[],
  context: ToolContext
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  
  for (const call of calls) {
    const result = await executeTool(call, context);
    results.push(result);
    
    // If a tool fails, continue but note it
    if (!result.success) {
      console.warn(`[SADIE Tools] Tool ${call.name} failed, continuing...`);
    }
  }
  
  return results;
}

/**
 * Format a human-readable confirmation message
 */
function formatConfirmationMessage(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case 'delete_file':
      return `Are you sure you want to delete "${args.path}"${args.recursive ? ' and all its contents' : ''}?`;
    case 'move_file':
      return `Move "${args.source}" to "${args.destination}"?`;
    case 'write_file':
      return `${args.append ? 'Append to' : 'Overwrite'} file "${args.path}"?`;
    default:
      return `Execute ${toolName} with: ${JSON.stringify(args)}?`;
  }
}

/**
 * Request confirmation for a pending operation
 */
export function createConfirmationRequest(
  toolName: string,
  args: Record<string, any>,
  context: ToolContext
): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    pendingConfirmations.set(confirmId, {
      toolName,
      args,
      context,
      resolve
    });
    
    // Auto-reject after 60 seconds
    setTimeout(() => {
      if (pendingConfirmations.has(confirmId)) {
        pendingConfirmations.delete(confirmId);
        resolve(false);
      }
    }, 60000);
  });
}

/**
 * Respond to a confirmation request
 */
export function respondToConfirmation(confirmId: string, confirmed: boolean): boolean {
  const pending = pendingConfirmations.get(confirmId);
  if (!pending) {
    return false;
  }
  
  pending.resolve(confirmed);
  pendingConfirmations.delete(confirmId);
  return true;
}

/**
 * Initialize all built-in tools
 */
export function initializeTools(): void {
  // Register file system tools
  for (const [name, tool] of Object.entries(fileSystemTools)) {
    registerTool(name, tool.definition, tool.handler);
  }
  
  // Register system tools
  for (const def of systemToolDefs) {
    const handler = systemToolHandlers[def.name];
    if (handler) {
      registerTool(def.name, def, handler);
    }
  }
  
  // Register web tools
  for (const def of webToolDefs) {
    const handler = webToolHandlers[def.name];
    if (handler) {
      registerTool(def.name, def, handler);
    }
  }
  
  // Register voice tools
  for (const def of voiceToolDefs) {
    const handler = voiceToolHandlers[def.name];
    if (handler) {
      registerTool(def.name, def, handler);
    }
  }
  
  // Register memory tools (Qdrant-backed)
  for (const def of memoryToolDefs) {
    const handler = memoryToolHandlers[def.name];
    if (handler) {
      registerTool(def.name, def, handler);
    }
  }
  
  // Register document tools (PDF, Word, text parsing)
  for (const def of documentToolDefs) {
    const handler = documentToolHandlers[def.name];
    if (handler) {
      registerTool(def.name, def, handler);
    }
  }

  // Register NBA tool (balldontlie)
  registerTool(nbaQueryDef.name, nbaQueryDef, nbaQueryHandler);
  
  console.log(`[SADIE Tools] Initialized ${toolRegistry.size} tools`);
}

// Export types for use in message router
export type { ToolCall, ToolResult, ToolContext };
