/** Validate every refactor target before changing any unsaved buffer. */
export function stageWorkspaceDraftEdits<T extends { path: string; content: string }>(files: T[], edits: Array<{
  path: string; expectedContent: string; changes: Array<{ start: number; length: number; text: string }>;
}>): T[] {
  const key = (value: string) => /^[a-z]:/i.test(value) ? value.replace(/\\/g, '/').toLowerCase() : value;
  const grouped = new Map<string, { expected: string; changes: Array<{ start: number; length: number; text: string }> }>();
  for (const edit of edits) {
    const existing = grouped.get(key(edit.path));
    if (existing && existing.expected !== edit.expectedContent) throw new Error('Conflicting refactor snapshots. Refresh and retry.');
    grouped.set(key(edit.path), { expected: edit.expectedContent, changes: [...(existing?.changes || []), ...edit.changes] });
  }
  for (const [target, edit] of grouped) {
    const file = files.find(f => key(f.path) === target);
    if (!file || file.content !== edit.expected) throw new Error('A refactor target changed. No drafts were modified.');
    let boundary = file.content.length;
    for (const change of [...edit.changes].sort((a, b) => b.start - a.start)) {
      if (!Number.isInteger(change.start) || !Number.isInteger(change.length) || change.start < 0 || change.length < 0 || change.start + change.length > boundary || typeof change.text !== 'string') throw new Error('Invalid or overlapping refactor edits. No drafts were modified.');
      boundary = change.start;
    }
  }
  return files.map(file => {
    const edit = grouped.get(key(file.path));
    if (!edit) return file;
    let content = file.content;
    for (const change of [...edit.changes].sort((a, b) => b.start - a.start)) content = content.slice(0, change.start) + change.text + content.slice(change.start + change.length);
    return { ...file, content };
  });
}
