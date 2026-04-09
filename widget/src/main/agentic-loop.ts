/**
 * SADIE Agentic Loop Engine
 *
 * Detects multi-step user requests and enables the LLM to autonomously
 * chain tool calls.  Instead of the deterministic regex router picking a
 * single tool, the LLM plans a sequence, executes each step, observes
 * results, and decides the next action — up to MAX_AGENTIC_ROUNDS.
 *
 * Design:
 *   • Lightweight detection heuristic — no extra LLM call for classification
 *   • Streams intermediate progress ("Step 1/3: Searching…") to the UI
 *   • Falls back gracefully: if the LLM doesn't emit tool_calls the
 *     response is rendered as normal chat text
 *   • Reuses executeToolBatch for permission checks and confirmation flow
 */

import { executeToolBatch, getAllToolDefinitions } from './tools';
import { ToolCall, ToolContext, ToolResult } from './tools/types';

// ── Constants ─────────────────────────────────────────────────────────────

/** Max tool-call rounds in agentic mode (safety cap). */
export const MAX_AGENTIC_ROUNDS = 6;

/** Min message length to even consider agentic routing. */
const MIN_AGENTIC_LENGTH = 30;

// ── Multi-step detection ──────────────────────────────────────────────────

/**
 * Heuristic: does this message look like it needs multiple tools?
 *
 * Triggers on:
 *   • Explicit sequencing words ("then", "after that", "and also", "next")
 *   • Comma-separated action lists ("search X, save it, and email me")
 *   • Step-style phrasing ("first … then …")
 *   • 2+ distinct tool-like verbs in the same message
 *
 * Does NOT trigger on simple single-action requests.
 */
export function looksMultiStep(message: string): boolean {
  const m = message.toLowerCase().trim();
  if (m.length < MIN_AGENTIC_LENGTH) return false;

  // Explicit sequence connectors
  const hasSequenceWords = /\b(then|after that|afterwards|and then|next|finally|once you|once that|when done|and also|also|as well)\b/i.test(m);

  // "First … then …" pattern
  const hasFirstThen = /\bfirst\b.{5,}\bthen\b/i.test(m);

  // Multiple action verbs (at least 2 from different tool domains)
  const actionVerbs = [
    /\b(search|look up|find|google)\b/i,
    /\b(save|write|create|make)\s+(a |the |it |that |this )?(file|document|note|summary|report|to )/i,
    /\b(email|send|mail|message)\b/i,
    /\b(remind|reminder|alert)\b/i,
    /\b(read|open|parse|summarize|summarise)\s+(the |a |my )?(file|document|pdf|report)/i,
    /\b(calculate|compute|run|execute)\b/i,
    /\b(list|show)\s+(my )?(files|directory|folder|calendar|events|reminders)/i,
    /\b(add|schedule|set)\s+(a |an )?(event|meeting|appointment|reminder)/i,
    /\b(weather|forecast)\b/i,
    /\b(copy|clipboard)\b/i,
  ];
  const matchedDomains = actionVerbs.filter(re => re.test(m)).length;
  const hasMultipleActions = matchedDomains >= 2;

  // Numbered steps: "1. do X  2. do Y" or "step 1 … step 2"
  const hasNumberedSteps = /\b[1-3][.)]\s+\w/i.test(m) || /\bstep\s+[1-3]\b/i.test(m);

  return hasSequenceWords || hasFirstThen || hasMultipleActions || hasNumberedSteps;
}

// ── Agentic system prompt injection ───────────────────────────────────────

/**
 * Build an agentic system prompt that instructs the model to plan and
 * execute multi-step tool chains.  Injected as an additional system
 * message when agentic mode is active.
 */
export function buildAgenticSystemPrompt(): string {
  return [
    'You are in AGENTIC MODE. The user\'s request requires multiple steps.',
    '',
    'RULES:',
    '1. Break the task into steps and execute them one at a time using tool calls.',
    '2. After each tool result, decide what to do next — call another tool or give the final answer.',
    '3. Stream brief progress updates between steps (e.g., "Found the file. Now reading it...").',
    '4. When ALL steps are complete, give a clear final summary to the user.',
    '5. If a step fails, explain what went wrong and try an alternative approach.',
    '6. Do NOT describe what tools you would call — actually CALL them.',
    '7. Maximum ' + MAX_AGENTIC_ROUNDS + ' tool rounds. Be efficient.',
  ].join('\n');
}

// ── Tool summary for agentic context ──────────────────────────────────────

/**
 * Build a concise tool catalog string so the LLM knows what's available.
 * Compact format: "tool_name — description" one per line.
 */
