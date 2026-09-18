import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { rust } from '@codemirror/lang-rust';
import { java } from '@codemirror/lang-java';
import { go } from '@codemirror/lang-go';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { csharp } from '@codemirror/legacy-modes/mode/clike';

/**
 * Code editor pane, on CodeMirror 6.
 *
 * The previous editor was a textarea over highlight.js: typing and colour, but
 * no find/replace, multiple cursors, folding, bracket matching or real undo.
 * Monaco was ruled out because it needs web workers and bundler configuration
 * that this app's CSP would have to change for. CodeMirror 6 is plain ES
 * modules with no workers, and its injected styles are allowed by the CSP's
 * style-src 'unsafe-inline', so the policy is unchanged.
 *
 * basicSetup brings: search and replace (Ctrl+F / Ctrl+H via the search panel),
 * multiple selections (Ctrl+D, Alt+click, rectangular Alt+drag), code folding,
 * bracket matching and auto-closing, history (Ctrl+Z / Ctrl+Shift+Z), line
 * numbers, active-line highlight and autocompletion from the document.
 */

/** The app's own light/dark choice (App.tsx sets data-theme on <html>). */
function appIsLight(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'light';
}

/** One Dark in the dark app; CodeMirror's light default on the pane's own background in the light app. */
export function editorTheme(light: boolean): Extension {
  return light ? EditorView.theme({ '&': { backgroundColor: 'transparent' } }, { dark: false }) : oneDark;
}

/** Language names as the main process reports them (highlight.js names). */
export function languageExtension(language: string): Extension {
  switch (language) {
    case 'javascript': return javascript({ jsx: true });
    case 'typescript': return javascript({ jsx: true, typescript: true });
    case 'python': return python();
    case 'json': return json();
    case 'css': return css();
    case 'xml':
    case 'html': return html();
    case 'markdown': return markdown();
    case 'sql': return sql();
    case 'yaml': return yaml();
    case 'rust': return rust();
    case 'java': return java();
    case 'go': return go();
    case 'bash': return StreamLanguage.define(shell);
    case 'powershell': return StreamLanguage.define(powerShell);
    case 'ini': return StreamLanguage.define(properties);
    case 'csharp': return StreamLanguage.define(csharp);
    default: return [];
  }
}

/** Prepares a prompt that instructs the assistant to produce a direct drop-in replacement snippet. */
export function buildInlineEditPrompt(instruction: string, selectedCode: string, language: string): string {
  return `You are an expert AI coding engine. The user wants you to edit the following ${language} code.

INSTRUCTION:
${instruction.trim()}

CURRENT CODE:
\`\`\`${language}
${selectedCode}
\`\`\`

CRITICAL RULES:
1. Output ONLY the replacement code.
2. Do NOT wrap your output in markdown code blocks (\`\`\`).
3. Do NOT provide explanation, notes, greeting, or commentary.
4. Output the complete replacement snippet that will directly replace the CURRENT CODE in the file.`;
}

