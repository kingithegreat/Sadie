/**
 * HomeBot Tool Registry & Executor
 * 
 * Central registry for all tools and execution engine.
 */

/** Catch handler for fire-and-forget ops — logs instead of silently swallowing */
function safeCatch(e: unknown) { console.error('[HomeBot-CATCH]', e); }

import {
  BatchCallFacts,
  BatchCallOutcome,
  BatchPreview,
  BatchSummary,
  batchSummaryLine,
  buildBatchPreview,
  buildBatchSummary,
  buildBlockedSummary,
} from '../../../../src/trust/batch';
import { 
  ToolDefinition, 
  ToolHandler, 
  ToolResult, 
  ToolContext, 
  RegisteredTool,
  OllamaTool,
  toOllamaTool,
  toCompactOllamaTool,
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
import { notificationToolDefs, notificationToolHandlers } from './notification';
import { codeRunnerToolDefs, codeRunnerToolHandlers } from './code-runner';
import { reminderToolDefs, reminderToolHandlers } from './reminder';
import { processManagerToolDefs, processManagerToolHandlers } from './process-manager';
import { contactsToolDefs, contactsToolHandlers } from './contacts';
import { calendarToolDefs, calendarToolHandlers } from './calendar';
import { clipboardToolDefs, clipboardToolHandlers } from './clipboard';
import { browserToolDefs, browserToolHandlers } from './browser';
import { emailToolDefs, emailToolHandlers } from './email';
import { newsToolDefs, newsToolHandlers } from './news';
import { gitToolDefs, gitToolHandlers } from './git';
import { diffToolDefs, diffToolHandlers } from './diff';
import { searchToolDefs, searchToolHandlers } from './search';
import { planningToolDefs, planningToolHandlers } from './planning';
import { apiToolDefs, apiToolHandlers } from './api-tool';
import { ragToolDefs, ragToolHandlers } from './rag';
import { visionToolDefs, visionToolHandlers } from './vision';
import { terminalToolDefs, terminalToolHandlers } from './terminal';
import { codebaseToolDefs, codebaseToolHandlers } from './codebase';
import { automationToolDefs, automationToolHandlers } from './automation';
import { crmToolDefs, crmToolHandlers } from './crm';
import { initializeMcpServers, seedMcpDefaults, discoverExternalMcpServers } from '../mcp-client';
import { logTelemetryEvent } from '../utils/logger';

/** Classify a tool error into a coarse category for metrics aggregation */
function classifyToolError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (msg.includes('permission') || msg.includes('denied') || msg.includes('eacces')) return 'permission';
  if (msg.includes('enoent') || msg.includes('not found')) return 'not_found';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused') || msg.includes('enotfound')) return 'network';
  if (msg.includes('parse') || msg.includes('json') || msg.includes('invalid')) return 'parse';
  if (msg.includes('cancel')) return 'cancelled';
  return 'other';
}

// Global tool registry
const toolRegistry = new Map<string, RegisteredTool>();

// Aliases for tool names coming from models that may use different names
const TOOL_ALIASES: Record<string, string> = {
  nba_scores: 'nba_query',
  terminal: 'run_terminal_command',
  shell: 'run_terminal_command',
  exec: 'run_terminal_command',
  grep: 'grep_code',
  search_code: 'grep_code',
  tree: 'project_tree',
};

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
  console.log(`[HomeBot Tools] Registered tool: ${name}`);
}

/**
 * Get all registered tool definitions
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return Array.from(toolRegistry.values()).map(t => t.definition);
}

/**
 * Document-related tool names that should only be available when documents are attached
 */
const DOCUMENT_TOOL_NAMES = ['parse_document', 'get_document_content', 'list_documents', 'search_document'];

function filterToolDefinitions(options?: { excludeDocumentTools?: boolean; categories?: string[] }): ToolDefinition[] {
  let tools = getAllToolDefinitions();

  if (options?.excludeDocumentTools) {
    tools = tools.filter(t => !DOCUMENT_TOOL_NAMES.includes(t.name));
  }

  if (options?.categories && options.categories.length > 0) {
    const cats = new Set(options.categories);
    tools = tools.filter(t => t.category && cats.has(t.category));
  }

  return tools;
}

