import { useState } from 'react';
import { useSettingsCtx } from './SettingsContext';
import {
  CONNECTIONS,
  buildServerConfig,
  describeCost,
  type ConnectionEntry,
} from '../../../shared/connections-catalogue';

/**
 * Curated Connections section for Settings — accessible in Simple view.
 * Provides 1-click connectors for Google Drive & Docs, Gmail, Notion, GitHub, Slack,
 * and Memory, with status badges, enable/disable toggles, and disconnect actions.
 */
export default function ConnectionsSettingsSection() {
  const {
    openSections,
    toggleSection,
    mcpServers,
    mcpStatus,
    loadMcpServers,
  } = useSettingsCtx();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const configuredMap = new Map<string, any>();
  if (Array.isArray(mcpServers)) {
    for (const s of mcpServers) {
      if (s?.name) configuredMap.set(s.name, s);
    }
  }

  const statusMap = new Map<string, any>();
  if (Array.isArray(mcpStatus)) {
    for (const st of mcpStatus) {
      if (st?.name) statusMap.set(st.name, st);
    }
  }

  const connectedCount = CONNECTIONS.filter(c => configuredMap.has(c.serverName)).length;

  const setValue = (entryId: string, key: string, v: string) => {
    setValues(prev => ({ ...prev, [entryId]: { ...(prev[entryId] ?? {}), [key]: v } }));
  };

  const connect = async (entry: ConnectionEntry) => {
    setBusyId(entry.id);
    setNotice(null);
    try {
      const built = buildServerConfig(entry, values[entry.id] ?? {});
      if (!built.ok) {
        setNotice({ text: built.error, error: true });
        return;
      }
      const res = await (window as any).electron?.mcpAddServer?.(built.config);
      await loadMcpServers();
      setValues(prev => ({ ...prev, [entry.id]: {} }));
      setExpandedId(null);
      if (res?.connected) {
        const noun = res.toolCount === 1 ? '1 tool is' : `${res.toolCount ?? 0} tools are`;
        setNotice({
          text: `${entry.name} connected — ${noun} live now.`,
          error: false,
        });
      } else if (res?.error) {
        setNotice({
          text: `${entry.name} was saved, but failed to start: ${res.error}`,
          error: true,
        });
      } else {
        setNotice({
          text: `${entry.name} saved. Restart HomeBot to activate.`,
          error: false,
        });
      }
    } catch (e: any) {
      setNotice({ text: `Could not save ${entry.name}: ${e?.message || e}`, error: true });
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (entry: ConnectionEntry) => {
    if (typeof window.confirm === 'function' && !window.confirm(`Disconnect ${entry.name}? HomeBot will remove this server.`)) return;
    setBusyId(entry.id);
    setNotice(null);
    try {
      await (window as any).electron?.mcpRemoveServer?.(entry.serverName);
      await loadMcpServers();
      setNotice({ text: `${entry.name} disconnected.`, error: false });
    } catch (e: any) {
      setNotice({ text: `Could not disconnect ${entry.name}: ${e?.message || e}`, error: true });
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (entry: ConnectionEntry, enabled: boolean) => {
    setBusyId(entry.id);
    setNotice(null);
    try {
      await (window as any).electron?.mcpToggleServer?.(entry.serverName, enabled);
      await loadMcpServers();
      setNotice({ text: `${entry.name} ${enabled ? 'enabled' : 'disabled'}.`, error: false });
    } catch (e: any) {
      setNotice({ text: `Failed to update ${entry.name}: ${e?.message || e}`, error: true });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`sp-section-toggle${openSections.connections ? ' open' : ''}`}
        onClick={() => toggleSection('connections')}
        aria-expanded={Boolean(openSections.connections)}
      >
        <span className="sp-section-arrow">{openSections.connections ? '▾' : '▸'}</span>
        <span>🔌 Connected Services</span>
        {connectedCount > 0 && (
          <span className="sp-section-badge" style={{ marginLeft: 'auto', fontSize: '0.78rem', background: 'rgba(34, 197, 94, 0.18)', color: '#22c55e', padding: '1px 8px', borderRadius: 10 }}>
            {connectedCount} connected
          </span>
        )}
      </button>

      {openSections.connections && (
        <div className="sp-connections-section" style={{ marginBottom: 16 }}>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: '4px 0 12px', lineHeight: 1.4 }}>
            Connect outside tools and services you already use. Each connector states what it can reach and what it costs before you connect — and tools always ask permission before acting.
          </p>

          {notice && (
            <div
              className={notice.error ? 'cnx-notice cnx-notice-error' : 'cnx-notice'}
              style={{ padding: '6px 10px', fontSize: '0.82rem', marginBottom: 10, borderRadius: 6 }}
              role="status"
            >
              {notice.text}
            </div>
          )}

          <div className="sp-connections-grid" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CONNECTIONS.map((entry) => {
              const configured = configuredMap.get(entry.serverName);
              const connected = Boolean(configured);
              const isEnabled = configured?.enabled !== false;
              const liveStatus = statusMap.get(entry.serverName);
              const expanded = expandedId === entry.id;
              const entryValues = values[entry.id] ?? {};
              const allFilled = entry.keys.every((k) => (entryValues[k.key] ?? '').trim().length > 0);

              return (
                <div
                  key={entry.id}
                  className={`sp-connection-card ${connected ? 'sp-connection-card--connected' : ''}`}
                  style={{
                    background: 'var(--bg-medium)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    borderLeft: connected ? (isEnabled ? '3px solid #22c55e' : '3px solid #eab308') : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.92rem' }}>{entry.name}</strong>
                      <span className={`cnx-cost cnx-cost-${entry.cost}`}>{describeCost(entry)}</span>
                      {connected && (
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isEnabled ? '#22c55e' : '#eab308' }}>
                          {isEnabled ? (liveStatus?.connected ? `Connected (${liveStatus.toolCount ?? 0} tools)` : 'Connected') : 'Disabled'}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {connected ? (
                        <>
                          <button
                            type="button"
                            className="button button-secondary"
                            style={{ fontSize: '0.76rem', padding: '3px 8px' }}
                            disabled={busyId === entry.id}
                            onClick={() => toggle(entry, !isEnabled)}
                          >
                            {isEnabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            className="button button-danger"
                            style={{ fontSize: '0.76rem', padding: '3px 8px' }}
                            disabled={busyId === entry.id}
                            onClick={() => disconnect(entry)}
                          >
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="button button-secondary"
                          style={{ fontSize: '0.76rem', padding: '3px 10px' }}
                          onClick={() => setExpandedId(expanded ? null : entry.id)}
                          aria-expanded={expanded}
                        >
                          {expanded ? 'Cancel' : 'Connect'}
                        </button>
                      )}
                    </div>
                  </div>

                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.35 }}>
                    {entry.reach}
                  </p>

                  {expanded && !connected && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))' }}>
                      {entry.keys.map((k) => (
                        <label key={k.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{k.label}</span>
                          <input
                            className="setting-input"
                            type={k.secret ? 'password' : 'text'}
                            value={entryValues[k.key] ?? ''}
                            onChange={(e) => setValue(entry.id, k.key, e.target.value)}
                            autoComplete="off"
                            aria-label={k.label}
                            style={{ fontSize: '0.82rem', padding: '5px 8px' }}
                          />
                          <a href={k.whereToGet} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', color: '#60a5fa' }}>
                            Where do I find this?
                          </a>
                        </label>
                      ))}
                      <button
                        type="button"
                        className="button button-save"
                        style={{ alignSelf: 'flex-start', marginTop: 4, fontSize: '0.78rem', padding: '4px 12px' }}
                        disabled={!allFilled || busyId === entry.id}
                        onClick={() => connect(entry)}
                      >
                        {busyId === entry.id ? 'Connecting…' : 'Save & Connect'}
                      </button>
                      {!allFilled && entry.keys.length > 0 && (
                        <small style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Fill in the fields above to enable Connect.
                        </small>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
