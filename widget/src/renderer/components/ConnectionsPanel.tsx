import React, { useState, useEffect } from 'react';
import '../styles/connections-panel.css';
import {
  CONNECTIONS,
  buildServerConfig,
  describeCost,
  findConnection,
  type ConnectionEntry,
} from '../../shared/connections-catalogue';

interface ConnectionsPanelProps {
  /**
   * Context handed over when the assistant sent the user here with
   * navigate_to_mode. `service` pre-opens that connection's card — "connect
   * my Notion" should land on Notion's form, not a wall of collapsed cards.
   */
  navContext?: Record<string, unknown> | null;
}

/**
 * Connections — the front door to outside services.
 *
 * One card per curated service, details pre-filled, saying what it reaches
 * and what it costs BEFORE connecting. Everything added here goes through the
 * same mcpAddServer IPC as the hand-entry form in Settings → Permissions
 * (which stays underneath for anything not on this list); this panel invents
 * no second storage format and no second permission path.
 */
export const ConnectionsPanel: React.FC<ConnectionsPanelProps> = ({ navContext }) => {
  const [configuredNames, setConfiguredNames] = useState<ReadonlySet<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(
    () => findConnection(navContext?.service)?.id ?? null,
  );
  // Key values per entry id — held in memory only, sent once with Connect.
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const loadServers = async () => {
    try {
      const servers = await (window as any).electron?.mcpListServers?.();
      if (Array.isArray(servers)) {
        setConfiguredNames(new Set(servers.map((s: any) => String(s?.name ?? ''))));
      }
    } catch { /* IPC not ready yet — cards simply show as not connected */ }
  };

  useEffect(() => { loadServers(); }, []);

  const setValue = (entryId: string, key: string, v: string) => {
    setValues((prev) => ({ ...prev, [entryId]: { ...(prev[entryId] ?? {}), [key]: v } }));
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
      await loadServers();
      setValues((prev) => ({ ...prev, [entry.id]: {} }));
      setExpandedId(null);
      if (res?.connected) {
        // The server started and its tools are bridged RIGHT NOW — say so,
        // with the count, so "connected" is a fact and not a hope.
        const noun = res.toolCount === 1 ? '1 tool is' : `${res.toolCount ?? 0} tools are`;
        setNotice({
          text: `${entry.name} connected — ${noun} live now and will ask permission before acting.`,
          error: false,
        });
      } else if (res?.error) {
        // Saved but did not start. Say what happened and what happens next;
        // a silent failure here would read as broken, not pending.
        setNotice({
          text: `${entry.name} was saved, but did not start just now: ${res.error}. HomeBot will try again when it next starts.`,
          error: true,
        });
      } else {
        setNotice({
          text: `${entry.name} saved. Restart HomeBot to bring it live — its tools then ask permission before acting.`,
          error: false,
        });
      }
    } catch (e: any) {
      setNotice({ text: `Could not save ${entry.name}: ${e?.message || e}`, error: true });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="connections-panel">
      <h2 className="connections-title">Connections</h2>
      <p className="connections-lede">
        Link HomeBot to services you already use. Each one says what it can reach and what it
        costs before you connect it — and everything here runs through HomeBot&apos;s own
        permissions, so its tools ask before they act.
      </p>

      {notice && (
        <div className={notice.error ? 'cnx-notice cnx-notice-error' : 'cnx-notice'} role="status">
          {notice.text}
        </div>
      )}

      <div className="cnx-list">
        {CONNECTIONS.map((entry) => {
          const connected = configuredNames.has(entry.serverName);
          const expanded = expandedId === entry.id;
          const entryValues = values[entry.id] ?? {};
          const allFilled = entry.keys.every((k) => (entryValues[k.key] ?? '').trim().length > 0);

          return (
            <div key={entry.id} className={connected ? 'cnx-card cnx-card-connected' : 'cnx-card'}>
              <button
                type="button"
                className="cnx-card-head"
                onClick={() => setExpandedId(expanded ? null : entry.id)}
                aria-expanded={expanded}
              >
                <span className="cnx-name">{entry.name}</span>
                <span className={`cnx-cost cnx-cost-${entry.cost}`}>{describeCost(entry)}</span>
                {connected ? (
                  <span className="cnx-connected-badge">Connected</span>
                ) : (
                  <span className="cnx-expand-hint">{expanded ? 'Hide' : 'Connect'}</span>
                )}
              </button>

              <p className="cnx-reach">{entry.reach}</p>
              {entry.costNote && <p className="cnx-cost-note">{entry.costNote}</p>}

              {expanded && !connected && (
                <div className="cnx-form">
                  {entry.keys.map((k) => (
                    <label key={k.key} className="cnx-key-row">
                      <span className="cnx-key-label">{k.label}</span>
                      <input
                        className="setting-input"
                        type={k.secret ? 'password' : 'text'}
                        value={entryValues[k.key] ?? ''}
                        onChange={(e) => setValue(entry.id, k.key, e.target.value)}
                        autoComplete="off"
                        aria-label={k.label}
                      />
                      <a className="cnx-where" href={k.whereToGet} target="_blank" rel="noreferrer">
                        Where do I find this?
                      </a>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="button button-save cnx-connect-btn"
                    disabled={!allFilled || busyId === entry.id}
                    onClick={() => connect(entry)}
                  >
                    {busyId === entry.id ? 'Connecting…' : 'Connect'}
                  </button>
                  {!allFilled && entry.keys.length > 0 && (
                    <small className="cnx-form-hint">Fill in the fields above to enable Connect.</small>
                  )}
                </div>
              )}

              {expanded && connected && (
                <p className="cnx-manage-hint">
                  Already connected. Enable, disable or remove it in Settings → Permissions → MCP Servers.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="cnx-boundary">
        HomeBot mediates every connection made here — nothing arrives by inheriting another
        app&apos;s configuration. Need a service that is not listed? The hand-entry form in
        Settings → Permissions → MCP Servers can add any MCP server.
      </p>
    </div>
  );
};

export default ConnectionsPanel;
