import { useState, useEffect } from 'react';
import TelemetryConsentModal from './TelemetryConsentModal';
import type { Settings as SharedSettings, CustomLLMConfig } from '../../shared/types';

interface Settings {
  alwaysOnTop: boolean;
  n8nUrl: string;
  widgetHotkey: string;
  chatModel?: string;
  uncensoredModel?: string;
  visionModel?: string;
  uncensoredMode?: boolean;
  telemetryEnabled?: boolean;
  permissions?: Record<string, boolean>;
  telemetryConsentTimestamp?: string;
  telemetryConsentVersion?: string;
  customLLM?: CustomLLMConfig;
  useCustomLLM?: boolean;
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
  const defaultModels = {
    chatModel: 'llama3.2:3b',
    uncensoredModel: 'dolphin-llama3:8b',
    visionModel: 'llava'
  };

  const [localSettings, setLocalSettings] = useState<Settings>({
    ...settings,
    chatModel: settings.chatModel || defaultModels.chatModel,
    uncensoredModel: settings.uncensoredModel || defaultModels.uncensoredModel,
    visionModel: settings.visionModel || defaultModels.visionModel,
    useCustomLLM: settings.useCustomLLM || false,
    customLLM: settings.customLLM || {
      name: 'Custom LLM',
      apiUrl: '',
      apiKey: '',
      provider: 'openai',
      model: '',
      enabled: false
    }
  });
  const [uncensoredMode, setUncensoredMode] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, boolean>>(((settings as any).permissions || {}) as Record<string, boolean>);
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [showCustomLLMSection, setShowCustomLLMSection] = useState(false);

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
    setLocalSettings({
      ...settings,
      chatModel: settings.chatModel || defaultModels.chatModel,
      uncensoredModel: settings.uncensoredModel || defaultModels.uncensoredModel,
      visionModel: settings.visionModel || defaultModels.visionModel
    });
    setPermissions((settings as any).permissions || {});
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
    setLocalSettings({
      ...settings,
      chatModel: settings.chatModel || defaultModels.chatModel,
      uncensoredModel: settings.uncensoredModel || defaultModels.uncensoredModel,
      visionModel: settings.visionModel || defaultModels.visionModel
    });
  }, [settings]);

  const handleSave = () => {
    onSave(localSettings);
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
          <label className="setting-label">Chat model</label>
          <input
            type="text"
            className="setting-input"
            value={localSettings.chatModel || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                chatModel: e.target.value || defaultModels.chatModel
              })
            }
            placeholder={defaultModels.chatModel}
          />
          <small className="setting-hint">Used for standard chats with tool calling.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Uncensored model</label>
          <input
            type="text"
            className="setting-input"
            value={localSettings.uncensoredModel || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                uncensoredModel: e.target.value || defaultModels.uncensoredModel
              })
            }
            placeholder={defaultModels.uncensoredModel}
          />
          <small className="setting-hint">Used when 🔓 Uncensored Mode is enabled (tools stay disabled).</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Vision model</label>
          <input
            type="text"
            className="setting-input"
            value={localSettings.visionModel || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                visionModel: e.target.value || defaultModels.visionModel
              })
            }
            placeholder={defaultModels.visionModel}
          />
          <small className="setting-hint">Used automatically when images are attached.</small>
        </div>

        {/* Custom LLM API Section */}
        <div className="setting-group">
          <div className="flex items-center justify-between mb-2">
            <label className="setting-label">Custom LLM API</label>
            <button 
              className="button button-secondary"
              onClick={() => setShowCustomLLMSection(!showCustomLLMSection)}
            >
              {showCustomLLMSection ? 'Hide' : 'Configure'}
            </button>
          </div>
          <label className="setting-label">
            <input
              type="checkbox"
              checked={localSettings.useCustomLLM || false}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  useCustomLLM: e.target.checked
                })
              }
            />
            <span>Use custom LLM API instead of Ollama</span>
          </label>
          <small className="setting-hint">
            Bring your own OpenAI, Anthropic, or custom API endpoint
          </small>

          {showCustomLLMSection && (
            <div className="ml-4 mt-3 space-y-3 border-l-2 border-zinc-700 pl-4">
              <div>
                <label className="setting-label">API Name</label>
                <input
                  type="text"
                  className="setting-input"
                  value={localSettings.customLLM?.name || ''}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      customLLM: { ...localSettings.customLLM!, name: e.target.value }
                    })
                  }
                  placeholder="My Custom API"
                />
              </div>

              <div>
                <label className="setting-label">Provider</label>
                <select
                  className="setting-input"
                  value={localSettings.customLLM?.provider || 'openai'}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      customLLM: { ...localSettings.customLLM!, provider: e.target.value as any }
                    })
                  }
                >
                  <option value="openai">OpenAI Compatible</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="custom">Custom</option>
                </select>
                <small className="setting-hint">API format/authentication style</small>
              </div>

              <div>
                <label className="setting-label">API Base URL</label>
                <input
                  type="text"
                  className="setting-input"
                  value={localSettings.customLLM?.apiUrl || ''}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      customLLM: { ...localSettings.customLLM!, apiUrl: e.target.value }
                    })
                  }
                  placeholder="https://api.openai.com/v1"
                />
                <small className="setting-hint">
                  {localSettings.customLLM?.provider === 'openai' && 'e.g., https://api.openai.com/v1'}
                  {localSettings.customLLM?.provider === 'anthropic' && 'e.g., https://api.anthropic.com/v1'}
                  {localSettings.customLLM?.provider === 'openrouter' && 'e.g., https://openrouter.ai/api/v1'}
                  {localSettings.customLLM?.provider === 'custom' && 'Your custom API endpoint'}
                </small>
              </div>

              <div>
                <label className="setting-label">Model Name</label>
                <input
                  type="text"
                  className="setting-input"
                  value={localSettings.customLLM?.model || ''}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      customLLM: { ...localSettings.customLLM!, model: e.target.value }
                    })
                  }
                  placeholder="gpt-4"
                />
                <small className="setting-hint">
                  {localSettings.customLLM?.provider === 'openai' && 'e.g., gpt-4, gpt-3.5-turbo'}
                  {localSettings.customLLM?.provider === 'anthropic' && 'e.g., claude-3-5-sonnet-20241022'}
                  {localSettings.customLLM?.provider === 'openrouter' && 'e.g., anthropic/claude-3.5-sonnet'}
                  {localSettings.customLLM?.provider === 'custom' && 'Model identifier for your API'}
                </small>
              </div>

              <div>
                <label className="setting-label">API Key</label>
                <input
                  type="password"
                  className="setting-input"
                  value={localSettings.customLLM?.apiKey || ''}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      customLLM: { ...localSettings.customLLM!, apiKey: e.target.value }
                    })
                  }
                  placeholder="sk-..."
                />
                <small className="setting-hint">Stored locally, never sent to SADIE servers</small>
              </div>

              <div className="flex items-center gap-2 mt-2">
                <div className="text-xs text-amber-500">
                  ⚠️ Custom APIs may have different rate limits, pricing, and capabilities
                </div>
              </div>
            </div>
          )}
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
            setLocalSettings({ ...localSettings, telemetryEnabled: true, telemetryConsentTimestamp: updated.telemetryConsentTimestamp });
            setShowTelemetryModal(false);
          }}
          onDecline={() => {
            setShowTelemetryModal(false);
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
