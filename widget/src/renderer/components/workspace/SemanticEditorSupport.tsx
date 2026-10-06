import { useEffect, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { hoverTooltip, type EditorView } from '@codemirror/view';
import { linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { WorkspaceLanguageAction, WorkspaceLanguageBuffer, WorkspaceLanguageEdit, WorkspaceLanguageResult } from '../../../shared/workspace-language-types';

export interface EditorPreferences { tabSize: 2 | 4; fontSize: number; formatOnSave: boolean }
const STORAGE_KEY = 'homebot.code.editor.preferences.v1';
export function readEditorPreferences(): EditorPreferences {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); return { tabSize: value.tabSize === 4 ? 4 : 2, fontSize: Number.isFinite(value.fontSize) ? Math.max(10, Math.min(30, value.fontSize)) : 14, formatOnSave: value.formatOnSave === true }; }
  catch { return { tabSize: 2, fontSize: 14, formatOnSave: false }; }
}
interface SemanticContext { root?: string; filePath?: string; buffers?: WorkspaceLanguageBuffer[] }
const supported = (context: SemanticContext) => !!context.root && !!context.filePath && /\.[cm]?[jt]sx?$/i.test(context.filePath);
export async function languageQuery(context: SemanticContext, view: EditorView, action: WorkspaceLanguageAction, extra: Record<string, unknown> = {}): Promise<WorkspaceLanguageResult> {
  const api = window.electron as unknown as { workspaceLanguage?: (request: unknown) => Promise<WorkspaceLanguageResult> };
  if (!api?.workspaceLanguage) return { success: false, error: 'Language support is unavailable in this build.' };
  return api.workspaceLanguage({ root: context.root, path: context.filePath, content: view.state.doc.toString(), buffers: context.buffers, position: view.state.selection.main.head, action, ...extra });
}
/** TypeScript's semantic engine reads current unsaved buffers; no renderer compiler. */
export function semanticExtensions(context: () => SemanticContext): Extension {
  return [autocompletion({ override: [async (completion: CompletionContext) => {
    const current = context(); if (!supported(current)) return null;
    const word = completion.matchBefore(/[\w$]*/);
    if (!word || (!completion.explicit && word.from === word.to && completion.state.doc.sliceString(Math.max(0, completion.pos - 1), completion.pos) !== '.')) return null;
    const api = window.electron as any;
    if (!api?.workspaceLanguage) return null;
    try {
      const result: WorkspaceLanguageResult = await api.workspaceLanguage({ root: current.root, path: current.filePath, buffers: current.buffers, content: completion.state.doc.toString(), position: completion.pos, action: 'complete' });
      if (!result.success || completion.aborted) return null;
      return { from: word.from, options: (result.entries || []).map(entry => ({ label: entry.label, detail: entry.type })), validFor: /^[\w$]*$/ };
    } catch { return null; }
  }] }), hoverTooltip(async (view, position) => {
    const current = context(); if (!supported(current)) return null;
    const before = view.state.doc.toString();
    try {
      const result = await languageQuery(current, view, 'hover', { position });
      if (!result.success || !result.text || view.state.doc.toString() !== before || result.text.startsWith('No type')) return null;
      return { pos: position, create: () => { const dom = document.createElement('pre'); dom.style.cssText = 'white-space:pre-wrap;max-width:500px;padding:8px'; dom.textContent = result.text!; return { dom }; } };
    } catch { return null; }
  }), linter(async view => {
    const current = context(); if (!supported(current)) return [];
    const before = view.state.doc.toString();
    try {
      const result = await languageQuery(current, view, 'diagnostics');
      if (!result.success || view.state.doc.toString() !== before) return [];
      return (result.diagnostics || []).map(item => ({ from: Math.min(item.start, before.length), to: Math.min(item.start + item.length, before.length), severity: item.severity, message: item.message }));
    } catch { return []; }
  }, { delay: 900 })];
}

