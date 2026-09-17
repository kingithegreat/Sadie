/**
 * WorkspaceAssistantPanel — ask the assistant about your code without leaving
 * the Workspace, with files attached as context (Cursor's @-mentions).
 *
 * Uses the same streaming chat path as the main window (sendStreamMessage ->
 * homebot:stream-message), so it has the same models, tools and permission
 * prompts. Each Workspace folder keeps its own conversation. Attached files
 * are read from the editor, so unsaved edits are what the assistant sees.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export interface WorkspaceOpenFile { path: string; name: string; content: string; language: string }

export type ContextItem =
  | { kind: 'file'; path: string; name: string; content: string; language: string }
  | { kind: 'folder'; path: string; entries: string[] };

/** Per-file and total caps so one large file cannot crowd out the question. */
export const MAX_FILE_CHARS = 60_000;
export const MAX_CONTEXT_CHARS = 150_000;

/** The message sent to the assistant: attached context first, then the question. */
export function buildWorkspacePrompt(question: string, context: ContextItem[]): string {
  const parts: string[] = [];
  let used = 0;
  for (const item of context) {
    if (item.kind === 'file') {
      const remaining = Math.max(0, MAX_CONTEXT_CHARS - used);
      const limit = Math.min(MAX_FILE_CHARS, remaining);
      const body = item.content.length > limit ? `${item.content.slice(0, limit)}\n… (truncated: ${item.content.length - limit} more characters)` : item.content;
      used += Math.min(item.content.length, limit);
      parts.push(`File: ${item.path}\n\`\`\`${item.language === 'plaintext' ? '' : item.language}\n${body}\n\`\`\``);
    } else {
      parts.push(`Folder: ${item.path}\nContains:\n${item.entries.slice(0, 300).map(e => `- ${e}`).join('\n')}`);
    }
  }
  const header = parts.length ? `I'm working in HomeBot's code Workspace. Context I attached:\n\n${parts.join('\n\n')}\n\n---\n\n` : '';
  return `${header}${question.trim()}`;
}

interface ChatTurn { id: string; role: 'user' | 'assistant'; text: string; context?: string[]; error?: boolean }

interface Props {
  root: string;
  files: WorkspaceOpenFile[];
  activePath: string | null;
  onClose: () => void;
}

export default function WorkspaceAssistantPanel({ root, files, activePath, onClose }: Props) {
  const api = (window as any).electron;
  const [question, setQuestion] = useState('');
  const [attached, setAttached] = useState<Array<{ kind: 'file' | 'folder'; path: string }>>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const conversationId = useMemo(() => `workspace:${root}`, [root]);

  useEffect(() => () => { unsubscribe.current?.(); }, []);

  const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
  const attach = (value: string) => {
    if (!value) return;
    const [kind, ...rest] = value.split(':');
    const path = rest.join(':');
    setAttached(prev => prev.some(a => a.kind === kind && a.path === path) ? prev : [...prev, { kind: kind as 'file' | 'folder', path }]);
  };

  const send = async () => {
    const text = question.trim();
    if (!text || streamingId) return;
    const context: ContextItem[] = [];
    for (const item of attached) {
      if (item.kind === 'file') {
        const file = files.find(f => f.path === item.path);
        if (file) context.push({ kind: 'file', path: file.path, name: file.name, content: file.content, language: file.language });
      } else {
        const res = await api?.workspaceList?.(item.path);
        const entries = (res?.entries || []).map((e: { name: string; isDirectory: boolean }) => `${e.name}${e.isDirectory ? '/' : ''}`);
        context.push({ kind: 'folder', path: item.path, entries });
      }
    }
    const streamId = `ws-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTurns(prev => [...prev,
      { id: `${streamId}-q`, role: 'user', text, context: attached.map(a => baseName(a.path)) },
      { id: streamId, role: 'assistant', text: '' }]);
    setQuestion('');
    setStreamingId(streamId);
    const finish = () => { unsubscribe.current?.(); unsubscribe.current = null; setStreamingId(null); };
    unsubscribe.current = api?.subscribeToStream?.(streamId, {
      onStreamChunk: (data: { chunk: string }) => setTurns(prev => prev.map(t => t.id === streamId ? { ...t, text: t.text + data.chunk } : t)),
      onStreamEnd: () => finish(),
      onStreamError: (err: { error?: string; message?: string }) => {
        setTurns(prev => prev.map(t => t.id === streamId ? { ...t, text: t.text || err?.message || err?.error || 'The assistant could not answer.', error: true } : t));
        finish();
      },
    }) ?? null;
    await api?.sendStreamMessage?.({
      streamId, user_id: 'desktop_user', conversation_id: conversationId,
      message: buildWorkspacePrompt(text, context), timestamp: new Date().toISOString(),
    });
  };

  const active = files.find(f => f.path === activePath);

  return (
    <section className="ws-assistant" aria-label="Assistant">
      <header className="ws-assistant-header">
        <span>Assistant</span>
        <button type="button" className="ws-tab-close" aria-label="Close assistant" onClick={onClose}>✕</button>
      </header>

      <div className="ws-assistant-turns" role="log" aria-label="Assistant conversation">
        {turns.length === 0 && (
          <p className="tree-hint">Ask about your code. Attach files with “Add context” so the assistant can read them — unsaved edits included.</p>
        )}
        {turns.map(turn => (
          <div key={turn.id} className={`ws-assistant-turn ${turn.role}${turn.error ? ' error' : ''}`}>
            {turn.context && turn.context.length > 0 && <div className="ws-assistant-turn-context">📎 {turn.context.join(', ')}</div>}
            <div className="ws-assistant-text">{turn.text || (turn.role === 'assistant' && streamingId === turn.id ? '…' : '')}</div>
          </div>
        ))}
      </div>

      <div className="ws-assistant-composer">
        {attached.length > 0 && (
          <ul className="ws-assistant-chips" aria-label="Attached context">
            {attached.map(a => (
              <li key={`${a.kind}:${a.path}`} className="ws-assistant-chip">
                {a.kind === 'folder' ? '📁' : '📄'} {baseName(a.path)}
                <button type="button" aria-label={`Remove ${baseName(a.path)}`} onClick={() => setAttached(prev => prev.filter(x => !(x.kind === a.kind && x.path === a.path)))}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <select className="ms-select" aria-label="Add context" value="" onChange={e => attach(e.target.value)}>
          <option value="">Add context…</option>
          {active && <option value={`file:${active.path}`}>@ Current file ({active.name})</option>}
          {files.filter(f => f.path !== activePath).map(f => <option key={f.path} value={`file:${f.path}`}>@ {f.name}</option>)}
          {root && <option value={`folder:${root}`}>@ This folder ({baseName(root)})</option>}
        </select>
        <textarea aria-label="Ask the assistant" rows={3} value={question} placeholder="Ask about your code… (Ctrl+Enter to send)"
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
        <div className="ws-assistant-actions">
          {streamingId
            ? <button type="button" className="sp-btn" onClick={() => api?.cancelStream?.(streamingId)}>Stop</button>
            : <button type="button" className="sp-btn" onClick={() => void send()} disabled={!question.trim()}>Send</button>}
        </div>
      </div>
    </section>
  );
}
