import { useEffect, useRef, useState } from 'react';
import type { WorkspaceDebugRequest, WorkspaceDebugResult } from '../../../shared/workspace-debug-types';
interface Props { root: string; activePath?: string; onOpenFile: (path: string, line?: number) => void }
export default function DebuggerPanel({ root, activePath, onOpenFile }: Props) {
  const [file, setFile] = useState(activePath || ''); const [args, setArgs] = useState('');
  const [state, setState] = useState<WorkspaceDebugResult | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(1); const [frame, setFrame] = useState(''); const [watch, setWatch] = useState(''); const [value, setValue] = useState('');
  const [variables, setVariables] = useState<Array<{ name: string; value: string }>>([]);
  const api = window.electron as any;
  const currentRoot = useRef(root); currentRoot.current = root;
  const request = async (action: WorkspaceDebugRequest['action'], extra: Partial<WorkspaceDebugRequest> = {}) => {
    setBusy(true); setError('');
    try { const result: WorkspaceDebugResult = await api?.workspaceDebug?.({ root, action, ...extra }) || { success: false, error: 'Debugging is unavailable in this build.' }; if (currentRoot.current !== root) return; if (!result.success) setError(result.error || 'The debugger action failed.'); else { setState(result); if (result.value !== undefined) setValue(result.value); if (result.variables) setVariables(result.variables); } }
    catch (error) { if (currentRoot.current === root) setError(String(error)); } finally { if (currentRoot.current === root) setBusy(false); }
  };
  useEffect(() => {
    let mounted = true;
    setState(null); setError(''); setBusy(false); setFrame(''); setVariables([]); setValue(''); setFile(activePath || '');
    const refresh = async () => { try { const result = await api?.workspaceDebug?.({ root, action: 'state' }); if (mounted && result?.success) setState(result); } catch { /* An explicit action provides error recovery. */ } };
    void refresh(); const timer = setInterval(() => void refresh(), 700);
    return () => { mounted = false; clearInterval(timer); };
  // The active path seeds the program only when the project changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, root]);
  useEffect(() => { if (!state?.paused) { setVariables([]); setValue(''); setFrame(''); } }, [state?.paused]);
  return <section aria-label="Debugger" className="workspace-debugger" style={{ padding: 8, overflow: 'auto' }}>
    <p>Debug a JavaScript Node program. TypeScript needs compiled JavaScript; other runtimes need a separate debug adapter. The program runs only after confirmation.</p>
    <label>Program<input aria-label="Debug program path" value={file} onChange={event => setFile(event.target.value)} /></label>
    <label>Arguments (one per line)<textarea aria-label="Debug program arguments" value={args} onChange={event => setArgs(event.target.value)} rows={2} /></label>
    <button disabled={busy || state?.running || !file} onClick={() => void request('start', { file, args: args.split('\n').filter(Boolean) })}>Start debugging</button>
    <div role="toolbar" aria-label="Debug controls">
      <button disabled={busy || !(state?.running || state?.cleanupPending)} onClick={() => void request('stop')}>Stop debugger</button>
      <button disabled={busy || !state?.paused} onClick={() => void request('resume')}>Continue</button>
      <button disabled={busy || !state?.running || state?.paused} onClick={() => void request('pause')}>Pause</button>
      {(['step-over', 'step-in', 'step-out'] as const).map(action => <button key={action} disabled={busy || !state?.paused} onClick={() => void request(action)}>{action.replace(/-/g, ' ')}</button>)}
    </div>
    <div role="status">{state?.running ? state.paused ? 'Paused' : 'Running' : state?.cleanupPending ? 'Program ended; cleanup pending' : 'Stopped'}</div>{(error || state?.error) && <p role="alert">{error || state?.error}</p>}
    <label>Breakpoint line<input aria-label="Breakpoint line" type="number" min={1} value={line} onChange={event => setLine(Number(event.target.value))} /></label><button disabled={busy || !state?.running || !file} onClick={() => void request('breakpoint', { file, line })}>Add breakpoint</button>
    {state?.breakpoints?.map(point => <div key={`${point.path}:${point.line}`}><button onClick={() => onOpenFile(point.path, point.line)}>{point.path}:{point.line}</button><button disabled={busy} onClick={() => void request('breakpoint', { file: point.path, line: point.line, remove: true })}>Remove breakpoint</button></div>)}
    <h4>Call stack</h4>{state?.frames?.map(item => <div key={item.id}><button aria-pressed={frame === item.id} onClick={() => { setFrame(item.id); if (item.path) onOpenFile(item.path, item.line); }}>{item.name} — {item.path || '(runtime)'}:{item.line}</button></div>)}
    <button disabled={!state?.paused || busy} onClick={() => void request('scopes', { frameId: frame })}>Inspect variables</button>{variables.map(item => <div key={item.name}><code>{item.name}</code>: {item.value}</div>)}
    <label>Watch expression<input aria-label="Watch expression" value={watch} onChange={event => setWatch(event.target.value)} /></label><button disabled={!state?.paused || busy || !watch.trim()} onClick={() => void request('evaluate', { frameId: frame, expression: watch })}>Evaluate watch</button><pre>{value}</pre>
    <h4>Program output</h4><pre style={{ whiteSpace: 'pre-wrap' }}>{state?.output || 'No output.'}</pre>
  </section>;
}
