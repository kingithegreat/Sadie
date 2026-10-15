import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { setIdeSettingsSnapshot } from './ideSettingsStore';

type Which = 'settings' | 'keybindings';
/** "Open Settings (JSON)": edits <userData>/settings.json or keybindings.json, validated by main on save. */
export default function SettingsJsonDialog({ initial, onClose }: { initial: Which; onClose: () => void }) {
  const [which, setWhich] = useState<Which>(initial);
  const [path, setPath] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [status, setStatus] = useState('Loading…');
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const saveRef = useRef<() => void>(() => {});
  const api = (window as any).electron;
  const save = async () => {
    const text = view.current?.state.doc.toString(); if (text === undefined) return;
    const result = await api?.workspaceIdeSettings?.({ action: 'save', which, text });
    if (!result?.success) { setStatus(result?.error || 'Could not save.'); return; }
    setProblems(result.problems || []); if (result.snapshot) setIdeSettingsSnapshot(result.snapshot);
    setStatus(result.problems?.length ? `Saved with ${result.problems.length} problem(s); invalid entries are ignored.` : 'Saved and applied.');
  };
  saveRef.current = () => { void save(); };
  useLayoutEffect(() => {
    if (!host.current) return;
    const created = new EditorView({ parent: host.current, state: EditorState.create({ doc: '', extensions: [basicSetup, json(), document.documentElement.getAttribute('data-theme') === 'light' ? [] : oneDark,
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(); return true; } }]), EditorView.contentAttributes.of({ 'aria-label': `${which}.json editor` })] }) });
    view.current = created;
    return () => { created.destroy(); view.current = null; };
  }, [which]);
  useEffect(() => {
    let alive = true; setStatus('Loading…');
    void Promise.resolve(api?.workspaceIdeSettings?.({ action: 'read', which })).then((result: any) => {
      if (!alive) return;
      if (!result?.success) { setStatus(result?.error || 'Settings are unavailable in this build.'); return; }
      const current = view.current; current?.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: result.text } });
      setPath(result.path); setProblems(result.problems || []); setStatus(result.exists ? '' : 'This file does not exist yet. Save to create it from this template.');
    });
    return () => { alive = false; };
  }, [which, api]);
  return createPortal(<div className="confirmation-overlay" role="dialog" aria-modal="true" aria-label="Settings (JSON)" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#0008', display: 'grid', placeItems: 'center' }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <div style={{ width: 'min(900px, 94vw)', height: 'min(720px, 90vh)', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-primary, #202124)', padding: 12, border: '1px solid var(--border-color, #666)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button aria-pressed={which === 'settings'} onClick={() => setWhich('settings')}>settings.json</button>
        <button aria-pressed={which === 'keybindings'} onClick={() => setWhich('keybindings')}>keybindings.json</button>
        <small style={{ flex: 1, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis' }} title={path}>{path}</small>
        <button onClick={() => void save()}>Save (Ctrl+S)</button><button onClick={onClose}>Close</button>
      </div>
      <div ref={host} style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border-color, #555)' }} />
      {status && <div role="status">{status}</div>}
      {problems.length > 0 && <ul role="alert" aria-label="Settings problems" data-testid="settings-problems" style={{ margin: 0, maxHeight: 140, overflow: 'auto' }}>{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
    </div>
  </div>, document.body);
}
