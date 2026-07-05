/**
 * Reflection Validator
 * ---------------------
 * A model-first validation layer for tool-call output. After a batch of tools
 * has executed, this asks the LLM to render a verdict on whether the results
 * actually answer the user's request, using a strict single-JSON-object
 * response shape. This lets HomeBot catch cases where a tool technically
 * "succeeded" but the result doesn't actually satisfy what was asked (wrong
 * location matched, stale data, partial result, etc.) before handing the
 * answer to the user.
 *
 * Design goals:
 * - Fully additive: disabled by default (Settings.reflectionValidationEnabled).
 * - Fail-safe: any parsing/network error falls back to "accept" so a bug in
 *   this module can never block or corrupt the existing conversation flow.
 * - Depth-limited: independent of MAX_TOOL_ROUNDS, reflection itself can only
 *   escalate a bounded number of times before it force-accepts.
 */

import axios from 'axios';

export const REFLECTION_CONFIDENCE_THRESHOLD = 0.7;
export const MAX_REFLECTION_DEPTH = 2;

export type ReflectionOutcome = 'accept' | 'request_tool' | 'explain';

export interface ReflectionVerdict {
  outcome: ReflectionOutcome;
  confidence: number | null;
  final_message?: string;
  tool_request?: { name: string; arguments?: Record<string, unknown> };
  explanation?: string;
}

export interface ReflectionResult {
  /** Whether the verdict should be treated as accepted (surfaced to the user as-is). */
  accepted: boolean;
  confidence: number | null;
  /** Message to show the user, whichever path was taken. */
  message: string;
  /** Present only when outcome === 'request_tool' and depth budget remains. */
  toolRequest?: { name: string; arguments?: Record<string, unknown> };
  /** True when reflection itself failed (bad JSON, network error, etc.) — caller should treat as accept and move on unchanged. */
  fallback: boolean;
}

interface EvaluateArgs {
  ollamaBaseUrl: string;
  model: string;
  userMessage: string;
  toolSummary: string;
  depth: number;
  /** Injection point for tests to control the exact response without mocking axios internals. */
  __testOverride?: ReflectionVerdict;
}

function buildReflectionPrompt(userMessage: string, toolSummary: string): string {
  return [
    'You are validating whether tool output actually answers a user request.',
    'Respond with EXACTLY ONE JSON object and nothing else — no prose, no markdown fences.',
    'Shape: {"outcome":"accept"|"request_tool"|"explain","confidence":0-1 or null,',
    '"final_message"?:string, "tool_request"?:{"name":string,"arguments"?:object}, "explanation"?:string}',
    '- "accept": the tool output answers the request. Include final_message (what to tell the user) and confidence.',
    '- "request_tool": the output is insufficient and another tool call would help. Include tool_request.',
    '- "explain": the output cannot be validated or is wrong. Include explanation (plain language, no confidence needed).',
    '',
    `User request: ${userMessage}`,
    '',
    `Tool output: ${toolSummary}`
  ].join('\n');
}

/** Strictly parses a model response as a single ReflectionVerdict JSON object. Returns null on any deviation. */
export function parseReflectionVerdict(raw: string): ReflectionVerdict | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const outcome = parsed.outcome;
  if (outcome !== 'accept' && outcome !== 'request_tool' && outcome !== 'explain') return null;

  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : null;

  if (outcome === 'request_tool') {
    const tr = parsed.tool_request;
    if (!tr || typeof tr !== 'object' || typeof tr.name !== 'string' || !tr.name) return null;
    return { outcome, confidence, tool_request: { name: tr.name, arguments: tr.arguments } };
  }
  if (outcome === 'explain') {
    if (typeof parsed.explanation !== 'string' || !parsed.explanation.trim()) return null;
    return { outcome, confidence, explanation: parsed.explanation };
  }
  // accept
  if (typeof parsed.final_message !== 'string' || !parsed.final_message.trim()) return null;
  return { outcome, confidence, final_message: parsed.final_message };
}

/**
 * Ask the model to validate tool output and return a normalized result the
 * caller can act on. Never throws — any failure degrades to an accepted
 * fallback so the existing conversation flow is never blocked by this layer.
 */
export async function evaluateToolResults(args: EvaluateArgs): Promise<ReflectionResult> {
  const { ollamaBaseUrl, model, userMessage, toolSummary, depth } = args;

  if (depth >= MAX_REFLECTION_DEPTH) {
    return {
      accepted: true,
      confidence: null,
      message: 'Reached the reflection depth limit — showing the best available result.',
      fallback: true
    };
  }

  let verdict: ReflectionVerdict | null;

  if (args.__testOverride) {
    verdict = args.__testOverride;
  } else {
    try {
      const prompt = buildReflectionPrompt(userMessage, toolSummary);
      const response = await axios.post(`${ollamaBaseUrl}/api/generate`, {
        model,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0, num_predict: 512 }
      });
      const raw = response?.data?.response ?? '';
      verdict = parseReflectionVerdict(raw);
    } catch {
      verdict = null;
    }
  }

  if (!verdict) {
    return {
      accepted: true,
      confidence: null,
      message: 'Reflection could not validate the tool output — showing it as-is.',
      fallback: true
    };
  }

  if (verdict.outcome === 'accept') {
    const confidence = verdict.confidence ?? 0;
    const accepted = confidence >= REFLECTION_CONFIDENCE_THRESHOLD;
    return {
      accepted,
      confidence: verdict.confidence,
      message: accepted
        ? (verdict.final_message as string)
        : `${verdict.final_message} (low confidence — treat with caution)`,
      fallback: false
    };
  }

  if (verdict.outcome === 'request_tool') {
    return {
      accepted: false,
      confidence: verdict.confidence,
      message: '',
      toolRequest: verdict.tool_request,
      fallback: false
    };
  }

  // explain
  return {
    accepted: false,
    confidence: verdict.confidence,
    message: verdict.explanation as string,
    fallback: false
  };
}
