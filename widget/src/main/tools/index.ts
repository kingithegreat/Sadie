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
import { assertPermission } from '../config-manager';
import { systemToolDefs, systemToolHandlers } from './system';
import { webToolDefs, webToolHandlers } from './web';
import { voiceToolDefs, voiceToolHandlers } from './voice';
import { memoryToolDefs, memoryToolHandlers } from './memory';
import { documentToolDefs, documentToolHandlers } from './documents';
import { nbaQueryDef, nbaQueryHandler } from './nba';
import sports from './sports';

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
  
  // Check permission first
  try {
    const allowed = assertPermission(call.name);
    if (!allowed) {
      console.warn(`[SADIE Tools] Permission denied for tool: ${call.name}`);
      return { success: false, error: `Permission denied: ${call.name}` };
    }
  } catch (e) {
    // Fail closed if any error occurs while checking permission
    console.error(`[SADIE Tools] Permission check failed: ${e}`);
    return { success: false, error: 'Permission check failed' };
  }

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
 * Execute a batch of tool calls atomically: first verify permissions for all tools,
 * and if any are denied, fail the batch without executing any of them. This
 * avoids partial effects (e.g., creating a folder then failing to write a file).
 */
export async function executeToolBatch(
  calls: ToolCall[],
  context: ToolContext,
  options?: { overrideAllowed?: string[] }
): Promise<ToolResult[]> {
  try { (global as any).__SADIE_ROUTER_LOG_BUFFER = (global as any).__SADIE_ROUTER_LOG_BUFFER || []; } catch (e) {}
  console.log('[BATCH] executeToolBatch called', { toolCount: calls.length, toolNames: calls.map(c => c.name) });
  try { (global as any).__SADIE_ROUTER_LOG_BUFFER.push(`[BATCH] called tools=${calls.map(c=>c.name).join(',')}`); } catch (e) {}
  // Pre-check permissions for all unique tools
  const denied: string[] = [];
  const seen = new Set<string>();
  const overrides = new Set(options?.overrideAllowed || []);
  for (const call of calls) {
    const name = call.name;
    if (seen.has(name)) continue;
    seen.add(name);
    try {
      if (overrides.has(name)) continue;
      const allowed = assertPermission(name);
      console.log(`[SADIE Tools] Permission check for ${name}: allowed=${allowed}`);
      try { (global as any).__SADIE_ROUTER_LOG_BUFFER?.push(`[TOOLS] permission-check ${name}=${allowed}`); } catch (e) {}
      if (!allowed) denied.push(name);

      // Also check any permissions declared by the tool (e.g., write_file)
      try {
        const tool = getTool(name);
        if (tool && Array.isArray((tool.definition as any).requiredPermissions)) {
          for (const perm of (tool.definition as any).requiredPermissions as string[]) {
            if (overrides.has(perm)) continue;
            const pAllowed = assertPermission(perm);
            console.log(`[SADIE Tools] Permission check for declared permission ${perm}: allowed=${pAllowed}`);
            try { (global as any).__SADIE_ROUTER_LOG_BUFFER?.push(`[TOOLS] permission-check ${perm}=${pAllowed}`); } catch (e) {}
            if (!pAllowed) denied.push(perm);
          }
        }
      } catch (e) { /* ignore */ }
    } catch (e) {
      // Treat errors as denial
      denied.push(name);
    }
  }

  if (denied.length > 0) {
    // Return a structured result indicating permission(s) required so the
    // caller (message router) can prompt the user for confirmation and
    // optionally enable or allow once.
    console.log('[BATCH] executeToolBatch missing permissions', { denied });
    try { (global as any).__SADIE_ROUTER_LOG_BUFFER.push(`[BATCH] missing=${denied.join(',')}`); } catch (e) {}
    return [{ success: false, status: 'needs_confirmation', missingPermissions: denied, reason: `Requires permissions: ${denied.join(', ')}` } as any];
  }

  const results: ToolResult[] = [];
  for (const call of calls) {
    // Prepare execution context including any transient overrides
    const callContext = { ...(context || {} as any), overrideAllowed: Array.from(overrides) } as any;
    // If this call is explicitly overridden, call the handler directly (so tools can honor overrideAllowed)
    if (overrides.has(call.name)) {
      const tool = getTool(call.name);
      if (!tool) {
        results.push({ success: false, error: `Unknown tool: ${call.name}` });
        continue;
      }
      try {
        const r = await tool.handler(call.arguments, callContext);
        results.push(r);
      } catch (e: any) {
        results.push({ success: false, error: `Tool execution failed: ${e?.message || String(e)}` });
      }
      continue;
    }

    const result = await executeTool(call, callContext);
    results.push(result);
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
  // Register sports report tool
  registerTool(sports.definition.name, sports.definition, sports.handler);
  
  console.log(`[SADIE Tools] Initialized ${toolRegistry.size} tools`);
}

// Export types for use in message router
export type { ToolCall, ToolResult, ToolContext };
