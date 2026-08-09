import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalOutputChunk, TerminalExitEvent } from '../../shared/types';
import { parseAnsiChunk, applyCarriageReturns, excerptForModel, type AnsiSegment, type AnsiStyle } from '../../shared/ansi';

/**
 * Interactive terminal for the user — distinct from the LLM's terminal tool.
 *
 * Renders streamed stdout/stderr with ANSI colour, keeps a command history,
 * and can hand a bounded excerpt of output to chat. That excerpt is capped
 * deliberately: HomeBot's default runtime is a small local model, and pasting
 * a full build log would swamp its context.
 */

/** Cap retained output so a chatty build cannot grow the DOM without bound. */
const MAX_LINES = 5000;

interface Line {
  id: number;
  segments: AnsiSegment[];
  kind: 'out' | 'err' | 'system' | 'prompt';
}

function styleOf(seg: AnsiSegment): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (seg.fg) s.color = seg.fg;
  if (seg.bg) s.backgroundColor = seg.bg;
  if (seg.bold) s.fontWeight = 600;
  if (seg.dim) s.opacity = 0.65;
  if (seg.italic) s.fontStyle = 'italic';
  if (seg.underline) s.textDecoration = 'underline';
  if (seg.inverse) { const fg = s.color; s.color = s.backgroundColor || 'var(--terminal-bg, #1e222a)'; s.backgroundColor = fg || 'var(--terminal-fg, #abb2bf)'; }
  return s;
}

