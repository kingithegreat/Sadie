export function looksLikeToolJson(content: string): boolean {
  if (!content || typeof content !== 'string') return false;
  const t = content.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  return /"parameters"|"arguments"/.test(t) && /"name"/.test(t);
}