/** Strips markdown code fences if the model generated them despite instructions. */
export function cleanCodeReplacement(raw: string): string {
  let text = raw.trim();
  const match = text.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)(?:\r?\n```)?$/);
  if (match) {
    return match[1];
  }
  if (text.startsWith('```') && text.endsWith('```')) {
    text = text.slice(3, -3).trim();
  }
  return text;
}

export interface InlineDiffLine {
  type: 'equal' | 'add' | 'remove';
  text: string;
}

/** Computes a line-by-line diff for the inline diff preview. */
export function computeSimpleLineDiff(before: string, after: string): InlineDiffLine[] {
  const beforeLines = before.replace(/\r\n/g, '\n').split('\n');
  const afterLines = after.replace(/\r\n/g, '\n').split('\n');
  const result: InlineDiffLine[] = [];

  if (before === after) {
    return beforeLines.map(text => ({ type: 'equal', text }));
  }

  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    result.push({ type: 'equal', text: beforeLines[start] });
    start++;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  const suffixLines: InlineDiffLine[] = [];
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    suffixLines.unshift({ type: 'equal', text: beforeLines[beforeEnd] });
    beforeEnd--;
    afterEnd--;
  }

  for (let i = start; i <= beforeEnd; i++) {
    result.push({ type: 'remove', text: beforeLines[i] });
  }
  for (let i = start; i <= afterEnd; i++) {
    result.push({ type: 'add', text: afterLines[i] });
  }

  return [...result, ...suffixLines];
}

export interface InlineEditState {
  range: {
    from: number;
    to: number;
    text: string;
    lineStart: number;
    lineEnd: number;
  };
  prompt: string;
  status: 'idle' | 'generating' | 'preview';
  replacement: string;
  error: string | null;
}

interface CodeEditorProps {
  value: string;
  language: string;
  onChange: (next: string) => void;
  onSave: () => void;
  readOnly?: boolean;
}

export default function CodeEditor({ value, language, onChange, onSave, readOnly }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  const themeSlot = useRef(new Compartment());
  // The view is created once; handlers read the latest props through refs.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  // Inline edit (Ctrl+K) state
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const unsubscribeInline = useRef<(() => void) | null>(null);
  const onInlineEditRef = useRef<() => void>(() => {});
  const [inputPrompt, setInputPrompt] = useState('');

  useEffect(() => () => {
    unsubscribeInline.current?.();
  }, []);

  const handleOpenInlineEdit = () => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const sel = view.state.selection.main;
    let from: number;
    let to: number;
    let text: string;
    let lineStart: number;
    let lineEnd: number;

    if (sel.empty) {
      const line = view.state.doc.lineAt(sel.head);
      from = line.from;
      to = line.to;
      text = line.text;
      lineStart = line.number;
      lineEnd = line.number;
    } else {
      lineStart = view.state.doc.lineAt(sel.from).number;
      lineEnd = view.state.doc.lineAt(sel.to).number;
      from = sel.from;
      to = sel.to;
      text = view.state.sliceDoc(sel.from, sel.to);
    }

    setInputPrompt('');
    setInlineEdit({
      range: { from, to, text, lineStart, lineEnd },
      prompt: '',
      status: 'idle',
      replacement: '',
      error: null,
    });
  };
  onInlineEditRef.current = handleOpenInlineEdit;

  const handleGenerateInlineEdit = async (promptText: string) => {
    if (!inlineEdit || !promptText.trim()) return;
    const currentEdit = inlineEdit;
    setInlineEdit({ ...currentEdit, status: 'generating', prompt: promptText, replacement: '', error: null });

    const api = (window as any).electron;
    const streamId = `ws-inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeStreamIdRef.current = streamId;

    const finish = (finalReplacement?: string) => {
      unsubscribeInline.current?.();
      unsubscribeInline.current = null;
      activeStreamIdRef.current = null;
      setInlineEdit(prev => {
        if (!prev) return null;
        const clean = cleanCodeReplacement(finalReplacement ?? prev.replacement);
        return { ...prev, status: 'preview', replacement: clean };
      });
    };

    unsubscribeInline.current = api?.subscribeToStream?.(streamId, {
      onStreamChunk: (data: { chunk: string }) => {
        setInlineEdit(prev => {
          if (!prev) return null;
          return { ...prev, replacement: prev.replacement + (data.chunk || '') };
        });
      },
      onStreamEnd: () => finish(),
      onStreamError: (err: any) => {
        const msg = err?.message || err?.error || 'AI inline edit failed';
        setInlineEdit(prev => prev ? { ...prev, status: 'idle', error: msg } : null);
        unsubscribeInline.current?.();
        unsubscribeInline.current = null;
        activeStreamIdRef.current = null;
      },
    }) ?? null;

    const fullPrompt = buildInlineEditPrompt(promptText, currentEdit.range.text, language);
    await api?.sendStreamMessage?.({
      streamId,
      user_id: 'desktop_user',
      conversation_id: `workspace:inline-edit:${Date.now()}`,
      message: fullPrompt,
      timestamp: new Date().toISOString(),
    });
  };

  const handleAcceptInlineEdit = () => {
    if (!inlineEdit || !viewRef.current) return;
    const { from, to } = inlineEdit.range;
    const insert = inlineEdit.replacement;
    viewRef.current.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: 'input.ai',
    });
    setInlineEdit(null);
    setInputPrompt('');
    viewRef.current.focus();
  };

  const handleRejectInlineEdit = () => {
    const api = (window as any).electron;
    if (activeStreamIdRef.current) {
      api?.cancelStream?.(activeStreamIdRef.current);
    }
    unsubscribeInline.current?.();
    unsubscribeInline.current = null;
    activeStreamIdRef.current = null;
    setInlineEdit(null);
    setInputPrompt('');
    viewRef.current?.focus();
  };

  useEffect(() => {
    if (!hostRef.current) return;
    const readOnlyExtensions = (on: boolean) => [EditorState.readOnly.of(on), EditorView.editable.of(!on)];
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          themeSlot.current.of(editorTheme(appIsLight())),
          keymap.of([indentWithTab]),
          // Ctrl+S saves; Ctrl+K opens inline edit bar.
          Prec.high(keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { onSaveRef.current(); return true; } },
            { key: 'Mod-k', preventDefault: true, run: () => { onInlineEditRef.current(); return true; } },
          ])),
          languageSlot.current.of(languageExtension(language)),
          readOnlySlot.current.of(readOnlyExtensions(!!readOnly)),
          EditorState.tabSize.of(2),
          EditorView.contentAttributes.of({ 'aria-label': 'Code editor' }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              setCursor({ line: line.number, col: head - line.from + 1 });
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    // Follow the app when the owner switches light/dark while the editor is open.
    const themeWatch = new MutationObserver(() => {
      view.dispatch({ effects: themeSlot.current.reconfigure(editorTheme(appIsLight())) });
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { themeWatch.disconnect(); view.destroy(); viewRef.current = null; };
    // Created once per mount; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A value from outside (another tab's file, a reload) replaces the document.
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageSlot.current.reconfigure(languageExtension(language)) });
  }, [language]);

  useEffect(() => {
    const on = !!readOnly;
    viewRef.current?.dispatch({ effects: readOnlySlot.current.reconfigure([EditorState.readOnly.of(on), EditorView.editable.of(!on)]) });
  }, [readOnly]);

  const diffLines = inlineEdit && inlineEdit.replacement
    ? computeSimpleLineDiff(inlineEdit.range.text, inlineEdit.replacement)
    : [];

  return (
    <div className="code-editor code-editor-cm">
      {inlineEdit && (
        <div className="code-inline-edit-bar" data-testid="code-inline-edit-bar">
          <div className="code-inline-edit-header">
            <div className="code-inline-edit-badges">
              <span className="code-inline-edit-title">✨ Inline Edit</span>
              <span className="code-inline-edit-badge">
                {inlineEdit.range.lineStart === inlineEdit.range.lineEnd
                  ? `Line ${inlineEdit.range.lineStart}`
                  : `Lines ${inlineEdit.range.lineStart}–${inlineEdit.range.lineEnd}`}
              </span>
              <span className="code-inline-edit-badge">{language}</span>
            </div>
            <button
              type="button"
              className="ws-tab-close"
              data-testid="inline-edit-close-btn"
              aria-label="Close inline edit"
              onClick={handleRejectInlineEdit}
            >
              ✕
            </button>
          </div>

          <div className="code-inline-edit-input-row">
            <input
              type="text"
              autoFocus
              className="code-inline-edit-input"
              data-testid="inline-edit-input"
              aria-label="Inline edit prompt"
              placeholder="Describe edit or instructions… (Enter to submit, Esc to cancel)"
              value={inputPrompt}
              disabled={inlineEdit.status === 'generating'}
              onChange={e => setInputPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  void handleGenerateInlineEdit(inputPrompt);
                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && inlineEdit.status === 'preview') {
                  e.preventDefault();
                  handleAcceptInlineEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleRejectInlineEdit();
                }
              }}
            />
            {inlineEdit.status === 'generating' ? (
              <button
                type="button"
                className="code-inline-btn code-inline-btn-secondary"
                data-testid="inline-edit-stop-btn"
                onClick={handleRejectInlineEdit}
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="code-inline-btn code-inline-btn-primary"
                data-testid="inline-edit-submit-btn"
                disabled={!inputPrompt.trim()}
                onClick={() => void handleGenerateInlineEdit(inputPrompt)}
              >
                Generate ⏎
              </button>
            )}
          </div>

          {inlineEdit.error && (
            <div className="code-inline-edit-error" data-testid="inline-edit-error">
              {inlineEdit.error}
            </div>
          )}

          {inlineEdit.status === 'generating' && (
            <div className="code-inline-edit-loading" data-testid="inline-edit-loading">
              <span>⏳ Generating replacement…</span>
            </div>
          )}

          {diffLines.length > 0 && (
            <div className="code-inline-diff-preview" data-testid="code-inline-diff-preview">
              {diffLines.map((line, idx) => (
                <div key={idx} className={`code-diff-line ${line.type}`} data-type={line.type}>
                  <span className="diff-sign">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
                  <span className="diff-text">{line.text || ' '}</span>
                </div>
              ))}
            </div>
          )}

          {(inlineEdit.status === 'preview' || inlineEdit.replacement) && (
            <div className="code-inline-edit-actions" data-testid="inline-edit-actions">
              <button
                type="button"
                className="code-inline-btn code-inline-btn-secondary"
                data-testid="inline-edit-reject-btn"
                onClick={handleRejectInlineEdit}
              >
                ✕ Reject (Esc)
              </button>
              <button
                type="button"
                className="code-inline-btn code-inline-btn-primary"
                data-testid="inline-edit-accept-btn"
                onClick={handleAcceptInlineEdit}
              >
                ✓ Accept (Ctrl+Enter)
              </button>
            </div>
          )}
        </div>
      )}

      <div className="code-cm-host" ref={hostRef} />
      <div className="code-cursor-pos" aria-live="off">
        Ln {cursor.line}, Col {cursor.col}
      </div>
    </div>
  );
}
