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
          // Ctrl+S must save, ahead of any default binding.
          Prec.high(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { onSaveRef.current(); return true; } }])),
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

  return (
    <div className="code-editor code-editor-cm">
      <div className="code-cm-host" ref={hostRef} />
      <div className="code-cursor-pos" aria-live="off">
        Ln {cursor.line}, Col {cursor.col}
      </div>
    </div>
  );
}