export function getToolCatalogSummary(): string {
  const defs = getAllToolDefinitions();
  return defs
    .map(d => `• ${d.name} — ${d.description}`)
    .join('\n');
}

// ── Step progress formatting ──────────────────────────────────────────────

/**
 * Format a progress message for the UI during agentic execution.
 */
export function formatStepProgress(round: number, toolName: string, _args: Record<string, any>): string {
  const verbs: Record<string, string> = {
    web_search: 'Searching the web',
    get_weather: 'Checking weather',
    read_file: 'Reading file',
    write_file: 'Writing file',
    list_directory: 'Listing directory',
    nba_query: 'Fetching NBA data',
    run_code: 'Running code',
    remember: 'Saving to memory',
    recall: 'Searching memory',
    list_calendar_events: 'Checking calendar',
    add_calendar_event: 'Adding calendar event',
    set_reminder: 'Setting reminder',
    send_email: 'Sending email',
    get_news: 'Fetching news',
    parse_document_from_path: 'Parsing document',
    search_files: 'Searching files',
    vision_describe: 'Analyzing image',
  };
  const verb = verbs[toolName] || `Running ${toolName}`;
  return `\n🔄 **Step ${round + 1}:** ${verb}…\n`;
}

// ── Agentic execution orchestrator ────────────────────────────────────────

export interface AgenticCallbacks {
  onChunk: (text: string) => void;
  onEnd: () => void;
  onError: (err: any) => void;
  requestConfirmation?: (msg: string) => Promise<boolean>;
  requestPermission?: (perms: string[], reason: string) => Promise<{
    decision: 'allow_once' | 'always_allow' | 'cancel';
    missingPermissions?: string[];
  }>;
}

/**
 * Execute tool calls from agentic LLM responses.
 *
 * This is called by the existing processResponse() loop in
 * streamFromOllamaWithTools when agentic mode is active.
 * It adds step-progress streaming and structured result formatting.
 */
export async function executeAgenticStep(
  round: number,
  toolCalls: any[],
  callbacks: AgenticCallbacks,
  context: ToolContext
): Promise<{ results: ToolResult[]; summary: string }> {
  const results: ToolResult[] = [];
  const summaryParts: string[] = [];

  for (const tc of toolCalls) {
    const toolName = tc.function?.name || tc.name;
    const toolArgs = typeof (tc.function?.arguments || tc.arguments) === 'string'
      ? JSON.parse(tc.function?.arguments || tc.arguments)
      : (tc.function?.arguments || tc.arguments || {});

    // Stream progress indicator
    callbacks.onChunk(formatStepProgress(round, toolName, toolArgs));

    // Execute
    const batchResults = await executeToolBatch(
      [{ name: toolName, arguments: toolArgs } as ToolCall],
      context
    );

    // Handle permission denial
    if (batchResults.length === 1 && batchResults[0].success === false && (batchResults[0] as any).status === 'needs_confirmation') {
      const missing = (batchResults[0] as any).missingPermissions || [];
      const reason = (batchResults[0] as any).reason || `Requires: ${missing.join(', ')}`;

      if (typeof callbacks.requestPermission === 'function') {
        const resp = await callbacks.requestPermission(missing, reason);
        if (resp.decision === 'cancel') {
          callbacks.onChunk(`\n⚠️ Permission denied for ${toolName}. Skipping this step.\n`);
          results.push({ success: false, error: `Permission denied: ${missing.join(', ')}` });
          summaryParts.push(`${toolName}: permission denied`);
          continue;
        }
        // Re-execute with override
        const rerun = await executeToolBatch(
          [{ name: toolName, arguments: toolArgs } as ToolCall],
          context,
          { overrideAllowed: missing }
        );
        results.push(...rerun);
        summaryParts.push(`${toolName}: ${rerun[0]?.success ? 'success' : 'failed'}`);
      } else {
        results.push(batchResults[0]);
        summaryParts.push(`${toolName}: permission denied`);
      }
      continue;
    }

    results.push(...batchResults);
    for (const r of batchResults) {
      if (r.success === false) {
        summaryParts.push(`${toolName}: failed — ${r.error || 'unknown error'}`);
        callbacks.onChunk(`\n⚠️ ${toolName} failed: ${r.error || 'unknown error'}\n`);
      } else {
        summaryParts.push(`${toolName}: done`);
        callbacks.onChunk(`\n✅ ${toolName} completed.\n`);
      }
    }
  }

  return {
    results,
    summary: summaryParts.join('\n'),
  };
}