export default function TerminalPanel({ open, onClose, projectPath, onSendToChat }: {
  open: boolean;
  onClose: () => void;
  projectPath?: string;
  onSendToChat?: (text: string) => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string>('');
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  const lineId = useRef(0);
  const ansiState = useRef<AnsiStyle>({});
  const pendingLine = useRef<{ text: string; kind: Line['kind'] } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const api = (window as any).electron;

  const pushLines = useCallback((text: string, kind: Line['kind']) => {
    // Terminals are line-oriented; buffer a trailing partial line until its
    // newline arrives so a chunk split mid-line doesn't render as two rows.
    const carry = pendingLine.current && pendingLine.current.kind === kind ? pendingLine.current.text : '';
    const combined = carry + text;
    const parts = combined.split('\n');
    const last = parts.pop() ?? '';
    pendingLine.current = last ? { text: last, kind } : null;

    const complete = carry && parts.length === 0 ? [] : parts;
    if (complete.length === 0 && !last) return;

    setLines(prev => {
      const next = [...prev];
      for (const raw of complete) {
        const { segments, state } = parseAnsiChunk(applyCarriageReturns(raw), ansiState.current);
        ansiState.current = state;
        next.push({ id: lineId.current++, segments, kind });
      }
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const flushPending = useCallback(() => {
    const p = pendingLine.current;
    if (!p || !p.text) { pendingLine.current = null; return; }
    pendingLine.current = null;
    setLines(prev => {
      const { segments, state } = parseAnsiChunk(applyCarriageReturns(p.text), ansiState.current);
      ansiState.current = state;
      const next = [...prev, { id: lineId.current++, segments, kind: p.kind }];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  // Create a session when the panel first opens.
  useEffect(() => {
    if (!open || sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api?.terminalCreate?.(projectPath);
        if (cancelled) return;
        if (res?.success && res.id) {
          setSessionId(res.id);
          setCwd(res.cwd || '');
          setError(null);
        } else {
          setError(res?.error || 'Terminal is unavailable in this build.');
        }
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, [open, sessionId, projectPath, api]);

  // Subscribe to streamed output and completion.
  useEffect(() => {
    if (!sessionId) return;
    const offOut = api?.onTerminalOutput?.((chunk: TerminalOutputChunk) => {
      if (chunk.sessionId !== sessionId) return;
      // `clear` sends the reset sequence rather than a special message.
      if (chunk.stream === 'system' && chunk.data === '\x1bc') {
        setLines([]); ansiState.current = {}; pendingLine.current = null;
        return;
      }
      pushLines(chunk.data, chunk.stream === 'stderr' ? 'err' : chunk.stream === 'system' ? 'system' : 'out');
    });
    const offExit = api?.onTerminalExit?.((exit: TerminalExitEvent) => {
      if (exit.sessionId !== sessionId) return;
      flushPending();
      setCwd(exit.cwd);
      setRunning(false);
      if (exit.code !== 0 && exit.code !== null) {
        pushLines(`[exit ${exit.code} · ${Math.round(exit.durationMs / 100) / 10}s]\n`, 'system');
      }
    });
    return () => { offOut?.(); offExit?.(); };
  }, [sessionId, api, pushLines, flushPending]);

  // Close the session when the panel unmounts so no child outlives the UI.
  useEffect(() => () => { if (sessionId) api?.terminalClose?.(sessionId); }, [sessionId, api]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [lines]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open, running]);

  const submit = useCallback(async () => {
    const command = input.trim();
    if (!command || !sessionId || running) return;

    pushLines(`${cwd}> ${command}\n`, 'prompt');
    setHistory(h => (h[h.length - 1] === command ? h : [...h, command]).slice(-200));
    setHistoryIndex(null);
    setInput('');
    setRunning(true);

    const res = await api?.terminalRun?.(sessionId, command);
    if (!res?.success) {
      pushLines(`${res?.error || 'Command failed to start.'}\n`, 'err');
      setRunning(false);
    }
  }, [input, sessionId, running, cwd, api, pushLines]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void submit(); return; }
    if (e.key === 'c' && e.ctrlKey && running) { e.preventDefault(); void api?.terminalKill?.(sessionId); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const i = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(i); setInput(history[i]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === null) return;
      const i = historyIndex + 1;
      if (i >= history.length) { setHistoryIndex(null); setInput(''); } else { setHistoryIndex(i); setInput(history[i]); }
    }
  };

  const plainOutput = useMemo(
    () => lines.map(l => l.segments.map(s => s.text).join('')).join('\n'),
    [lines],
  );

  if (!open) return null;

  return (
    <div className="terminal-panel" role="dialog" aria-label="Terminal">
      <div className="terminal-header">
        <span className="terminal-title">Terminal</span>
        <span className="terminal-cwd" title={cwd}>{cwd}</span>
        <div className="terminal-actions">
          {running && (
            <button type="button" className="button terminal-stop" onClick={() => api?.terminalKill?.(sessionId)}>
              Stop
            </button>
          )}
          {onSendToChat && lines.length > 0 && (
            <button
              type="button"
              className="button"
              title="Send a trimmed excerpt of this output to chat"
              onClick={() => onSendToChat(excerptForModel(plainOutput))}
            >
              Send to chat
            </button>
          )}
          <button type="button" className="button" onClick={() => { setLines([]); ansiState.current = {}; }}>
            Clear
          </button>
          <button type="button" className="button" onClick={onClose} aria-label="Close terminal">✕</button>
        </div>
      </div>

      {error && <div className="terminal-error">{error}</div>}

      <div className="terminal-output" ref={scrollRef}>
        {lines.length === 0 && !error && (
          <div className="terminal-empty">
            Commands run in <code>{cwd}</code>. Try <code>git status</code> or <code>npm test</code>.
            Destructive commands are blocked, and you can only work inside your home folder.
          </div>
        )}
        {lines.map(line => (
          <div key={line.id} className={`terminal-line terminal-line-${line.kind}`}>
            {line.segments.length === 0
              ? ' '
              : line.segments.map((seg, i) => <span key={i} style={styleOf(seg)}>{seg.text}</span>)}
          </div>
        ))}
      </div>

      <div className="terminal-input-row">
        <span className="terminal-prompt" aria-hidden="true">&gt;</span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={input}
          disabled={!sessionId || running}
          placeholder={running ? 'Running… press Ctrl+C to stop' : 'Type a command'}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Terminal command"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
