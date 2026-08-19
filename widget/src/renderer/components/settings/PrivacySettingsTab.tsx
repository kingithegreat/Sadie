/**
 * What HomeBot may do and what leaves this PC: per-tool permissions, telemetry and history.
 *
 * Moved verbatim out of SettingsPanel.tsx; the controls and their bindings are
 * unchanged. State comes from useSettingsCtx().
 */

import { useSettingsCtx } from './SettingsContext';
import { isGateBlocked } from '../../../shared/upgrade';
import SkillsSection from '../SkillsSection';
import TelemetryConsentModal from '../TelemetryConsentModal';
import TelemetryDashboard from '../TelemetryDashboard';
import PermissionHistory from '../PermissionHistory';
import TrustPanel from '../TrustPanel';

export default function PrivacySettingsTab() {
  const {
    confirmDestructive,
    localSettings,
    setLocalSettings,
    uncensoredMode,
    permissions,
    setPermissions,
    showTelemetryModal,
    setShowTelemetryModal,
    openSections,
    toggleSection,
    PERMISSION_DESCRIPTIONS,
    DANGEROUS_PERMISSIONS,
    showTelemetryDashboard,
    setShowTelemetryDashboard,
    showPermissionHistory,
    setShowPermissionHistory,
    showTrustPanel,
    setShowTrustPanel,
    setUpgradePrompt,
    scheduledJobs,
    showJobForm,
    setShowJobForm,
    jobForm,
    setJobForm,
    loadJobs,
    mcpServers,
    mcpStatus,
    showMcpForm,
    setShowMcpForm,
    mcpForm,
    setMcpForm,
    refreshTelemetryLog,
    telemetryLogPreview,
    loadMcpServers,
    handleUncensoredToggle,
  } = useSettingsCtx();

  return (
    <>
        {/* ── Permissions & Advanced ── */}
        <button type="button" className={`sp-section-toggle${openSections.permissions ? ' open' : ''}`} onClick={() => toggleSection('permissions')}>
          <span className="sp-section-arrow">{openSections.permissions ? '▾' : '▸'}</span> Permissions &amp; Advanced
        </button>
        {openSections.permissions && <>
        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={!!(localSettings as any).batchPreviewEnabled}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  batchPreviewEnabled: e.target.checked
                } as any)
              }
            />
            <span>Preview tool batches before they run</span>
          </label>
          <small className="setting-hint">
            When on, HomeBot lists exactly what a batch of actions is about to do (tool names and key arguments) in the chat before executing it.
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Widget Hotkey (read-only)</label>
          <input
            type="text"
            className="setting-input"
            aria-label="Widget hotkey"
            value={localSettings.widgetHotkey}
            readOnly
            disabled
          />
          <small className="setting-hint">
            Hotkey configuration requires restart
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={uncensoredMode}
              onChange={(e) => handleUncensoredToggle(e.target.checked)}
            />
            <span>🔓 Uncensored Mode</span>
          </label>
          <small className={`setting-hint${uncensoredMode ? ' sp-hint-warning' : ''}`}>
            {uncensoredMode
              ? `Using ${(localSettings as any).uncensoredModel || 'dolphin-mistral:7b'} — No content filters`
              : 'Using standard model with safety filters'}
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={true}
              disabled
            />
            <span>🛡️ Telemetry (anonymous, opt-in)</span>
          </label>
          <small className="setting-hint sp-hint-block">
            Tool usage events are logged <strong>locally on this device only</strong>. Nothing is sent to an external server.
            Consent is recorded with a timestamp and can be reviewed or revoked in the Telemetry Consent Log below.
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Permissions</label>
          <small className="setting-hint">Enable or disable specific tools.</small>
          <div className="permission-grid">
            {Object.keys(permissions).map((k) => {
              const isDangerous = DANGEROUS_PERMISSIONS.has(k);
              return (
                <div key={k} className="perm-row">
                  <label
                    className="setting-label"
                    title={isDangerous ? `⚠ Dangerous — ${PERMISSION_DESCRIPTIONS[k] || k}` : (PERMISSION_DESCRIPTIONS[k] || k)}
                  >
                    <input
                      type="checkbox"
                      checked={!!permissions[k]}
                      onChange={(e) => {
                        const next = { ...permissions, [k]: e.target.checked };
                        setPermissions(next);
                        setLocalSettings({ ...localSettings, permissions: next } as any);
                      }}
                    />
                    <span style={{ marginLeft: 8 }}>
                      {isDangerous && <span className="sp-warn-icon">⚠</span>}
                      {k.replace(/_/g, ' ')}
                    </span>
                  </label>
                  <div>
                    <small className={isDangerous ? 'sp-perm-danger' : 'setting-hint'}>
                      {PERMISSION_DESCRIPTIONS[k] || 'No description available.'}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="setting-group">
          <button
            className="button button-secondary"
            // Discards every permission the user has granted, immediately, on
            // one click. "Reset to defaults" sounds tidy and reversible; it is
            // neither — anything granted via "Always allow" has to be granted
            // again, one prompt at a time, as HomeBot next needs it.
            onClick={() => confirmDestructive({
              title: 'Undo every permission you have given HomeBot?',
              body: (
                <p>
                  HomeBot goes back to asking before it does anything —
                  {' '}<strong>including things you already said yes to</strong>. Nothing is
                  deleted, but you will be asked again as each one comes up.
                </p>
              ),
              confirmLabel: 'Reset them',
              onConfirm: async () => {
                const result = await (window as any).electron.resetPermissions();
                if (result) {
                  const newPerms = (result as any).permissions || {};
                  setPermissions(newPerms);
                  setLocalSettings({ ...localSettings, permissions: newPerms } as any);
                }
              },
            })}
          >
            Reset permissions to defaults
          </button>
        </div>
        <div className="setting-group">
          <label className="setting-label">Telemetry consent</label>
          <div className="perm-row">
            <div className="setting-hint">{localSettings.telemetryConsentTimestamp ? `Consented: ${localSettings.telemetryConsentTimestamp} (v${localSettings.telemetryConsentVersion || '1.0'})` : 'No consent on record'}</div>
            <button className="button button-secondary" onClick={async () => {
              const r = await (window as any).electron.exportTelemetryConsent();
              if (r && r.success) {
                alert(`Consent exported to ${r.path}`);
              } else {
                alert(`Failed to export consent: ${r?.error}`);
              }
            }}>
              Export consent JSON
            </button>
          </div>
        </div>

        <div className="setting-group">
          <label className="setting-label">Telemetry Consent Log</label>
          <div className="flex items-center gap-2 mb-2">
            <button className="button button-secondary" onClick={async () => {
              await refreshTelemetryLog();
            }}>Refresh</button>
            <button className="button button-secondary" onClick={async () => {
              const r = await (window as any).electron.exportTelemetryConsent();
              if (r && r.success) alert(`Exported to ${r.path}`);
              else alert(`Export failed: ${r?.error}`);
            }}>Export</button>
            <button className="button button-secondary" onClick={() => setShowTelemetryDashboard(true)}>Open Telemetry Dashboard</button>
          </div>
          <div className="sp-telemetry-log">
            <pre className="sp-telemetry-pre">{telemetryLogPreview()}</pre>
          </div>
        </div>

        <div className="setting-group">
          <label className="setting-label">Activity &amp; Health</label>
          <p className="setting-hint">See live health of the services HomeBot depends on, and every change it has made to your CRM — with field-level before/after detail.</p>
          <div className="flex items-center gap-2 mb-2">
            <button className="button button-secondary" onClick={() => setShowTrustPanel(true)}>Open Activity &amp; Health</button>
          </div>
        </div>

        <div className="setting-group">
          <label className="setting-label">Permission History</label>
          <p className="setting-hint">Review every permission HomeBot has requested and how you responded.</p>
          <div className="flex items-center gap-2 mb-2">
            <button className="button button-secondary" onClick={() => setShowPermissionHistory(true)}>Open Permission History</button>
          </div>
          <label className="setting-label" htmlFor="perm-timeout">Permission prompt timeout (seconds)</label>
          <p className="setting-hint">How long a permission prompt waits before auto-declining. Range 5–600s.</p>
          <input
            id="perm-timeout"
            type="number"
            min={5}
            max={600}
            className="input"
            value={Math.round(((localSettings as any).permissionPromptTimeoutMs ?? 60000) / 1000)}
            onChange={(e) => {
              const secs = Math.min(600, Math.max(5, Number(e.target.value) || 60));
              setLocalSettings({ ...localSettings, permissionPromptTimeoutMs: secs * 1000 } as any);
            }}
          />
        </div>
        </>}
        <TelemetryConsentModal
          open={showTelemetryModal}
          onAccept={async () => {
            // Persist immediately so telemetry consent is logged
            const updated = await (window as any).electron.saveSettings({ ...localSettings, telemetryEnabled: true });
            setLocalSettings({ ...localSettings, telemetryEnabled: true, telemetryConsentTimestamp: updated.telemetryConsentTimestamp });
            setShowTelemetryModal(false);
          }}
          onDecline={() => {
            setShowTelemetryModal(false);
            setLocalSettings({ ...localSettings, telemetryEnabled: false });
          }}
          onClose={() => setShowTelemetryModal(false)}
        />
        {showTelemetryDashboard && <TelemetryDashboard open={showTelemetryDashboard} onClose={() => setShowTelemetryDashboard(false)} /> }
        {showPermissionHistory && <PermissionHistory open={showPermissionHistory} onClose={() => setShowPermissionHistory(false)} /> }
        {showTrustPanel && <TrustPanel open={showTrustPanel} onClose={() => setShowTrustPanel(false)} /> }

      {/* ── Scheduled Jobs ─────────────────────────────────────────────────── */}
      <div className="settings-section">
        <h3 className="settings-section-title sp-section-title">
          ⏰ Scheduled Jobs <span className="sp-pro-badge" title="Requires HomeBot Pro">⭐ PRO</span>
          <small className="sp-section-subtitle">
            — recurring messages and reminders while HomeBot is open
          </small>
        </h3>

        {scheduledJobs.length === 0 ? (
          <p className="sp-empty-hint">
            No scheduled jobs yet. Add one below.
          </p>
        ) : (
          <div className="sp-list">
            {scheduledJobs.map((job) => (
              <div
                key={job.id}
                className="sp-list-row"
              >
                <div className="sp-list-row-left">
                  <span
                    className={job.enabled ? 'sp-status-dot-on' : 'sp-status-dot-off'}
                  />
                  <span className="sp-list-name">{job.name}</span>
                  <span className="sp-list-meta">
                    {job.dailyTime ? `daily @ ${job.dailyTime}` : `every ${job.intervalMinutes} min`}
                  </span>
                </div>
                <div className="sp-list-actions">
                  <button
                    className="button button-secondary sp-btn-sm"
                    onClick={async () => {
                      await (window as any).electron?.schedulerToggle?.(job.id, !job.enabled);
                      loadJobs();
                    }}
                  >
                    {job.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    className="button button-secondary sp-btn-sm-danger"
                    onClick={async () => {
                      if (confirm(`Delete job "${job.name}"?`)) {
                        await (window as any).electron?.schedulerRemove?.(job.id);
                        loadJobs();
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showJobForm ? (
          <div className="sp-form-box">
            <div className="sp-form-col">
              <input
                className="setting-input"
                placeholder="Job name (e.g. Morning briefing)"
                value={jobForm.name}
                onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })}
              />
              <input
                className="setting-input"
                placeholder="Message to show in chat when job fires"
                value={jobForm.message}
                onChange={(e) => setJobForm({ ...jobForm, message: e.target.value })}
              />
              <div className="sp-form-row">
                <select
                  aria-label="Job frequency type"
                  className="setting-input sp-select-auto"
                  value={jobForm.mode}
                  onChange={(e) => setJobForm({ ...jobForm, mode: e.target.value as 'interval' | 'daily' })}
                >
                  <option value="interval">Every N minutes</option>
                  <option value="daily">Daily at time</option>
                </select>
                {jobForm.mode === 'interval' ? (
                  <input
                    aria-label="Job interval in minutes"
                    className="setting-input"
                    type="number"
                    min={1}
                    placeholder="Minutes (e.g. 60)"
                    value={jobForm.intervalMinutes}
                    onChange={(e) => setJobForm({ ...jobForm, intervalMinutes: Math.max(1, Number(e.target.value)) })}
                  />
                ) : (
                  <input
                    aria-label="Daily job time"
                    className="setting-input"
                    type="time"
                    value={jobForm.dailyTime}
                    onChange={(e) => setJobForm({ ...jobForm, dailyTime: e.target.value })}
                  />
                )}
              </div>
              <div className="sp-mcp-actions">
                <button
                  className="button button-save sp-btn-save-sm"
                  onClick={async () => {
                    if (!jobForm.name.trim() || !jobForm.message.trim()) return;
                    const result = await (window as any).electron?.schedulerAdd?.({
                      name: jobForm.name.trim(),
                      message: jobForm.message.trim(),
                      intervalMinutes: jobForm.intervalMinutes,
                      dailyTime: jobForm.mode === 'daily' ? jobForm.dailyTime : undefined,
                      enabled: true,
                    });
                    if (isGateBlocked(result)) {
                      setUpgradePrompt(result.upgrade);
                      return;
                    }
                    setJobForm({ name: '', message: '', mode: 'interval', intervalMinutes: 60, dailyTime: '09:00' });
                    setShowJobForm(false);
                    loadJobs();
                  }}
                >
                  Add Job
                </button>
                <button
                  className="button button-cancel sp-btn-save-sm"
                  onClick={() => setShowJobForm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            className="button button-secondary sp-add-job-btn"
            onClick={() => setShowJobForm(true)}
          >
            + Add Job
          </button>
        )}
      </div>

      {/* ── MCP Servers ───────────────────────────────────────────────────── */}
      <div className="settings-section">
        <h3 className="settings-section-title sp-section-title">
          🔌 MCP Servers
          <small className="sp-section-subtitle">
            — extend HomeBot with any Model Context Protocol server
          </small>
        </h3>

        {/* Connected server list */}
        {mcpServers.length === 0 ? (
          <p className="sp-empty-hint">
            No MCP servers configured. Add one below.
          </p>
        ) : (
          <div className="sp-list">
            {mcpServers.map((srv: any) => {
              const live = mcpStatus.find((s: any) => s.name === srv.name);
              return (
                <div
                  key={srv.name}
                  className="sp-list-row"
                >
                  <div className="sp-list-row-left">
                    <span
                      className={live ? 'sp-status-dot-on' : (srv.enabled === false ? 'sp-status-dot-off' : 'sp-status-dot-err')}
                    />
                    <span className="sp-list-name">{srv.name}</span>
                    <span className="sp-list-meta">
                      {srv.type === 'stdio' ? srv.command : srv.url}
                    </span>
                    {live && (
                      <span className="sp-mcp-tools">
                        {live.toolCount} tool{live.toolCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="sp-list-actions">
                    <button
                      className="button button-secondary sp-btn-sm"
                      onClick={async () => {
                        await (window as any).electron?.mcpToggleServer?.(srv.name, srv.enabled === false);
                        loadMcpServers();
                      }}
                    >
                      {srv.enabled === false ? 'Enable' : 'Disable'}
                    </button>
                    <button
                      className="button button-secondary sp-btn-sm-danger"
                      onClick={async () => {
                        if (confirm(`Remove MCP server "${srv.name}"?`)) {
                          await (window as any).electron?.mcpRemoveServer?.(srv.name);
                          loadMcpServers();
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add server form */}
        {showMcpForm ? (
          <div className="sp-form-box">
            <div className="sp-form-col">
              <div className="sp-form-row">
                <select
                  aria-label="MCP server type"
                  className="setting-input sp-select-auto"
                  value={mcpForm.type}
                  onChange={(e) => setMcpForm({ ...mcpForm, type: e.target.value as 'stdio' | 'sse' })}
                >
                  <option value="stdio">stdio (local)</option>
                  <option value="sse">SSE (remote)</option>
                </select>
                <input
                  className="setting-input"
                  placeholder="Server name (e.g. brave-search)"
                  value={mcpForm.name}
                  onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
                />
              </div>
              {mcpForm.type === 'stdio' ? (
                <>
                  <input
                    className="setting-input"
                    placeholder="Command (e.g. npx)"
                    value={mcpForm.command}
                    onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })}
                  />
                  <input
                    className="setting-input"
                    placeholder='Args, space-separated (e.g. -y @modelcontextprotocol/server-brave-search)'
                    value={mcpForm.args}
                    onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })}
                  />
                  <input
                    className="setting-input"
                    placeholder='Env vars as JSON (e.g. {"BRAVE_API_KEY":"your-key"})'
                    value={mcpForm.env}
                    onChange={(e) => setMcpForm({ ...mcpForm, env: e.target.value })}
                  />
                </>
              ) : (
                <input
                  className="setting-input"
                  placeholder="SSE URL (e.g. http://localhost:3000/sse)"
                  value={mcpForm.url}
                  onChange={(e) => setMcpForm({ ...mcpForm, url: e.target.value })}
                />
              )}
              <small className="sp-mcp-hint">
                Changes take effect after restarting HomeBot.
              </small>
              <div className="sp-mcp-actions">
                <button
                  className="button button-save sp-btn-save-sm"
                  onClick={async () => {
                    if (!mcpForm.name.trim()) return;
                    let envParsed: Record<string, string> | undefined;
                    try {
                      if (mcpForm.env.trim()) envParsed = JSON.parse(mcpForm.env);
                    } catch {
                      alert('Invalid env JSON');
                      return;
                    }
                    const config: any = mcpForm.type === 'stdio'
                      ? {
                          type: 'stdio',
                          name: mcpForm.name.trim(),
                          command: mcpForm.command.trim(),
                          args: mcpForm.args.trim() ? mcpForm.args.trim().split(/\s+/) : [],
                          env: envParsed,
                          enabled: true
                        }
                      : {
                          type: 'sse',
                          name: mcpForm.name.trim(),
                          url: mcpForm.url.trim(),
                          enabled: true
                        };
                    await (window as any).electron?.mcpAddServer?.(config);
                    setMcpForm({ type: 'stdio', name: '', command: '', args: '', env: '', url: '', enabled: true });
                    setShowMcpForm(false);
                    loadMcpServers();
                  }}
                >
                  Add Server
                </button>
                <button
                  className="button button-cancel sp-btn-save-sm"
                  onClick={() => setShowMcpForm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            className="button button-secondary sp-add-job-btn"
            onClick={() => setShowMcpForm(true)}
          >
            + Add MCP Server
          </button>
        )}
      </div>

      {/* Skills — markdown recipes the assistant can follow */}
      <SkillsSection />

      {/* Backup / Restore */}
      <div className="settings-section sp-backup-section">
        <h3 className="section-title">Backup & Restore</h3>
        <p className="sp-backup-desc">
          Export all settings, conversations, and preferences as a single backup file, or restore from one.
        </p>
        <div className="sp-backup-btns">
          <button
            className="button button-secondary"
            onClick={async () => {
              const r = await (window as any).electron.exportSettings?.();
              if (r?.success) alert(`Backup saved to:\n${r.path}`);
              else alert(`Export failed: ${r?.error || 'Unknown error'}`);
            }}
          >
            Export Backup
          </button>
          <label className="button button-secondary sp-backup-import-label">
            Import Backup
            <input
              type="file"
              accept=".json"
              className="sp-backup-file-input"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const filePath = (file as any).path;
                if (!filePath) { alert('Could not read file path'); return; }
                if (!confirm('This will overwrite your current settings. Continue?')) return;
                const r = await (window as any).electron.importSettings?.(filePath);
                if (r?.success) {
                  alert('Settings restored! Restart HomeBot for full effect.');
                  try { await (window as any).electron.restartApp?.(); } catch {}
                } else {
                  alert(`Import failed: ${r?.error || 'Unknown error'}`);
                }
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

    </>
  );
}
