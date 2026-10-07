import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { excerptForModel } from '../../../shared/ansi';
import type { WorkspaceTerminalEvent, WorkspaceTerminalProfile, WorkspaceTerminalSessionInfo } from '../../../shared/workspace-terminal-types';

interface ClientSession { info: WorkspaceTerminalSessionInfo; events: WorkspaceTerminalEvent[]; exited?: boolean; exitCode?: number }
function restoreSession(info: WorkspaceTerminalSessionInfo, events: WorkspaceTerminalEvent[]): ClientSession {
  const ended = [...events].reverse().find(event => event.type === 'exit');
  const snapshot = ended ? { ...info, exited: true, exitCode: ended.exitCode, closeError: ended.closeError || info.closeError } : info;
  return { info: snapshot, events, exited: snapshot.exited, exitCode: snapshot.exitCode };
}
// A panel can remount while IPC startup is still returning. Join that operation
// across component instances so old cleanup cannot close a newly recovered tab.
const pendingCreations = new WeakMap<object, Promise<void>>();
function boundedEvents(events: WorkspaceTerminalEvent[]): WorkspaceTerminalEvent[] {
  let chars = 0; let start = events.length;
  while (start > 0 && events.length - start < 512 && chars + (events[start - 1].data?.length || 0) <= 256 * 1024) { start--; chars += events[start].data?.length || 0; }
  return events.slice(start);
}
function TerminalPane({ session, visible, focusRequest, onError }: { session: ClientSession; visible: boolean; focusRequest: number; onError: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const emulator = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const seen = useRef(session.info.seq);
  const focusedRequest = useRef(0);
  const api = (window as any).electron;
  useEffect(() => {
    if (!host.current) return;
    let alive = true;
    // Passive, finite geometry only. The failure fixture reads this snapshot;
    // none of these fields grants IPC authority or proves native console size.
    let fitCount = 0, resizeSequence = 0;
    const observation: Record<string, number | string> = {};
    const observe = (fields: Record<string, number | string>) => {
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value === 'string') observation[key] = value;
        else if (Number.isFinite(value) && value >= 0 && value <= 1_000_000) observation[key] = Math.floor(value);
      }
      if (alive && host.current) host.current.dataset.terminalFit = JSON.stringify(observation);
    };
    const report = (error: unknown, fallback: string) => { if (alive) onError(error instanceof Error ? error.message : fallback); };
    const terminal = new Terminal({ cursorBlink: true, scrollback: 5000, fontFamily: 'Consolas, monospace', fontSize: 13 });
    const addon = new FitAddon(); terminal.loadAddon(addon); terminal.open(host.current);
    emulator.current = terminal; fit.current = addon; terminal.write(session.info.output);
    const input = terminal.onData(data => { void Promise.resolve(api?.workspaceTerminalWrite?.({ sessionId: session.info.sessionId, data })).then((r: any) => { if (alive && !r?.success) onError(r?.error || 'Terminal input failed.'); }).catch(e => report(e, 'Terminal input failed.')); });
    const size = terminal.onResize(({ cols, rows }) => {
      const sequence = ++resizeSequence;
      observe({ emulatorCols: terminal.cols, emulatorRows: terminal.rows, requestCols: cols, requestRows: rows, resizeSequence: sequence,
        requestOutcome: cols >= 20 && rows >= 5 ? 'pending' : 'below-minimum' });
      if (cols >= 20 && rows >= 5) void Promise.resolve(api?.workspaceTerminalResize?.({ sessionId: session.info.sessionId, cols, rows })).then((r: any) => {
        if (alive && sequence === resizeSequence) observe({ requestOutcome: r?.success ? 'success' : 'rejected' });
        if (alive && !r?.success) onError(r?.error || 'Terminal resize failed.');
      }).catch(e => { if (alive && sequence === resizeSequence) observe({ requestOutcome: 'transport-error' }); report(e, 'Terminal resize failed.'); });
    });
    const fitTerminal = () => {
      const bounds = host.current?.getBoundingClientRect();
      if (!bounds?.width) { observe({ fitOutcome: 'hidden' }); return; }
      fitCount = Math.min(1_000_000, fitCount + 1);
      try {
        addon.fit();
        observe({ fitCount, fitOutcome: 'returned', hostWidth: bounds.width, hostHeight: bounds.height, emulatorCols: terminal.cols, emulatorRows: terminal.rows });
      } catch { observe({ fitCount, fitOutcome: 'threw', hostWidth: bounds.width, hostHeight: bounds.height }); /* next resize */ }
    };
    const resize = new ResizeObserver(fitTerminal);
    resize.observe(host.current);
    return () => { alive = false; resize.disconnect(); input.dispose(); size.dispose(); terminal.dispose(); emulator.current = null; fit.current = null; };
  // Each PTY owns one emulator; hiding tabs does not destroy it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.info.sessionId]);
  useEffect(() => { for (const event of session.events) { if (event.seq <= seen.current) continue; seen.current = event.seq; emulator.current?.write(event.type === 'data' ? event.data || '' : `\r\n[Shell exited: ${event.exitCode ?? 'unknown'}]\r\n`); } }, [session.events]);
  useEffect(() => {
    if (!visible) return;
    try { fit.current?.fit(); } catch { /* next resize */ }
    // Automatic bootstrap and visibility changes must preserve the user's focus.
    if (focusRequest > focusedRequest.current) {
      focusedRequest.current = focusRequest;
      emulator.current?.focus();
    }
  }, [visible, focusRequest]);
  return <div ref={host} role="region" aria-label={`Interactive ${session.info.profileId} terminal`} style={{ display: visible ? 'block' : 'none', flex: 1, minHeight: 0, padding: 4, overflow: 'hidden' }} />;
}

export default function WorkspaceTerminalPanel({ projectPath, onClose, onSendToChat, onUseCommandTerminal }: { projectPath: string; onClose: () => void; onSendToChat?: (text: string) => void; onUseCommandTerminal?: () => void }) {
  const [profiles, setProfiles] = useState<WorkspaceTerminalProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [active, setActive] = useState('');
  const [focusRequest, setFocusRequest] = useState({ sessionId: '', sequence: 0 });
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [profilesFailed, setProfilesFailed] = useState(false);
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions;
  const pending = useRef(new Map<string, WorkspaceTerminalEvent[]>());
  const alive = useRef(true);
  const creation = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const api = (window as any).electron;
  const create = useCallback((profile?: string, requestFocus = true): Promise<void> => {
    const pendingCreation = creation.current || (api && pendingCreations.get(api));
    if (pendingCreation) return pendingCreation;
    const startedGeneration = generation.current;
    setCreating(true); setError('');
    const job = (async () => {
    try {
      const result = await api?.workspaceTerminalCreate?.({ projectDir: projectPath, profileId: profile || profileId || undefined, cols: 100, rows: 30 });
      if (!result?.success || !result.session) throw new Error(result?.error || 'Interactive terminal is unavailable in this build.');
      if (!alive.current || startedGeneration !== generation.current) { await api?.workspaceTerminalClose?.({ sessionId: result.session.sessionId }); return; }
      const info = result.session as WorkspaceTerminalSessionInfo;
      const events = (pending.current.get(info.sessionId) || []).filter(e => e.seq > info.seq); pending.current.delete(info.sessionId);
      const next = restoreSession(info, events);
      sessionsRef.current = [...sessionsRef.current, next]; setSessions(sessionsRef.current); setActive(info.sessionId);
      if (next.info.closeError) setError(next.info.closeError);
      if (requestFocus) setFocusRequest(prev => ({ sessionId: info.sessionId, sequence: prev.sequence + 1 }));
    } catch (e: any) { if (alive.current && startedGeneration === generation.current) setError(e?.message || 'Could not open an interactive terminal.'); }
    finally { if (alive.current && startedGeneration === generation.current) setCreating(false); }
    })();
    creation.current = job;
    if (api) pendingCreations.set(api, job);
    const release = () => {
      if (creation.current === job) creation.current = null;
      if (api && pendingCreations.get(api) === job) pendingCreations.delete(api);
    };
    void job.then(release, release);
    return job;
  }, [api, projectPath, profileId]);
  const loadProfiles = useCallback(async () => {
    const startedGeneration = generation.current;
    try {
      const result = await api?.workspaceTerminalProfiles?.();
      if (!alive.current || startedGeneration !== generation.current) return;
      if (!result?.success) throw new Error(result?.error || 'No shell profiles are available.');
      setProfiles(result.profiles || []); setProfileId(result.profiles?.[0]?.id || ''); setProfilesFailed(false);
      setError(sessionsRef.current.find(session => session.info.closeError)?.info.closeError || '');
      if (!sessionsRef.current.length) void create(result.profiles?.[0]?.id, false);
    } catch (error: unknown) {
      if (alive.current && startedGeneration === generation.current) { setProfilesFailed(true); setError(error instanceof Error ? error.message : 'Could not load shell profiles.'); }
    }
  }, [api, create]);
  useEffect(() => {
    alive.current = true;
    generation.current++;
    let cancelled = false;
    sessionsRef.current = []; setSessions([]); setActive(''); setCreating(false); setRecovering(true); setRecoveryFailed(false); setProfilesFailed(false); setError('');
    const off = api?.onWorkspaceTerminalEvent?.((event: WorkspaceTerminalEvent) => {
      if (!sessionsRef.current.some(s => s.info.sessionId === event.sessionId)) {
        if (!pending.current.has(event.sessionId) && pending.current.size >= 8) return;
        pending.current.set(event.sessionId, boundedEvents([...(pending.current.get(event.sessionId) || []), event])); return;
      }
      setSessions(prev => { const next = prev.map(s => s.info.sessionId === event.sessionId ? restoreSession(s.info, boundedEvents([...s.events, event])) : s); sessionsRef.current = next; return next; });
      if (event.type === 'exit' && event.closeError) setError(event.closeError);
    });
    void (async () => {
      // A late shell belongs to its original project. Join its cleanup before
      // snapshotting this generation or starting this project's bootstrap.
      await (creation.current || (api && pendingCreations.get(api)));
      if (cancelled) return;
      const recovered = api?.workspaceTerminalList ? await api.workspaceTerminalList({ projectDir: projectPath }) : { success: true, sessions: [] };
      if (cancelled) return;
      if (!recovered?.success) { setRecoveryFailed(true); throw new Error(recovered?.error || 'Could not recover retained terminals. Retry before opening another shell.'); }
      const restored: ClientSession[] = (recovered.sessions || []).map((info: WorkspaceTerminalSessionInfo) => {
        const events = (pending.current.get(info.sessionId) || []).filter(event => event.seq > info.seq);
        pending.current.delete(info.sessionId);
        return restoreSession(info, events);
      });
      sessionsRef.current = restored; setSessions(restored); setActive(restored[0]?.info.sessionId || '');
      const retainedError = restored.find(session => session.info.closeError)?.info.closeError;
      if (retainedError) setError(retainedError);
      await loadProfiles();
    })().catch((e: unknown) => { if (!cancelled) { setRecoveryFailed(true); setError(e instanceof Error ? e.message : 'Could not recover terminal sessions.'); } })
      .finally(() => { if (!cancelled) setRecovering(false); });
    return () => {
      cancelled = true; alive.current = false; off?.();
      for (const session of sessionsRef.current) {
        try { void Promise.resolve(api?.workspaceTerminalClose?.({ sessionId: session.info.sessionId })).catch(() => { /* Main retains failed sessions for recovery on reopen. */ }); }
        catch { /* A disconnected bridge also leaves the main-owned session recoverable. */ }
      }
    };
  // Main retains failed cleanup attempts across panel and project remounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectPath, recoveryAttempt]);
  const closeSession = async (id: string) => {
    const startedGeneration = generation.current;
    try {
    const result = await api?.workspaceTerminalClose?.({ sessionId: id });
    if (!alive.current || startedGeneration !== generation.current) return;
    if (!result?.success) { setError(result?.error || 'Could not close that terminal.'); return; }
    const next = sessionsRef.current.filter(s => s.info.sessionId !== id); sessionsRef.current = next; setSessions(next); setActive(next[0]?.info.sessionId || '');
    setError(next.find(session => session.info.closeError)?.info.closeError || '');
    } catch (e: unknown) { if (alive.current && startedGeneration === generation.current) setError(e instanceof Error ? e.message : 'Could not close that terminal.'); }
  };
  const interrupt = async () => { try { const r = await api?.workspaceTerminalInterrupt?.({ sessionId: active }); if (alive.current && !r?.success) setError(r?.error || 'Interrupt failed.'); } catch (e: unknown) { if (alive.current) setError(e instanceof Error ? e.message : 'Interrupt failed.'); } };
  const current = sessions.find(s => s.info.sessionId === active);
  return <section className="terminal-panel" aria-label="Interactive terminal" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    <header style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: 4 }}>
      <strong>Terminal</strong><select aria-label="Shell profile" value={profileId} onChange={e => setProfileId(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      <button onClick={() => { void create(); }} disabled={recovering || recoveryFailed || profilesFailed || creating || sessions.length >= 4 || !profileId}>{creating ? 'Opening…' : 'New terminal'}</button>
      {recoveryFailed && <button onClick={() => setRecoveryAttempt(value => value + 1)}>Retry terminal recovery</button>}
      {profilesFailed && <button onClick={() => { void loadProfiles(); }}>Retry shell profiles</button>}
      <button disabled={!current || current.exited} onClick={() => { void interrupt(); }}>Interrupt (Ctrl+C)</button>
      {onSendToChat && <button disabled={!current} onClick={() => { if (current) onSendToChat(excerptForModel(current.info.output + current.events.map(e => e.data || '').join(''), { maxLines: 100, maxChars: 20000 })); }}>Attach output to assistant</button>}
      <button aria-label="Close terminal panel" onClick={onClose}>Close panel</button>
      {onUseCommandTerminal && <button onClick={onUseCommandTerminal}>Use command terminal (no interactive stdin)</button>}
    </header>
    <div role="tablist" aria-label="Terminal sessions" style={{ display: 'flex', gap: 6, padding: 4 }}>{sessions.map((s, index) => <div key={s.info.sessionId}><button role="tab" aria-selected={active === s.info.sessionId} onClick={() => { setActive(s.info.sessionId); setFocusRequest(prev => ({ sessionId: s.info.sessionId, sequence: prev.sequence + 1 })); }}>{index + 1}: {s.info.profileId}{s.exited ? ' (exited)' : ''}</button><button aria-label={`Close terminal ${index + 1}`} onClick={() => { void closeSession(s.info.sessionId); }}>×</button></div>)}</div>
    {error && <p role="alert">{error}</p>}{recovering && <p>Recovering terminal sessions…</p>}{!sessions.length && !creating && !recovering && !recoveryFailed && <p>No terminal open. Choose a shell and select New terminal.</p>}
    {sessions.map(s => <TerminalPane key={s.info.sessionId} session={s} visible={s.info.sessionId === active} focusRequest={focusRequest.sessionId === s.info.sessionId ? focusRequest.sequence : 0} onError={setError} />)}
  </section>;
}
