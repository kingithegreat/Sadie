/**
 * Tool calls that arrived as prose instead of as tool calls.
 *
 * Reported live. Asked to test its tools, HomeBot replied with:
 *
 *     <|tool_call_begin|> functions.run_terminal_command:0
 *     <|tool_call_argument_begin|> {"command": "echo ..."} <|tool_call_end|>
 *
 * and then said **Done**, having executed nothing. The next turn it produced
 * `<function_calls><invoke name="...">`, and the turn after that — answered by a
 * different, local model — produced `<functions:invoke name="get_system_info"/>`.
 *
 * Three formats, one cause. The OpenAI-compatible stream parses `delta.tool_calls`
 * correctly, so a properly-formed tool call works. But when a model emits its
 * NATIVE tool syntax into the content channel — because the provider did not
 * translate it, or the model chose text — the app renders it faithfully as an
 * answer and reports success. The user is told a job was done that was never
 * started, which is the worst failure an assistant has.
 *
 * It also spreads. Once leaked syntax is in the conversation, later models copy
 * the pattern from history, which is why a local qwen produced Anthropic-shaped
 * markup it would never invent on its own.
 *
 * ── Detection only. Never execution. ──
 *
 * This module deliberately does NOT return parsed arguments for running. Page
 * text, documents and search results all enter the context, so any of them could
 * contain `<invoke name="run_terminal_command">`. Executing tool calls recovered
 * from free text would turn every fetched web page into a command channel. The
 * job here is to notice, name what was attempted, and let the caller be honest
 * about it.
 */

export interface LeakedToolCall {
  /** The tool the model was trying to reach. */
  tool: string;
  /** Which syntax it used — useful for diagnosing which provider is leaking. */
  format: 'moonshot-tokens' | 'xml-invoke' | 'tool-call-json' | 'functions-prefix';
}

/**
 * Moonshot/Kimi native token format:
 *   <|tool_call_begin|> functions.NAME:0 <|tool_call_argument_begin|> {...}
 */
const MOONSHOT_TOKEN = /<\|tool_call_begin\|>\s*(?:functions\.)?([A-Za-z0-9_.-]+?)(?::\d+)?\s*<\|tool_call_argument_begin\|>/g;

/**
 * Anthropic-shaped XML, with or without a wrapper, self-closing or not:
 *   <invoke name="NAME">   <functions:invoke name="NAME"/>
 */
const XML_INVOKE = /<(?:functions[:.])?invoke\s+name\s*=\s*["']([^"']+)["']/g;

/**
 * Qwen / Hermes style:
 *   <tool_call>{"name": "NAME", "arguments": {...}}</tool_call>
 */
const TOOL_CALL_JSON = /<tool_call>\s*\{[^}]*?["']name["']\s*:\s*["']([^"']+)["']/g;

/**
 * A bare `functions.NAME` invocation line, which several models fall back to
 * when they have been told tools exist but given no mechanism.
 *
 * Requires the call parentheses or a following argument marker so that ordinary
 * prose mentioning `functions.foo` in a code discussion is not flagged.
 */
const FUNCTIONS_PREFIX = /(?:^|\s)functions\.([A-Za-z0-9_]+)\s*(?:\(|:\d)/g;

const PATTERNS: Array<{ re: RegExp; format: LeakedToolCall['format'] }> = [
  { re: MOONSHOT_TOKEN, format: 'moonshot-tokens' },
  { re: XML_INVOKE, format: 'xml-invoke' },
  { re: TOOL_CALL_JSON, format: 'tool-call-json' },
  { re: FUNCTIONS_PREFIX, format: 'functions-prefix' },
];

/**
 * Find tool calls that a model wrote out as text.
 *
 * Deduplicated by tool name, because a model that leaks usually leaks the same
 * call more than once and the caller wants to say "it tried to run X", not "it
 * tried to run X four times".
 */
export function detectLeakedToolCalls(text: string): LeakedToolCall[] {
  if (!text) return [];

  const found: LeakedToolCall[] = [];
  const seen = new Set<string>();

  for (const { re, format } of PATTERNS) {
    // Fresh lastIndex — these are module-level /g regexes and are reused.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const tool = m[1];
      if (!tool || seen.has(tool)) continue;
      seen.add(tool);
      found.push({ tool, format });
    }
  }

  return found;
}

/** True when a reply is describing tool calls rather than having made them. */
export function hasLeakedToolCalls(text: string): boolean {
  return detectLeakedToolCalls(text).length > 0;
}

/**
 * Remove leaked tool syntax from text meant for a person to read.
 *
 * The markup is noise to a user and, worse, it is noise that the NEXT model
 * reads back out of conversation history and imitates. Stripping it stops the
 * pattern spreading between turns.
 */
export function stripLeakedToolCalls(text: string): string {
  if (!text) return text;

  return text
    // Whole wrappers first, so their inner markup goes with them.
    .replace(/<function_calls>[\s\S]*?<\/(?:antml:)?function_calls>/g, '')
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    // Then any stragglers left unbalanced by a truncated stream.
    .replace(/<\|tool_call_[a-z_]+\|>/g, '')
    .replace(/<\/?(?:functions[:.])?invoke\b[^>]*>/g, '')
    .replace(/<\/?parameter\b[^>]*>/g, '')
    .replace(/<\/?function_calls>/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * What to tell the user when a reply claimed work it never did.
 *
 * Names the tools, because "it tried to read your files and run a command but
 * did neither" is actionable where "something went wrong" is not.
 */
export function describeLeak(calls: LeakedToolCall[]): string {
  if (calls.length === 0) return '';

  const names = calls.map(c => c.tool).join(', ');
  return (
    `The model wrote out a tool call instead of making one, so **nothing was actually run** ` +
    `(it was trying to use: ${names}). This usually means the model or provider does not ` +
    `support tool calling the way HomeBot expects. Try a different model, or ask again — ` +
    `the reply above did not do what it says it did.`
  );
}
