import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, Prec, StateEffect, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { StreamLanguage, indentUnit } from '@codemirror/language';
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
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { SemanticEditorSupport, semanticExtensions, readEditorPreferences, type EditorPreferences } from './SemanticEditorSupport';
import type { WorkspaceLanguageBuffer, WorkspaceLanguageEdit } from '../../../shared/workspace-language-types';
import { ghostCompletionExtension } from './GhostCompletion';

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
    case 'lua':
    case 'luau': return StreamLanguage.define(lua);
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

/** Owned by one open file, discarded when that file's tab closes. */
export interface CodeEditorSession {
  current: {
    state: EditorState;
    scroll: ReturnType<EditorView['scrollSnapshot']>;
    scrollTop: number;
    scrollLeft: number;
    focusLineSeen?: number;
  } | null;
}

interface CodeEditorProps {
  value: string;
  language: string;
  onChange: (next: string) => void;
  onSave: (contentOverride?: string) => void;
  root?: string;
  filePath?: string;
  buffers?: WorkspaceLanguageBuffer[];
  onNavigate?: (path: string, line: number) => void;
  onApplyEdits?: (edits: WorkspaceLanguageEdit[]) => Promise<boolean> | boolean;
  onSelection?: (selection: { path: string; text: string; from: number; to: number }) => void;
  readOnly?: boolean;
  /** Land on this line (1-based) when it changes — a search result's target. */
  focusLine?: number;
  onFocusLineConsumed?: () => void;
  /** In-memory state across view mounts; never writes editor history to disk. */
  session?: CodeEditorSession;
}