export function getFocusedToolDefinitions(options?: { excludeDocumentTools?: boolean; categories?: string[] }): ToolDefinition[] {
  const filtered = filterToolDefinitions(options);
  if (options?.categories && options.categories.length > 0) {
    return filtered;
  }

  return filtered.filter(t => SMALL_MODEL_CORE_TOOLS.has(t.name) || t.name.startsWith('mcp_'));
}

/**
 * Get tool definitions in Ollama format
 * @param options.excludeDocumentTools - If true, excludes document parsing tools (use when no docs attached)
 * @param options.categories - If provided, only include tools in these categories (for small models)
 */
export function getOllamaTools(options?: { excludeDocumentTools?: boolean; categories?: string[] }): OllamaTool[] {
  return filterToolDefinitions(options).map(toOllamaTool);
}

export function getFocusedOllamaTools(options?: { excludeDocumentTools?: boolean; categories?: string[] }): OllamaTool[] {
  return getFocusedToolDefinitions(options).map(toOllamaTool);
}

/**
 * Core tools that small models should always have access to.
 * These cover the most common user intents while keeping the count manageable
 * for a 3B model with a 4096-token context window.
 */
const SMALL_MODEL_CORE_TOOLS = new Set([
  'web_search',
  'get_weather',
  'nba_query',
  'read_file',
  'write_file',
  'list_directory',
  'run_terminal_command',
  'grep_code',
  'show_notification',
  'get_news',
  'remember',
  'recall',
  'get_system_info',
  'list_processes',
]);

export const SMALL_MODEL_MAX_TOOLS = 12;

/**
 * Get a compact tool set for small models.
 * Starts with SMALL_MODEL_CORE_TOOLS, then adds category-specific tools
 * up to SMALL_MODEL_MAX_TOOLS.  This prevents a 3B model from drowning
 * in 80+ tool definitions that consume most of its context window.
 */
