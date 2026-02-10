export function looksLikeToolJson(content: string): boolean {
  if (!content || typeof content !== 'string') return false;
  const t = content.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) {
    // Also check if there's embedded tool JSON inside prose text
    // Models like mistral often wrap JSON in descriptive text
    return /"name"\s*:\s*"[a-z_]+"/.test(t) && (/"arguments"\s*:/.test(t) || /"parameters"\s*:/.test(t));
  }
  return /"parameters"|"arguments"/.test(t) && /"name"/.test(t);
}

/**
 * Extract balanced-brace JSON objects from text.
 * Handles nested braces that simple regex cannot.
 */
export function extractBalancedBraceObjects(text: string): any[] {
  const results: any[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{' || text[i] === '[') {
      const opener = text[i];
      const closer = opener === '{' ? '}' : ']';
      let depth = 1;
      let j = i + 1;
      let inString = false;
      let escape = false;
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (escape) { escape = false; j++; continue; }
        if (ch === '\\') { escape = true; j++; continue; }
        if (ch === '"') { inString = !inString; j++; continue; }
        if (!inString) {
          if (ch === '{' || ch === '[') depth++;
          else if (ch === '}' || ch === ']') depth--;
        }
        j++;
      }
      if (depth === 0) {
        const candidate = text.slice(i, j);
        try {
          const parsed = JSON.parse(candidate);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          if (items.some((it: any) => it.name && (it.arguments || it.parameters))) {
            results.push(...items);
          }
        } catch { /* not valid JSON, skip */ }
      }
    }
    i++;
  }
  return results;
}

/**
 * Extract tool call JSON from mixed prose + JSON content.
 * Returns the parsed tool call object(s) or null if not found.
 */
export function extractToolCallsFromText(content: string): any[] | null {
  if (!content || typeof content !== 'string') return null;
  
  // Try balanced-brace extraction first (handles nested arguments)
  const braceResults = extractBalancedBraceObjects(content);
  if (braceResults.length > 0) {
    const toolCalls = braceResults.filter(
      (item: any) => item.name && typeof item.name === 'string'
    );
    if (toolCalls.length > 0) return toolCalls;
  }

  // Fallback: regex patterns for simpler structures
  const patterns = [
    // Match JSON array: [{"name": "...", "arguments": {...}}]
    /\[[\s\n]*\{[\s\S]*?"name"\s*:\s*"([a-z_]+)"[\s\S]*?"arguments"\s*:[\s\S]*?\}[\s\n]*\]/g,
    // Match single JSON object: {"name": "...", "arguments": {...}}
    /\{[\s\S]*?"name"\s*:\s*"([a-z_]+)"[\s\S]*?"arguments"\s*:[\s\S]*?\}/g,
  ];
  
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) {
      for (const match of matches) {
        try {
          const parsed = JSON.parse(match);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          // Validate structure
          if (items.every((item: any) => item.name && typeof item.name === 'string')) {
            return items;
          }
        } catch {
          // Invalid JSON, try next match
        }
      }
    }
  }
  
  return null;
}

/**
 * Detect when the model describes tool calls as prose text
 * e.g. "write_file path=\"C:\\Desktop\\file.txt\" content=\"hello\""
 * or code-block style: ```\nwrite_file path="..." content="..."\n```
 * Returns parsed tool call objects or null.
 */
const KNOWN_TOOLS = new Set([
  'list_directory', 'read_file', 'create_directory', 'move_file',
  'copy_file', 'delete_file', 'write_file', 'get_file_info',
  'get_system_info', 'get_clipboard', 'set_clipboard', 'open_url',
  'launch_app', 'calculate', 'get_current_time', 'screenshot',
  'web_search', 'fetch_url', 'get_weather', 'speak', 'stop_speaking',
  'get_voices', 'remember', 'recall', 'forget', 'list_memories',
  'parse_document', 'parse_document_from_path', 'get_document_content',
  'list_documents', 'search_document', 'nba_query', 'generate_sports_report',
]);

export function extractProseToolCalls(content: string): any[] | null {
  if (!content || typeof content !== 'string') return null;

  // Strip markdown code fences so ```` ```\ncreate_directory path="..."\n``` ````
  // gets processed the same as bare prose.
  const stripped = content.replace(/```[\s\S]*?```/g, (block) =>
    block.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
  );

  // Pattern: tool_name key="value" key="value" ...
  // or tool_name key=value key=value ...
  const prosePattern = new RegExp(
    `\\b(${[...KNOWN_TOOLS].join('|')})\\s+((?:[a-zA-Z_]+\\s*=\\s*(?:"[^"]*"|'[^']*'|\\S+)\\s*)+)`,
    'g'
  );

  const results: any[] = [];
  let match: RegExpExecArray | null;

  while ((match = prosePattern.exec(stripped)) !== null) {
    const toolName = match[1];
    const argsStr = match[2].trim();
    const args: Record<string, string> = {};

    // Parse key="value" or key=value pairs
    const argPattern = /([a-zA-Z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
    let argMatch: RegExpExecArray | null;
    while ((argMatch = argPattern.exec(argsStr)) !== null) {
      args[argMatch[1]] = argMatch[2] ?? argMatch[3] ?? argMatch[4] ?? '';
    }

    if (Object.keys(args).length > 0) {
      results.push({ name: toolName, arguments: args });
    }
  }

  return results.length > 0 ? results : null;
}
