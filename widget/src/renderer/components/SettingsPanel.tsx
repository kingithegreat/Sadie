import React, { useState, useEffect } from 'react';
import TelemetryConsentModal from './TelemetryConsentModal';
import type { Settings as SharedSettings } from '../../shared/types';

interface Settings {
  alwaysOnTop: boolean;
  n8nUrl: string;
  widgetHotkey: string;
  uncensoredMode?: boolean;
  telemetryEnabled?: boolean;
  permissions?: Record<string, boolean>;
  telemetryConsentTimestamp?: string;
  telemetryConsentVersion?: string;
}

interface SettingsPanelProps {
  settings: SharedSettings;
  onSave: (settings: SharedSettings) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onSave,
  onClose
}) => {
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [uncensoredMode, setUncensoredMode] = useState(false);
  const [telemetryEnabled, setTelemetryEnabled] = useState<boolean>(!!(settings as any).telemetryEnabled);
  const [permissions, setPermissions] = useState<Record<string, boolean>>(((settings as any).permissions || {}) as Record<string, boolean>);
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);

  const PERMISSION_DESCRIPTIONS: Record<string, string> = {
    read_file: 'Read the contents of a file (safe).',
    list_directory: 'List files/folders within a directory (safe).',
    create_directory: 'Create a directory/folder in your home folder.',
    get_file_info: 'Get details about a file or folder (size, dates).',
    copy_file: 'Copy files and folders.',
    write_file: 'Write or modify files. Dangerous: could overwrite or leak sensitive data.',
    delete_file: 'Delete files or folders permanently. Dangerous: irreversible.',
    move_file: 'Move or rename files or folders. Dangerous: may overwrite.',
    launch_app: 'Launch external applications on your system (e.g., notepad, chrome).',
    screenshot: 'Take screenshots of your display and save them to disk.',
    open_url: 'Open URLs in your default browser (safe), but could lead to external content.',
    web_search: 'Perform web searches to retrieve results.',
    nba_query: 'Query NBA stats and team information from trusted sources (ESPN).'
    ,
    generate_sports_report: 'Generate a formatted sports results report and save it to your Desktop (requires Write permission).'
  };

  const DANGEROUS_PERMISSIONS = new Set(['delete_file', 'move_file', 'launch_app', 'screenshot']);

  const [telemetryLog, setTelemetryLog] = useState<string[]>([]);
  // Local model selection and api keys
  const [model, setModel] = useState<string>((settings as any).model || 'ollama');
  const [apiKeysLocal, setApiKeysLocal] = useState<Record<string, string>>(((settings as any).apiKeys) || {});

  const refreshTelemetryLog = async () => {
    try {
      const r = await (window as any).electron?.readConsentLog?.();
      let entries: string[] = [];
      if (r && r.success && typeof r.data === 'string') {
        const lines = r.data.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            entries.push(JSON.stringify(obj, null, 2));
          } catch (e) {
            entries.push(line);
          }
        }
      }
      setTelemetryLog(entries);
    } catch (e) {
      setTelemetryLog([`Failed to read consent log: ${String(e)}`]);
    }
  };

  const telemetryLogPreview = () => {
    if (!telemetryLog || telemetryLog.length === 0) return 'No consent log entries found.';
    return telemetryLog.join('\n\n-----\n\n');
  };

  // Update local settings when props change
  useEffect(() => {
    setLocalSettings(settings);
    setTelemetryEnabled(!!(settings as any).telemetryEnabled);
    setPermissions((settings as any).permissions || {});
    setModel((settings as any).model || 'ollama');
    setApiKeysLocal((settings as any).apiKeys || {});
  }, [settings]);

  // Load uncensored mode state on mount
  useEffect(() => {
    (window as any).electron?.getUncensoredMode?.().then((result: { enabled: boolean }) => {
      setUncensoredMode(result?.enabled || false);
    });
  }, []);

  const handleUncensoredToggle = async (enabled: boolean) => {
    setUncensoredMode(enabled);
    await (window as any).electron?.setUncensoredMode?.(enabled);
    // Model switches immediately - no restart needed
  };

  // Update local settings when props change
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSave = () => {
    const merged = { ...localSettings, model, apiKeys: apiKeysLocal } as any;
    onSave(merged);
    onClose();
  };

  const handleCancel = () => {
    setLocalSettings(settings); // Reset to original
    onClose();
  };

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="close-button" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="settings-body">
        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={localSettings.alwaysOnTop}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  alwaysOnTop: e.target.checked
                })
              }
            />
            <span>Always on top</span>
          </label>
        </div>

        <div className="setting-group">
          <label className="setting-label">n8n URL</label>
          <input
            type="text"
            className="setting-input"
            value={localSettings.n8nUrl}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                n8nUrl: e.target.value
              })
            }
            placeholder="http://localhost:5678"
          />
        </div>

        <div className="setting-group">
          <label className="setting-label">Model</label>
          <select aria-label="Model" className="setting-input" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="ollama">Ollama (local)</option>
            <option value="openai">OpenAI</option>
          </select>
          <small className="setting-hint">Select which model/provider to use for assistant reasoning.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">API keys</label>
          <small className="setting-hint">Enter provider API keys. Values are stored locally in your SADIE config file.</small>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <div>
              <label className="setting-label">OpenAI API Key</label>
              <input
                type="password"
                className="setting-input"
                value={apiKeysLocal.openai || ''}
                onChange={(e) => setApiKeysLocal({ ...apiKeysLocal, openai: e.target.value })}
                placeholder="sk-..."
              />
            </div>
            <div>
              <label className="setting-label">Ollama API Key</label>
              <input
                type="password"
                className="setting-input"
                value={apiKeysLocal.ollama || ''}
                onChange={(e) => setApiKeysLocal({ ...apiKeysLocal, ollama: e.target.value })}
                placeholder="(optional for local ollama)"
              />
            </div>
          </div>
        </div>

        <div className="setting-group">
          <label className="setting-label">Widget Hotkey (read-only)</label>
          <input
            type="text"
            className="setting-input"
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
          <small className="setting-hint" style={{ color: uncensoredMode ? '#f59e0b' : undefined }}>
            {uncensoredMode 
              ? 'Using dolphin-llama3:8b - No content filters' 
              : 'Using llama3.2:3b - Standard safety filters'}
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={true}
              disabled
            />
            <span>🛡️ Telemetry (required, anonymous)</span>
          </label>
        </div>

        <div className="setting-group">
          <label className="setting-label">Permissions</label>
          <small className="setting-hint">Enable or disable specific tools.</small>
          <div className="permission-grid space-y-2">
            {Object.keys(permissions).map((k) => (
              <div key={k} className="flex items-start gap-3">
                <label className="setting-label inline-flex items-center mr-3">
                  <input
                    type="checkbox"
                    checked={!!permissions[k]}
                    onChange={(e) => {
                      const next = { ...permissions, [k]: e.target.checked };
                      setPermissions(next);
                      setLocalSettings({ ...localSettings, permissions: next } as any);
                    }}
                  />
                  <span className="ml-2">{k.replace(/_/g, ' ')}</span>
                </label>
                <div>
                  <small className="text-zinc-500">{PERMISSION_DESCRIPTIONS[k] || 'No description available.'}</small>
                  {DANGEROUS_PERMISSIONS.has(k) && (
                    <small style={{ color: '#f59e0b', display: 'block' }}>{PERMISSION_DESCRIPTIONS[k]}</small>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="setting-group">
          <button
            className="button button-secondary"
            onClick={async () => {
              // Reset permissions to defaults by calling a dedicated IPC to avoid ambiguity
              const result = await (window as any).electron.resetPermissions();
              if (result) {
                const newPerms = (result as any).permissions || {};
                setPermissions(newPerms);
                setLocalSettings({ ...localSettings, permissions: newPerms } as any);
              }
            }}
          >
            Reset permissions to defaults
          </button>
        </div>
        <div className="setting-group">
          <label className="setting-label">Telemetry consent</label>
          <div className="flex items-center gap-2">
            <div className="text-sm text-zinc-400">{localSettings.telemetryConsentTimestamp ? `Consented: ${localSettings.telemetryConsentTimestamp} (v${localSettings.telemetryConsentVersion || '1.0'})` : 'No consent on record'}</div>
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
          </div>
          <div style={{ maxHeight: 220, overflow: 'auto', background: '#0f1724', padding: 8, borderRadius: 6 }}>
            <pre style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace', color: '#cbd5e1', margin: 0, whiteSpace: 'pre-wrap' }}>{telemetryLogPreview()}</pre>
          </div>
        </div>
        <TelemetryConsentModal
          open={showTelemetryModal}
          onAccept={async () => {
            // Persist immediately so telemetry consent is logged
            const updated = await (window as any).electron.saveSettings({ ...localSettings, telemetryEnabled: true });
            setTelemetryEnabled(true);
            setLocalSettings({ ...localSettings, telemetryEnabled: true, telemetryConsentTimestamp: updated.telemetryConsentTimestamp });
            setShowTelemetryModal(false);
          }}
          onDecline={() => {
            setShowTelemetryModal(false);
            setTelemetryEnabled(false);
            setLocalSettings({ ...localSettings, telemetryEnabled: false });
          }}
          onClose={() => setShowTelemetryModal(false)}
        />
      </div>

      <div className="settings-footer">
        <button className="button button-cancel" onClick={handleCancel}>
          Cancel
        </button>
        <button className="button button-save" onClick={handleSave}>
          Save
        </button>
      </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