export function getSmallModelTools(options?: { excludeDocumentTools?: boolean; categories?: string[] }): OllamaTool[] {
  let allTools = getAllToolDefinitions();

  if (options?.excludeDocumentTools) {
    allTools = allTools.filter(t => !DOCUMENT_TOOL_NAMES.includes(t.name));
  }

  // Core tools first (order-preserving)
  const selected: ToolDefinition[] = [];
  const selectedNames = new Set<string>();
  for (const t of allTools) {
    if (SMALL_MODEL_CORE_TOOLS.has(t.name)) {
      selected.push(t);
      selectedNames.add(t.name);
    }
  }

  // Add category-specific tools not already in the core set
  if (options?.categories && options.categories.length > 0) {
    const cats = new Set(options.categories);
    for (const t of allTools) {
      if (selected.length >= SMALL_MODEL_MAX_TOOLS) break;
      if (!selectedNames.has(t.name) && t.category && cats.has(t.category)) {
        selected.push(t);
        selectedNames.add(t.name);
      }
    }
  }

  return selected.slice(0, SMALL_MODEL_MAX_TOOLS).map(toCompactOllamaTool);
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
  // Normalize aliases (e.g., models may emit `nba_scores` but our registered tool is `nba_query`)
  const normalized = TOOL_ALIASES[call.name] || call.name;
  call.name = normalized;
  const tool = toolRegistry.get(call.name);
  
  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${call.name}`
    };
  }
  
  console.log(`[HomeBot Tools] Executing: ${call.name}`, call.arguments);
  
  // Check permission first
  try {
    const allowed = assertPermission(call.name, !tool.definition.requiresConfirmation);
    if (!allowed) {
      console.warn(`[HomeBot Tools] Permission denied for tool: ${call.name}`);
      return { success: false, error: `Permission denied: ${call.name}` };
    }
  } catch (e) {
    // Fail closed if any error occurs while checking permission
    console.error(`[HomeBot Tools] Permission check failed: ${e}`);
    return { success: false, error: 'Permission check failed' };
  }

  // Check if confirmation is required
  console.log(`[HomeBot Tools] requiresConfirmation=${tool.definition.requiresConfirmation}, hasCallback=${!!context.requestConfirmation}`);
  if (tool.definition.requiresConfirmation && context.requestConfirmation) {
    const confirmMessage = formatConfirmationMessage(call.name, call.arguments);
    console.log(`[HomeBot Tools] Requesting confirmation: ${confirmMessage}`);
    const confirmed = await context.requestConfirmation(confirmMessage);

    if (!confirmed) {
      console.log(`[HomeBot Tools] User cancelled operation`);
      try { logTelemetryEvent('tool_call', { tool: call.name, outcome: 'cancelled', duration_ms: 0 }); } catch (_e) {}
      return {
        success: false,
        error: 'Operation cancelled by user'
      };
    }
    console.log(`[HomeBot Tools] User confirmed operation`);
  }

  const startedAt = Date.now();
  try {
    const result = await tool.handler(call.arguments, context);
    const duration_ms = Date.now() - startedAt;
    console.log(`[HomeBot Tools] Result:`, result.success ? 'success' : result.error);
    try {
      logTelemetryEvent('tool_call', {
        tool: call.name,
        outcome: result.success ? 'success' : 'handler_error',
        duration_ms,
        error_type: result.success ? undefined : classifyToolError(result.error),
      });
    } catch (_e) {}
    return result;
  } catch (err: any) {
    const duration_ms = Date.now() - startedAt;
    console.error(`[HomeBot Tools] Error executing ${call.name}:`, err);
    try {
      logTelemetryEvent('tool_call', {
        tool: call.name,
        outcome: 'threw',
        duration_ms,
        error_type: classifyToolError(err),
      });
    } catch (_e) {}
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
      console.warn(`[HomeBot Tools] Tool ${call.name} failed, continuing...`);
    }
  }
  
  return results;
}

// ── Batch transparency (Phase 2 trust layer) ────────────────────────────────
const MAX_BATCH_SUMMARIES = 20;
const recentBatchSummaries: BatchSummary[] = [];
let batchSummaryForwarder: ((summary: BatchSummary) => void) | null = null;

/** Renderer forwarder for batch summaries (set from index.ts, null to detach). */
export function setBatchSummaryForwarder(fn: ((summary: BatchSummary) => void) | null): void {
  batchSummaryForwarder = fn;
}

/** Last summaries, newest first, capped — so the Trust panel can show batches that ran while it was closed. */
export function getRecentBatchSummaries(): BatchSummary[] {
  return [...recentBatchSummaries];
}

export function clearBatchSummariesForTests(): void {
  recentBatchSummaries.length = 0;
}

function recordBatchSummary(summary: BatchSummary): void {
  recentBatchSummaries.unshift(summary);
  if (recentBatchSummaries.length > MAX_BATCH_SUMMARIES) recentBatchSummaries.length = MAX_BATCH_SUMMARIES;
  try { console.log('[BATCH] summary:', batchSummaryLine(summary)); } catch (e) { safeCatch(e); }
  try { (global as any).__HOMEBOT_ROUTER_LOG_BUFFER?.push(`[BATCH] summary ${batchSummaryLine(summary)}`); } catch (e) { safeCatch(e); }
  if (batchSummaryForwarder) {
    try { batchSummaryForwarder(summary); } catch (e) { safeCatch(e); }
  }
}

/** Mirror of executeToolBatch's permission precheck for a single call — kept adjacent so they cannot drift. */
function gatherCallFacts(call: ToolCall, overrides: Set<string>): BatchCallFacts {
  const tool = getTool(call.name);
  const requiredPermissions =
    tool && Array.isArray((tool.definition as any).requiredPermissions)
      ? ([...((tool.definition as any).requiredPermissions as string[])])
      : [];
  let permissionGranted = true;
  if (!overrides.has(call.name)) {
    try {
      permissionGranted = assertPermission(call.name, tool ? !tool.definition.requiresConfirmation : false);
      if (permissionGranted) {
        for (const perm of requiredPermissions) {
          if (overrides.has(perm)) continue;
          if (!assertPermission(perm)) { permissionGranted = false; break; }
        }
      }
    } catch {
      permissionGranted = false;
    }
  }
  return {
    name: call.name,
    args: (call.arguments ?? {}) as Record<string, unknown>,
    known: !!tool,
    requiresConfirmation: !!tool?.definition.requiresConfirmation,
    requiredPermissions,
    permissionGranted,
  };
}

/** Dry-run: what WOULD this batch do — tools, args, permission state — with zero side effects. */
export function previewBatch(calls: ToolCall[], options?: { overrideAllowed?: string[] }): BatchPreview {
  const overrides = new Set(options?.overrideAllowed || []);
  return buildBatchPreview(calls.map((c) => gatherCallFacts(c, overrides)));
}

/**
 * Execute a batch of tool calls atomically: first verify permissions for all tools,
 * and if any are denied, fail the batch without executing any of them. This
 * avoids partial effects (e.g., creating a folder then failing to write a file).
 */
export async function executeToolBatch(
  calls: ToolCall[],
  context: ToolContext,
  options?: { overrideAllowed?: string[]; dryRun?: boolean }
): Promise<ToolResult[]> {
  try { (global as any).__HOMEBOT_ROUTER_LOG_BUFFER = (global as any).__HOMEBOT_ROUTER_LOG_BUFFER || []; } catch (e) { safeCatch(e); }
  console.log('[BATCH] executeToolBatch called', { toolCount: calls.length, toolNames: calls.map(c => c.name) });
  try { (global as any).__HOMEBOT_ROUTER_LOG_BUFFER.push(`[BATCH] called tools=${calls.map(c=>c.name).join(',')}`); } catch (e) { safeCatch(e); }
  if (options?.dryRun) {
    const preview = previewBatch(calls, options);
    console.log('[BATCH] dry-run preview', { total: preview.total, wouldExecute: preview.wouldExecute });
    try { (global as any).__HOMEBOT_ROUTER_LOG_BUFFER?.push(`[BATCH] dry-run wouldExecute=${preview.wouldExecute}`); } catch (e) { safeCatch(e); }
    return [{ success: true, dryRun: true, preview } as any];
  }

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
      const precheckTool = getTool(name);
      const allowed = assertPermission(name, precheckTool ? !precheckTool.definition.requiresConfirmation : false);
      console.log(`[HomeBot Tools] Permission check for ${name}: allowed=${allowed}`);
      try { (global as any).__HOMEBOT_ROUTER_LOG_BUFFER?.push(`[TOOLS] permission-check ${name}=${allowed}`); } catch (e) { safeCatch(e); }
      if (!allowed) denied.push(name);

      // Also check any permissions declared by the tool (e.g., write_file)
      try {
        const tool = precheckTool;
        if (tool && Array.isArray((tool.definition as any).requiredPermissions)) {
          for (const perm of (tool.definition as any).requiredPermissions as string[]) {
            if (overrides.has(perm)) continue;
            const pAllowed = assertPermission(perm);
            console.log(`[HomeBot Tools] Permission check for declared permission ${perm}: allowed=${pAllowed}`);
            try { (global as any).__HOMEBOT_ROUTER_LOG_BUFFER?.push(`[TOOLS] permission-check ${perm}=${pAllowed}`); } catch (e) { safeCatch(e); }
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
    try { (global as any).__HOMEBOT_ROUTER_LOG_BUFFER.push(`[BATCH] missing=${denied.join(',')}`); } catch (e) { safeCatch(e); }
    recordBatchSummary(buildBlockedSummary(calls.map((c) => c.name), denied));
    return [{ success: false, status: 'needs_confirmation', missingPermissions: denied, reason: `Requires permissions: ${denied.join(', ')}` } as any];
  }

  const results: ToolResult[] = [];
  const outcomes: BatchCallOutcome[] = [];
  const recordOutcome = (call: ToolCall, r: ToolResult, startedAt: number) => {
    outcomes.push({
      name: call.name,
      ok: r.success === true,
      error: r.success === true ? undefined : r.error || (r as any).reason || undefined,
      durationMs: Date.now() - startedAt,
    });
  };
  for (const call of calls) {
    const callStartedAt = Date.now();
    // Prepare execution context including any transient overrides
    const callContext = { ...(context || {} as any), overrideAllowed: Array.from(overrides) } as any;
    // If this call is explicitly overridden, call the handler directly (so tools can honor overrideAllowed)
    if (overrides.has(call.name)) {
      const tool = getTool(call.name);
      if (!tool) {
        const r = { success: false, error: `Unknown tool: ${call.name}` };
        results.push(r);
        recordOutcome(call, r, callStartedAt);
        continue;
      }
      try {
        const r = await tool.handler(call.arguments, callContext);
        results.push(r);
        recordOutcome(call, r, callStartedAt);
      } catch (e: any) {
        const r = { success: false, error: `Tool execution failed: ${e?.message || String(e)}` };
        results.push(r);
        recordOutcome(call, r, callStartedAt);
      }
      continue;
    }

    const result = await executeTool(call, callContext);
    results.push(result);
    recordOutcome(call, result, callStartedAt);
  }

  if (outcomes.length > 0) {
    recordBatchSummary(buildBatchSummary(outcomes));
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
    case 'create_docx':
      return `Create Word document "${args.path}"${args.title ? ` — "${args.title}"` : ''}?`;
    case 'create_spreadsheet':
      return `Create spreadsheet "${args.path}" with ${Array.isArray(args.rows) ? args.rows.length : '?'} rows?`;
    case 'create_pdf':
      return `Create PDF "${args.path}"${args.title ? ` — "${args.title}"` : ''}?`;
    case 'edit_file':
      return `Edit file "${args.path}":\nReplace: "${String(args.old_string || '').slice(0, 100)}${String(args.old_string || '').length > 100 ? '...' : ''}"\nWith: "${String(args.new_string || '').slice(0, 100)}${String(args.new_string || '').length > 100 ? '...' : ''}"${args.replace_all ? ' (all occurrences)' : ''}`;
    case 'run_terminal_command':
      return `Run command:\n$ ${args.command}${args.cwd ? `\nDirectory: ${args.cwd}` : ''}${args.timeout && args.timeout !== 60 ? `\nTimeout: ${args.timeout}s` : ''}`;
    case 'git_commit':
      return `Git commit: "${args.message}"${args.repo_path ? `\nRepo: ${args.repo_path}` : ''}`;
    case 'kill_process':
      return `Kill process${args.name ? ` "${args.name}"` : ''}${args.pid ? ` (PID ${args.pid})` : ''}${args.force ? ' (force)' : ''}?`;
    case 'delete_automation':
      return `Permanently delete automation "${args.automation}"?`;
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

  // Register notification tools
  for (const def of notificationToolDefs) {
    const handler = notificationToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register code runner tools
  for (const def of codeRunnerToolDefs) {
    const handler = codeRunnerToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register reminder tools
  for (const def of reminderToolDefs) {
    const handler = reminderToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register process manager tools
  for (const def of processManagerToolDefs) {
    const handler = processManagerToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register contacts tools
  for (const def of contactsToolDefs) {
    const handler = contactsToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register news tools
  for (const def of newsToolDefs) {
    const handler = newsToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register git tools
  for (const def of gitToolDefs) {
    const handler = gitToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register diff tools
  for (const def of diffToolDefs) {
    const handler = diffToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register calendar tools
  for (const def of calendarToolDefs) {
    const handler = calendarToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register clipboard tools
  for (const def of clipboardToolDefs) {
    const handler = clipboardToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register browser tools
  for (const def of browserToolDefs) {
    const handler = browserToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register email tools
  for (const def of emailToolDefs) {
    const handler = emailToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register search tool (local file search)
  for (const def of searchToolDefs) {
    const handler = searchToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register planning agent tools
  for (const def of planningToolDefs) {
    const handler = planningToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register API tool
  for (const def of apiToolDefs) {
    const handler = apiToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register RAG tools (local document semantic search)
  for (const def of ragToolDefs) {
    const handler = ragToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register vision tools (image analysis via Ollama multimodal)
  for (const def of visionToolDefs) {
    const handler = visionToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register terminal tools (shell command execution)
  for (const def of terminalToolDefs) {
    const handler = terminalToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register codebase tools (grep, tree, analyze)
  for (const def of codebaseToolDefs) {
    const handler = codebaseToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register automation tools (Automation Center CRUD + fire from chat)
  for (const def of automationToolDefs) {
    const handler = automationToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  // Register CRM tools (companies, contacts, deals, activities, tasks, brief)
  for (const def of crmToolDefs) {
    const handler = crmToolHandlers[def.name];
    if (handler) registerTool(def.name, def, handler);
  }

  console.log(`[HomeBot Tools] Initialized ${toolRegistry.size} tools`);

  // Auto-discover servers from Cursor / Claude Desktop / VS Code, then seed defaults
  discoverExternalMcpServers();
  seedMcpDefaults();
  initializeMcpServers(registerTool).catch(e =>
    console.warn('[MCP] Server initialization failed:', e)
  );
}

// Export types for use in message router
export type { ToolCall, ToolResult, ToolContext };