export default function CodeEditor({ value, language, onChange, onSave, readOnly, focusLine, onFocusLineConsumed, session, root, filePath, buffers, onNavigate, onApplyEdits, onSelection }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  const themeSlot = useRef(new Compartment());
  const preferencesSlot = useRef(new Compartment());
  const semanticSlot = useRef(new Compartment());
  const [preferences, setPreferences] = useState<EditorPreferences>(readEditorPreferences);
  const semanticContext = useRef({ root, filePath, buffers });
  semanticContext.current = { root, filePath, buffers };
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  // The view is created once; handlers read the latest props through refs.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const focusLineSeen = useRef<number | undefined>(session?.current?.focusLineSeen);

  // Inline edit (Ctrl+K) state
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const unsubscribeInline = useRef<(() => void) | null>(null);
  const onInlineEditRef = useRef<() => void>(() => {});
  const [inputPrompt, setInputPrompt] = useState('');
  const [saveError, setSaveError] = useState('');
  // The entire source snapshot is intentionally conservative: an edit anywhere
  // during generation invalidates the result instead of risking an old offset.
  const inlineSourceRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (activeStreamIdRef.current) (window as any).electron?.cancelStream?.(activeStreamIdRef.current);
    unsubscribeInline.current?.();
  }, []);

  const handleOpenInlineEdit = () => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    if (activeStreamIdRef.current) (window as any).electron?.cancelStream?.(activeStreamIdRef.current);
    unsubscribeInline.current?.(); unsubscribeInline.current = null; activeStreamIdRef.current = null;
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
    inlineSourceRef.current = view.state.doc.toString();
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
    if (viewRef.current?.state.doc.toString() !== inlineSourceRef.current) {
      setInlineEdit(prev => prev ? { ...prev, error: 'The document changed. Close this preview and select the code again.' } : null);
      return;
    }
    const currentEdit = inlineEdit;
    setInlineEdit({ ...currentEdit, status: 'generating', prompt: promptText, replacement: '', error: null });

    const api = (window as any).electron;
    const streamId = `ws-inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeStreamIdRef.current = streamId;

    const finish = (finalReplacement?: string) => {
      if (activeStreamIdRef.current !== streamId) return;
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
        if (activeStreamIdRef.current !== streamId) return;
        setInlineEdit(prev => {
          if (!prev) return null;
          return { ...prev, replacement: prev.replacement + (data.chunk || '') };
        });
      },
      onStreamEnd: () => finish(),
      onStreamError: (err: any) => {
        if (activeStreamIdRef.current !== streamId) return;
        const msg = err?.message || err?.error || 'AI inline edit failed';
        setInlineEdit(prev => prev ? { ...prev, status: 'idle', error: msg } : null);
        unsubscribeInline.current?.();
        unsubscribeInline.current = null;
        activeStreamIdRef.current = null;
      },
    }) ?? null;

    const fullPrompt = buildInlineEditPrompt(promptText, currentEdit.range.text, language);
    try {
      if (!api?.sendStreamMessage) throw new Error('The coding assistant is unavailable.');
      await api.sendStreamMessage({
      streamId,
      user_id: 'desktop_user',
      conversation_id: `workspace:inline-edit:${Date.now()}`,
      message: fullPrompt,
      timestamp: new Date().toISOString(),
      ...(root ? { workspace: { root } } : {}),
      });
    } catch (error) {
      if (activeStreamIdRef.current !== streamId) return;
      unsubscribeInline.current?.(); unsubscribeInline.current = null; activeStreamIdRef.current = null;
      setInlineEdit(prev => prev ? { ...prev, status: 'idle', error: error instanceof Error ? error.message : String(error) } : null);
    }
  };

  const handleAcceptInlineEdit = () => {
    if (!inlineEdit || !viewRef.current) return;
    if (readOnly || inlineEdit.status !== 'preview') return;
    if (viewRef.current.state.doc.toString() !== inlineSourceRef.current) {
      setInlineEdit(prev => prev ? { ...prev, error: 'The document changed. This replacement was not applied. Select the code again.' } : null);
      return;
    }
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

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const readOnlyExtensions = (on: boolean) => [EditorState.readOnly.of(on), EditorView.editable.of(!on)];
    const extensions: Extension[] = [
      basicSetup,
      themeSlot.current.of(editorTheme(appIsLight())),
      keymap.of([indentWithTab]),
      // Ctrl+S saves; Ctrl+K opens inline edit bar.
      Prec.high(keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => { void saveEditorRef.current(); return true; } },
        { key: 'Mod-k', preventDefault: true, run: () => { onInlineEditRef.current(); return true; } },
      ])),
      languageSlot.current.of(languageExtension(language)),
      readOnlySlot.current.of(readOnlyExtensions(!!readOnly)),
      preferencesSlot.current.of(preferenceExtensions(preferences)),
      semanticSlot.current.of(semanticExtensions(() => semanticContext.current)),
      ghostCompletionExtension,
      EditorView.contentAttributes.of({ 'aria-label': 'Code editor' }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          setCursor({ line: line.number, col: head - line.from + 1 });
          const selection = update.state.selection.main;
          onSelectionRef.current?.({ path: semanticContext.current.filePath || '', text: update.state.sliceDoc(selection.from, selection.to), from: selection.from, to: selection.to });
        }
      }),
    ];
    const saved = session?.current;
    // Reconfigure with this mount's compartments and callbacks. Reusing the
    // old extensions would leave undo/save/edit listeners pointing at old refs.
    // Fields still present in basicSetup (including history) keep their values.
    const state = saved
      ? saved.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: value, extensions });
    const view = new EditorView({
      parent: hostRef.current,
      state,
      scrollTo: saved?.scroll,
    });
    if (saved) {
      view.scrollDOM.scrollTop = saved.scrollTop;
      view.scrollDOM.scrollLeft = saved.scrollLeft;
    }
    viewRef.current = view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    setCursor({ line: line.number, col: head - line.from + 1 });
    // Follow the app when the owner switches light/dark while the editor is open.
    const themeWatch = new MutationObserver(() => {
      view.dispatch({ effects: themeSlot.current.reconfigure(editorTheme(appIsLight())) });
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      // Layout cleanup runs before React removes the host. Detached elements
      // can report zero scroll offsets even when their view was scrolled.
      if (session) {
        session.current = {
          state: view.state,
          scroll: view.scrollSnapshot(),
          scrollTop: view.scrollDOM.scrollTop,
          scrollLeft: view.scrollDOM.scrollLeft,
          focusLineSeen: focusLineSeen.current,
        };
      }
      themeWatch.disconnect();
      view.destroy();
      viewRef.current = null;
    };
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

  function preferenceExtensions(settings: EditorPreferences): Extension {
    return [EditorState.tabSize.of(settings.tabSize), indentUnit.of(' '.repeat(settings.tabSize)), EditorView.theme({ '&': { fontSize: `${settings.fontSize}px` }, '.cm-content': { fontFamily: 'Consolas, monospace' } })];
  }
  const saveEditor = async () => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    setSaveError('');
    const currentPreferences = readEditorPreferences();
    if (currentPreferences.formatOnSave && root && filePath && /\.[cm]?[jt]sx?$/i.test(filePath)) {
      const before = view.state.doc.toString();
      try {
        const result = await (window.electron as any).workspaceLanguage?.({ root, path: filePath, content: before, buffers, action: 'format', tabSize: currentPreferences.tabSize });
        if (!result?.success) { setSaveError(result?.error || 'Formatting is unavailable. Disable format on save or retry. Your draft was kept.'); return; }
        if (viewRef.current !== view || view.state.doc.toString() !== before) { setSaveError('You typed while formatting. Your draft was kept; save again when ready.'); return; }
        const changes = result.edits?.[0]?.changes || [];
        view.dispatch({ changes: changes.map((change: { start: number; length: number; text: string }) => ({ from: change.start, to: change.start + change.length, insert: change.text })), userEvent: 'input.format' });
        onSaveRef.current(view.state.doc.toString());
      } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
    } else onSaveRef.current();
  };
  const saveEditorRef = useRef(saveEditor);
  saveEditorRef.current = saveEditor;
  useEffect(() => {
    viewRef.current?.dispatch({ effects: preferencesSlot.current.reconfigure(preferenceExtensions(preferences)) });
  }, [preferences]);

  // A search result asked for this line. Only a CHANGE acts, so the user's own
  // scrolling is never yanked; the editor is keyed per file in WorkspaceShell,
  // so a jump into a newly opened tab fires on mount.
  useEffect(() => {
    if (focusLine === undefined) { focusLineSeen.current = undefined; return; }
    if (focusLineSeen.current === focusLine) return;
    focusLineSeen.current = focusLine;
    const view = viewRef.current;
    if (!view) return;
    const count = view.state.doc.lines;
    const docLine = view.state.doc.line(Math.min(Math.max(1, focusLine), count));
    view.dispatch({
      selection: { anchor: docLine.from },
      effects: EditorView.scrollIntoView(docLine.from, { y: 'center' }),
    });
    view.focus();
    onFocusLineConsumed?.();
  }, [focusLine, onFocusLineConsumed]);

  const diffLines = inlineEdit && inlineEdit.replacement
    ? computeSimpleLineDiff(inlineEdit.range.text, inlineEdit.replacement)
    : [];

  return (
    <div className="code-editor code-editor-cm">
      {root && filePath && <SemanticEditorSupport viewRef={viewRef} root={root} filePath={filePath} buffers={buffers} onNavigate={onNavigate} onApplyEdits={onApplyEdits} preferences={preferences} onPreferences={setPreferences} readOnly={readOnly} />}
      {saveError && <div role="alert">{saveError}</div>}
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
                disabled={inlineEdit.status !== 'preview' || readOnly}
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
