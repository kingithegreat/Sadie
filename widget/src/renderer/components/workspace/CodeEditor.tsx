import { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import powershell from 'highlight.js/lib/languages/powershell';
import ini from 'highlight.js/lib/languages/ini';

/**
 * Code editor pane.
 *
 * Deliberately NOT Monaco. Monaco is VS Code's editor and would be the faithful
 * choice, but it needs web workers and a bundler config that this app's strict
 * CSP and electron-vite setup would have to be reworked for — a change I can't
 * visually verify. This is the well-trodden alternative: a transparent textarea
 * over a highlighted <pre>, scroll-synced, using the highlight.js already in
 * the dependency tree (see MessageBubble). Real editing, real highlighting,
 * zero new dependencies. Swapping in Monaco later only touches this file.
 */

for (const [name, lang] of [
  ['javascript', javascript], ['typescript', typescript], ['python', python],
  ['json', json], ['css', css], ['xml', xml], ['bash', bash],
  ['markdown', markdown], ['yaml', yaml], ['sql', sql], ['go', go],
  ['rust', rust], ['java', java], ['csharp', csharp],
  ['powershell', powershell], ['ini', ini],
] as const) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, lang as any);
}

const TAB = '  ';

interface CodeEditorProps {
  value: string;
  language: string;
  onChange: (next: string) => void;
  onSave: () => void;
  readOnly?: boolean;
}

export default function CodeEditor({ value, language, onChange, onSave, readOnly }: CodeEditorProps) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const highlighted = useMemo(() => {
    // A trailing newline keeps the final line's height in the <pre> so the
    // overlay stays aligned with the textarea's last row.
    const src = value.endsWith('\n') ? value + ' ' : value;
    try {
      if (language && language !== 'plaintext' && hljs.getLanguage(language)) {
        return hljs.highlight(src, { language, ignoreIllegals: true }).value;
      }
    } catch { /* fall through to escaped plain text */ }
    return src.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  }, [value, language]);

  const lineCount = useMemo(() => value.split('\n').length, [value]);

  // Keep the highlight layer and gutter locked to the textarea's scroll.
  const syncScroll = () => {
    const t = textRef.current;
    if (!t) return;
    if (preRef.current) {
      preRef.current.scrollTop = t.scrollTop;
      preRef.current.scrollLeft = t.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = t.scrollTop;
  };

  useEffect(syncScroll, [value]);

  const updateCursor = () => {
    const t = textRef.current;
    if (!t) return;
    const upto = t.value.slice(0, t.selectionStart);
    const lines = upto.split('\n');
    setCursor({ line: lines.length, col: lines[lines.length - 1].length + 1 });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave();
      return;
    }
    // Tab must indent, not move focus out of the editor.
    if (e.key === 'Tab') {
      e.preventDefault();
      const t = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = t;
      const next = t.value.slice(0, s) + TAB + t.value.slice(en);
      onChange(next);
      requestAnimationFrame(() => {
        t.selectionStart = t.selectionEnd = s + TAB.length;
      });
    }
  };

  return (
    <div className="code-editor">
      <div className="code-gutter" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className={`code-line-no${i + 1 === cursor.line ? ' current' : ''}`}>{i + 1}</div>
        ))}
      </div>

      <div className="code-surface">
        <pre className="code-highlight" ref={preRef} aria-hidden="true">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
        <textarea
          ref={textRef}
          className="code-input"
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
          aria-label="Code editor"
          onChange={(e) => { onChange(e.target.value); updateCursor(); }}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          onKeyUp={updateCursor}
          onClick={updateCursor}
        />
      </div>

      <div className="code-cursor-pos" aria-live="off">
        Ln {cursor.line}, Col {cursor.col}
      </div>
    </div>
  );
}