interface Props {
  viewRef: MutableRefObject<EditorView | null>; root: string; filePath: string; buffers?: WorkspaceLanguageBuffer[];
  onNavigate?: (path: string, line: number) => void;
  onApplyEdits?: (edits: WorkspaceLanguageEdit[]) => Promise<boolean> | boolean;
  preferences: EditorPreferences; onPreferences: (value: EditorPreferences) => void; readOnly?: boolean;
}
export function SemanticEditorSupport({ viewRef, root, filePath, buffers, onNavigate, onApplyEdits, preferences, onPreferences, readOnly }: Props) {
  const [result, setResult] = useState<WorkspaceLanguageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const query = async (action: WorkspaceLanguageAction, extra = {}) => {
    const view = viewRef.current; if (!view || busy) return;
    setBusy(true); setNotice('');
    try { setResult(await languageQuery({ root, filePath, buffers }, view, action, extra)); }
    catch (error) { setResult({ success: false, error: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };
  const apply = async (edits: WorkspaceLanguageEdit[]) => {
    if (readOnly) return;
    try {
      let applied = false;
      if (onApplyEdits) applied = await onApplyEdits(edits);
      else {
        const view = viewRef.current;
        if (view && edits.length === 1 && edits[0].path === filePath && edits[0].expectedContent === view.state.doc.toString()) {
          view.dispatch({ changes: edits[0].changes.map(edit => ({ from: edit.start, to: edit.start + edit.length, insert: edit.text })), userEvent: 'input.refactor' }); applied = true;
        }
      }
      if (!applied) setNotice('The source changed or a target is unavailable. Nothing was applied. Run the action again.');
      else { setNotice('Applied to unsaved editor buffers. Review and save when ready.'); setResult(null); }
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const view = viewRef.current;
      if (!view || !view.dom.contains(event.target as Node)) return;
      if (event.key === 'F12') { event.preventDefault(); void query(event.shiftKey ? 'references' : 'definition'); }
      else if (event.key === 'F2') { event.preventDefault(); setRename(true); }
      else if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); void query('format', { tabSize: preferences.tabSize }); }
      else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'Space') { event.preventDefault(); void query('signature'); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  // The query intentionally uses this render's buffers and busy state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, filePath, buffers, busy, preferences.tabSize]);
  const updatePreference = (value: EditorPreferences) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { setNotice('Editor preferences could not be stored.'); } onPreferences(value); };
  return <>
    <div role="toolbar" aria-label="Language tools" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 8px', flexShrink: 0 }}>
      <button disabled={busy} onClick={() => void query('definition')}>Definition (F12)</button>
      <button disabled={busy} onClick={() => void query('references')}>References</button>
      <button disabled={busy} onClick={() => void query('hover')}>Type information</button>
      <button disabled={busy} onClick={() => void query('signature')}>Signature</button>
      <button disabled={busy || readOnly} onClick={() => setRename(true)}>Rename symbol (F2)</button>
      <button disabled={busy || readOnly} onClick={() => void query('fixes')}>Quick fixes</button>
      <button disabled={busy || readOnly} onClick={() => void query('format', { tabSize: preferences.tabSize })}>Format</button>
      <button onClick={() => setSettings(!settings)}>Editor settings</button>
      {busy && <span role="status">Checking project…</span>}
    </div>
    {settings && <div style={{ padding: 8 }}>
      <label>Indentation <select aria-label="Editor indentation" value={preferences.tabSize} onChange={event => updatePreference({ ...preferences, tabSize: event.target.value === '4' ? 4 : 2 })}><option value="2">2 spaces</option><option value="4">4 spaces</option></select></label>
      <label> Font size <input aria-label="Editor font size" type="number" min={10} max={30} value={preferences.fontSize} onChange={event => updatePreference({ ...preferences, fontSize: Math.max(10, Math.min(30, Number(event.target.value) || 14)) })} /></label>
      <label><input type="checkbox" checked={preferences.formatOnSave} onChange={event => updatePreference({ ...preferences, formatOnSave: event.target.checked })} />Format JS/TS on save</label>
      <p>JavaScript and TypeScript use local project language analysis. Other languages support highlighting and text editing; they need a separate language service for semantic tools.</p>
    </div>}
    {notice && <div role="status" style={{ padding: 8 }}>{notice}</div>}
    {rename && createPortal(<div className="confirmation-overlay" role="dialog" aria-modal="true" aria-label="Rename symbol" style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', background: '#0008' }}><div style={{ background: 'var(--bg-primary, #202124)', padding: 20 }}><label>New symbol name <input autoFocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setRename(false); }} /></label><button disabled={!name.trim()} onClick={() => { setRename(false); void query('rename', { newName: name }); }}>Preview rename</button><button onClick={() => setRename(false)}>Cancel</button></div></div>, document.body)}
    {result && <section aria-label="Language result" style={{ padding: 8, maxHeight: 240, overflow: 'auto' }}>
      <button aria-label="Close language result" onClick={() => setResult(null)}>Close</button>
      {!result.success && <p role="alert">{result.error}</p>}
      {result.text && <pre style={{ whiteSpace: 'pre-wrap' }}>{result.text}</pre>}
      {result.locations?.map((location, index) => <div key={index}><button disabled={!onNavigate} onClick={() => onNavigate?.(location.path, location.line)}>{location.name || location.path.split(/[\\/]/).pop()} — {location.path}:{location.line}:{location.column}</button></div>)}
      {result.locations?.length === 0 && <p>No project locations found at this cursor.</p>}
      {result.edits && <><p>Review {result.edits.reduce((count, edit) => count + edit.changes.length, 0)} changes in {result.edits.length} file(s). These are staged as unsaved drafts.</p>{result.edits.map(edit => <details key={edit.path}><summary>{edit.path}</summary>{edit.changes.map((change, index) => <pre key={index} style={{ whiteSpace: 'pre-wrap' }}>-{edit.expectedContent.slice(change.start, change.start + change.length)}{'\n'}+{change.text}</pre>)}</details>)}<button disabled={readOnly} onClick={() => void apply(result.edits!)}>Apply reviewed edits</button></>}
      {result.fixes?.map((fix, index) => <details key={index}><summary>{fix.description}</summary>{fix.edits.map(edit => <pre key={edit.path}>{edit.path}{'\n'}{edit.changes.map(change => change.text).join('\n')}</pre>)}<button disabled={readOnly} onClick={() => void apply(fix.edits)}>Apply this fix to drafts</button></details>)}
      {result.fixes?.length === 0 && <p>No automatic fix is available at this cursor.</p>}
    </section>}
  </>;
}
