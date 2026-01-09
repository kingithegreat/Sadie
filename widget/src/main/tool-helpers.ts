export function looksLikeToolJson(content: string): boolean {
  if (!content || typeof content !== 'string') return false;
  const t = content.trim();
  // Check if content starts with JSON
  if (t.startsWith('{') || t.startsWith('[')) {
    return /"parameters"|"arguments"/.test(t) && /"name"/.test(t);
  }
  // Also check if there's embedded JSON in prose
  const extracted = extractToolJson(content);
  return extracted !== null;
}

/**
 * Extract tool JSON from mixed prose content.
 * LLMs often output explanatory text before/after the JSON.
 */
export function extractToolJson(content: string): any | null {
  if (!content || typeof content !== 'string') return null;
  
  // Try to find JSON object in the content
  const jsonMatch = content.match(/\{[\s\S]*?"name"[\s\S]*?"parameters"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && parsed.name) {
        return parsed;
      }
    } catch (e) {}
  }
  
  // Also try to match { "name": "...", "parameters": {...} } pattern
  const altMatch = content.match(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"parameters"\s*:\s*\{[^}]*\}\s*\}/);
  if (altMatch) {
    try {
      const parsed = JSON.parse(altMatch[0]);
      if (parsed && parsed.name) {
        return parsed;
      }
    } catch (e) {}
  }
  
  return null;
}
