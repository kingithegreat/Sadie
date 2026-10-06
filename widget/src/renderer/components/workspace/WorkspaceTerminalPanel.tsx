import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { excerptForModel } from '../../../shared/ansi';
import type { WorkspaceTerminalEvent, WorkspaceTerminalProfile, WorkspaceTerminalSessionInfo } from '../../../shared/workspace-terminal-types';

interface ClientSession { info: WorkspaceTerminalSessionInfo; events: WorkspaceTerminalEvent[]; exited?: boolean; exitCode?: number }
function boundedEvents(events: WorkspaceTerminalEvent[]): WorkspaceTerminalEvent[] {
  let chars = 0; let start = events.length;
  while (start > 0 && events.length - start < 512 && chars + (events[start - 1].data?.length || 0) <= 256 * 1024) { start--; chars += events[start].data?.length || 0; }
  return events.slice(start);
}
function TerminalPane({ session, visible, onError }: { session: ClientSession; visible: boolean; onError: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const emulator = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const seen = useRef(session.info.seq);
  const api = (window as any).electron;
  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({ cursorBlink: true, scrollback: 5000, fontFamily: 'Consolas, monospace', fontSize: 13 });
    const addon = new FitAddon(); terminal.loadAddon(addon); terminal.open(host.current);
    emulator.current = terminal; fit.current = addon; terminal.write(session.info.output);
    const input = terminal.onData(data => { void api?.workspaceTerminalWrite?.({ sessionId: session.info.sessionId, data }).then((r: any) => { if (!r?.success) onError(r?.error || 'Terminal input failed.'); }); });
    const size = terminal.onResize(({ cols, rows }) => { if (cols >= 20 && rows >= 5) void api?.workspaceTerminalResize?.({ sessionId: session.info.sessionId, cols, rows }); });
    const resize = new ResizeObserver(() => { if (host.current?.getBoundingClientRect().width) { try { addon.fit(); } catch { /* next resize */ } } });
    resize.observe(host.current);
    return () => { resize.disconnect(); input.dispose(); size.dispose(); terminal.dispose(); emulator.current = null; fit.current = null; };
  // Each PTY owns one emulator; hiding tabs does not destroy it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.info.sessionId]);
  useEffect(() => { for (const event of session.events) { if (event.seq <= seen.current) continue; seen.current = event.seq; emulator.current?.write(event.type === 'data' ? event.data || '' : `\r\n[Shell exited: ${event.exitCode ?? 'unknown'}]\r\n`); } }, [session.events]);
  useEffect(() => { if (visible) { try { fit.current?.fit(); } catch { /* next resize */ } emulator.current?.focus(); } }, [visible]);
  return <div ref={host} role="region" aria-label={`Interactive ${session.info.profileId} terminal`} style={{ display: visible ? 'block' : 'none', flex: 1, minHeight: 0, padding: 4, overflow: 'hidden' }} />;
}

export default function WorkspaceTerminalPanel({ projectPath, onClose, onSendToChat }: { projectPath: string; onClose: () => void; onSendToChat?: (text: string) => void }) {
  const [profiles, setProfiles] = useState<WorkspaceTerminalProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [active, setActive] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions;
  const pending = useRef(new Map<string, WorkspaceTerminalEvent[]>());
  const alive = useRef(true);
  const creation = useRef(false);
  const api = (window as any).electron;
  const create = useCallback(async (profile?: string) => {
    if (creation.current) return;
    creation.current = true; setCreating(true); setError('');
    try {
      const result = await api?.workspaceTerminalCreate?.({ projectDir: projectPath, profileId: profile || profileId || undefined, cols: 100, rows: 30 });
      if (!result?.success || !result.session) throw new Error(result?.error || 'Interactive terminal is unavailable in this build.');
      if (!alive.current) { await api?.workspaceTerminalClose?.({ sessionId: result.session.sessionId }); return; }
      const info = result.session as WorkspaceTerminalSessionInfo;
      const events = (pending.current.get(info.sessionId) || []).filter(e => e.seq > info.seq); pending.current.delete(info.sessionId);
      const next = { info, events, exited: events.some(e => e.type === 'exit') };
      sessionsRef.current = [...sessionsRef.current, next]; setSessions(sessionsRef.current); setActive(info.sessionId);
    } catch (e: any) { if (alive.current) setError(e?.message || 'Could not open an interactive terminal.'); }
    finally { creation.current = false; if (alive.current) setCreating(false); }
  }, [api, projectPath, profileId]);
  useEffect(() => {
    alive.current = true;
    const off = api?.onWorkspaceTerminalEvent?.((event: WorkspaceTerminalEvent) => {
      if (!sessionsRef.current.some(s => s.info.sessionId === event.sessionId)) {
        if (!pending.current.has(event.sessionId) && pending.current.size >= 8) return;
        pending.current.set(event.sessionId, boundedEvents([...(pending.current.get(event.sessionId) || []), event])); return;
      }
      setSessions(prev => { const next = prev.map(s => s.info.sessionId === event.sessionId ? { ...s, events: boundedEvents([...s.events, event]), ...(event.type === 'exit' ? { exited: true, exitCode: event.exitCode } : {}) } : s); sessionsRef.current = next; return next; });
    });
    void api?.workspaceTerminalProfiles?.().then((result: any) => {
      if (!alive.current) return;
      if (!result?.success) { setError(result?.error || 'No shell profiles are available.'); return; }
      setProfiles(result.profiles || []); setProfileId(result.profiles?.[0]?.id || ''); void create(result.profiles?.[0]?.id);
    });
    return () => { alive.current = false; off?.(); for (const session of sessionsRef.current) void api?.workspaceTerminalClose?.({ sessionId: session.info.sessionId }); };
  // Project remount starts a fresh shell; user-entered cd stays in that shell.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectPath]);
  const closeSession = async (id: string) => {
    const result = await api?.workspaceTerminalClose?.({ sessionId: id });
    if (!result?.success) { setError(result?.error || 'Could not close that terminal.'); return; }
    const next = sessionsRef.current.filter(s => s.info.sessionId !== id); sessionsRef.current = next; setSessions(next); setActive(next[0]?.info.sessionId || '');
  };
  const current = sessions.find(s => s.info.sessionId === active);
  return <section className="terminal-panel" aria-label="Interactive terminal" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    <header style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: 4 }}>
      <strong>Terminal</strong><select aria-label="Shell profile" value={profileId} onChange={e => setProfileId(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      <button onClick={() => { void create(); }} disabled={creating || sessions.length >= 4 || !profileId}>{creating ? 'Opening…' : 'New terminal'}</button>
      <button disabled={!current || current.exited} onClick={() => { void api?.workspaceTerminalInterrupt?.({ sessionId: active }).then((r: any) => { if (!r?.success) setError(r?.error || 'Interrupt failed.'); }); }}>Interrupt (Ctrl+C)</button>
      {onSendToChat && <button disabled={!current} onClick={() => { if (current) onSendToChat(excerptForModel(current.info.output + current.events.map(e => e.data || '').join(''), { maxLines: 100, maxChars: 20000 })); }}>Attach output to assistant</button>}
      <button aria-label="Close terminal panel" onClick={onClose}>Close panel</button>
    </header>
    <div role="tablist" aria-label="Terminal sessions" style={{ display: 'flex', gap: 6, padding: 4 }}>{sessions.map((s, index) => <div key={s.info.sessionId}><button role="tab" aria-selected={active === s.info.sessionId} onClick={() => setActive(s.info.sessionId)}>{index + 1}: {s.info.profileId}{s.exited ? ' (exited)' : ''}</button><button aria-label={`Close terminal ${index + 1}`} onClick={() => { void closeSession(s.info.sessionId); }}>×</button></div>)}</div>
    {error && <p role="alert">{error}</p>}{!sessions.length && !creating && <p>No terminal open. Choose a shell and select New terminal.</p>}
    {sessions.map(s => <TerminalPane key={s.info.sessionId} session={s} visible={s.info.sessionId === active} onError={setError} />)}
  </section>;
}
