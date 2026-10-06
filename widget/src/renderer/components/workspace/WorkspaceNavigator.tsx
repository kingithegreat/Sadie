import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceLanguageBuffer, WorkspaceLanguageLocation, WorkspaceLanguageResult } from '../../../shared/workspace-language-types';
export interface WorkspaceCommand { id: string; label: string; run: () => void | Promise<void> }
interface Props { root: string; activePath?: string; content?: string; buffers?: WorkspaceLanguageBuffer[]; onOpen: (path: string, line?: number) => void; commands: WorkspaceCommand[]; mode: 'files' | 'commands' | 'symbols'; onClose: () => void }
export default function WorkspaceNavigator({ root, activePath, content, buffers, onOpen, commands, mode, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [symbols, setSymbols] = useState<WorkspaceLanguageLocation[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(mode !== 'commands');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    let current = true;
    input.current?.focus();
    if (mode !== 'commands') {
      const api = window.electron as any;
      if (!api?.workspaceLanguage) { setError('Project navigation is unavailable in this build.'); setLoading(false); }
      else void api.workspaceLanguage({ root, path: activePath || root, content: content || '', buffers, action: mode === 'files' ? 'files' : 'symbols' }).then((result: WorkspaceLanguageResult) => {
        if (!current) return;
        if (!result.success) setError(result.error || 'Project navigation failed.');
        setFiles(result.files || []); setSymbols(result.locations || []); setLoading(false);
      }).catch((error: unknown) => { if (current) { setError(String(error)); setLoading(false); } });
    }
    return () => { current = false; previousFocus.current?.focus(); };
  // Snapshot the open buffers when the user opens this picker.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, mode]);
  const search = query.toLocaleLowerCase();
  const options = mode === 'commands' ? commands.filter(command => command.label.toLocaleLowerCase().includes(search)).map(command => ({ id: command.id, label: command.label, run: command.run })) : mode === 'files' ? files.filter(file => file.toLocaleLowerCase().includes(search)).map(file => ({ id: file, label: file.replace(root, '').replace(/^[\\/]/, ''), run: () => onOpen(file) })) : symbols.filter(symbol => `${symbol.name} ${symbol.path}`.toLocaleLowerCase().includes(search)).map((symbol, index) => ({ id: `${index}:${symbol.path}:${symbol.start}`, label: `${symbol.name || 'Symbol'} — ${symbol.path.replace(root, '').replace(/^[\\/]/, '')}:${symbol.line}`, run: () => onOpen(symbol.path, symbol.line) }));
  const shown = options.slice(0, 100);
  const activate = (index: number) => { const item = shown[index]; if (item) { onClose(); void item.run(); } };
  return createPortal(<div className="confirmation-overlay" role="dialog" aria-modal="true" aria-label={mode === 'commands' ? 'Command palette' : mode === 'symbols' ? 'Project symbols' : 'Quick Open'} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#0007', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 60 }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(index => Math.min(shown.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => Math.max(0, index - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); activate(selected); }
    else if (event.key === 'Tab') { event.preventDefault(); input.current?.focus(); }
  }}><div style={{ width: 'min(700px, 90vw)', background: 'var(--bg-primary, #202124)', padding: 12, border: '1px solid var(--border-color, #666)' }}>
    <input ref={input} aria-label={mode === 'commands' ? 'Search commands' : mode === 'symbols' ? 'Search symbols' : 'Search project files'} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} style={{ width: '100%' }} placeholder={mode === 'commands' ? 'Run a command…' : mode === 'symbols' ? 'Find a project symbol…' : 'Open a project file…'} role="combobox" aria-expanded="true" aria-controls="workspace-navigation-options" aria-activedescendant={shown[selected] ? `ws-nav-option-${selected}` : undefined} />
    {loading && <p role="status">Reading project…</p>}{error && <p role="alert">{error}</p>}
    <div id="workspace-navigation-options" role="listbox" style={{ maxHeight: '60vh', overflow: 'auto' }}>{shown.map((item, index) => <div key={item.id} id={`ws-nav-option-${index}`} role="option" aria-selected={selected === index} style={{ padding: 8, background: selected === index ? 'var(--bg-hover, #444)' : undefined, cursor: 'pointer' }} onMouseMove={() => setSelected(index)} onClick={() => activate(index)}>{item.label}</div>)}</div>
    {!loading && !error && shown.length === 0 && <p>No matches.</p>}<small>Arrow keys to choose, Enter to open, Escape to close. Up to 2,000 project files; dependencies and generated folders excluded.</small>
  </div></div>, document.body);
}
