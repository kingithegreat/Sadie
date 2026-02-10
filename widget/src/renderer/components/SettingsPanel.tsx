import { useState, useEffect } from 'react';
import TelemetryConsentModal from './TelemetryConsentModal';
import type { Settings as SharedSettings, CustomLLMConfig, CustomModelInfo } from '../../shared/types';

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
  tavilyApiKey?: string;
  serperApiKey?: string;
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
    chatModel: 'qwen2.5:7b',
    uncensoredModel: 'dolphin-llama3:8b',
    visionModel: 'llava:latest'
  };

  const defaultCustomLLM: CustomLLMConfig = {
    name: 'Custom LLM',
    apiUrl: '',
    apiKey: '',
    provider: 'openai',
    model: '',
    enabled: false
  };

  // Get the canonical API URL for known providers
  const getDefaultApiUrl = (provider: string) => {
    switch (provider) {
      case 'openai': return 'https://api.openai.com/v1';
      case 'anthropic': return 'https://api.anthropic.com/v1';
      case 'openrouter': return 'https://openrouter.ai/api/v1';
      default: return '';
    }
  };

  const buildLocalSettings = (source: SharedSettings): Settings => {
    const llm = source.customLLM ? { ...defaultCustomLLM, ...source.customLLM } : { ...defaultCustomLLM };
    // Ensure known providers always have their canonical URL
    const providerDefault = getDefaultApiUrl(llm.provider);
    if (providerDefault) llm.apiUrl = providerDefault;
    return {
      ...source,
      chatModel: source.chatModel || defaultModels.chatModel,
      uncensoredModel: source.uncensoredModel || defaultModels.uncensoredModel,
      visionModel: source.visionModel || defaultModels.visionModel,
      useCustomLLM: source.useCustomLLM ?? false,
      customLLM: llm,
      tavilyApiKey: source.tavilyApiKey || '',
      serperApiKey: source.serperApiKey || ''
    };
  };

  // Models ordered by tool-calling capability (best first)
  const ollamaModels = [
    {
      id: 'qwen2.5:7b',
      name: 'Qwen 2.5 (7B)',
      description: '⭐ Best for tools & actions - excellent function calling (4.4GB)'
    },
    {
      id: 'llama3.2:3b',
      name: 'Llama 3.2 (3B)',
      description: 'Fast & lightweight, decent tool support (2GB)'
    },
    {
      id: 'mistral:latest',
      name: 'Mistral',
      description: 'Great conversation quality, weaker at tools (4.4GB)'
    },
    {
      id: 'dolphin-llama3:8b',
      name: 'Dolphin Llama 3 (8B)',
      description: 'Uncensored chat, no tool calling (4.7GB)'
    },
    {
      id: 'llava:latest',
      name: 'LLaVA Vision',
      description: 'For image/screenshot analysis (4.7GB)'
    }
  ];

  const [localSettings, setLocalSettings] = useState<Settings>(buildLocalSettings(settings));
  const [uncensoredMode, setUncensoredMode] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, boolean>>(((settings as any).permissions || {}) as Record<string, boolean>);
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [availableModels, setAvailableModels] = useState<CustomModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [modelsFetchedAt, setModelsFetchedAt] = useState<number | null>(null);

  const PERMISSION_DESCRIPTIONS: Record<string, string> = {
    read_file: 'Read the contents of a file (safe).',
    list_directory: 'List files/folders within a directory (safe).',
    create_directory: 'Create a directory/folder in your home folder.',
    get_file_info: 'Get details about a file or folder (size, dates).',
    copy_file: 'Copy files and folders.',
    parse_document_from_path: 'Parse PDF/Word/text files from a local path (read-only).',
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
    setLocalSettings(buildLocalSettings(settings));
    setPermissions((settings as any).permissions || {});
    setAvailableModels([]);
    setModelFetchError(null);
    setModelsFetchedAt(null);
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

  const selectedProvider = localSettings.customLLM?.provider || 'openai';
  const providerRequiresApiKey = selectedProvider !== 'custom';
  const hasApiKey = Boolean(localSettings.customLLM?.apiKey?.trim());
  const isConnected = availableModels.length > 0 && hasApiKey;

  useEffect(() => {
    setAvailableModels([]);
    setModelFetchError(null);
    setModelsFetchedAt(null);
  }, [localSettings.customLLM?.apiUrl, selectedProvider, localSettings.useCustomLLM]);

  const handleSave = () => {
    const llmToSave = localSettings.customLLM ? { ...localSettings.customLLM, enabled: !!localSettings.useCustomLLM } : undefined;
    // Ensure known providers always save with canonical URL
    if (llmToSave) {
      const canonicalUrl = getDefaultApiUrl(llmToSave.provider);
      if (canonicalUrl) llmToSave.apiUrl = canonicalUrl;
    }
    const nextSettings: SharedSettings = {
      ...localSettings,
      customLLM: llmToSave,
      tavilyApiKey: localSettings.tavilyApiKey?.trim() || undefined,
      serperApiKey: localSettings.serperApiKey?.trim() || undefined
    } as SharedSettings;
    onSave(nextSettings);
    onClose();
  };

  const handleCancel = () => {
    setLocalSettings(buildLocalSettings(settings)); // Reset to original
    setAvailableModels([]);
    setModelFetchError(null);
    setModelsFetchedAt(null);
    onClose();
  };

  const handleFetchModels = async () => {
    const apiKey = localSettings.customLLM?.apiKey?.trim();
    const provider = selectedProvider;
    
    // For known providers, ALWAYS use the canonical URL (ignore any stale/wrong stored value)
    const defaultUrl = getDefaultApiUrl(provider);
    let apiUrl = defaultUrl || localSettings.customLLM?.apiUrl?.trim() || '';

    // Validate we have what we need
    if (!apiUrl) {
      setModelFetchError('Enter your API URL');
      return;
    }

    if (providerRequiresApiKey && !apiKey) {
      setModelFetchError('Enter your API key first');
      return;
    }

    if (!(window as any).electron?.listCustomLLMModels) {
      setModelFetchError('Update SADIE to fetch models automatically.');
      return;
    }

    setModelsLoading(true);
    setModelFetchError(null);

    // Update local state with the resolved URL
    setLocalSettings(prev => ({
      ...prev,
      customLLM: { ...(prev.customLLM || { ...defaultCustomLLM }), apiUrl }
    }));

    console.log('[Settings] Fetching models from:', apiUrl, 'provider:', provider);

    try {
      const result = await (window as any).electron.listCustomLLMModels({ apiUrl, apiKey, provider });
      if (result?.success && Array.isArray(result.models)) {
        setAvailableModels(result.models);
        setModelsFetchedAt(Date.now());
        // Auto-enable custom LLM and select first model
        if (result.models.length > 0) {
          setLocalSettings(prev => ({
            ...prev,
            useCustomLLM: true,
            customLLM: { 
              ...(prev.customLLM || { ...defaultCustomLLM }), 
              model: prev.customLLM?.model || result.models[0].id,
              apiUrl,
              enabled: true
            }
          }));
        }
      } else {
        throw new Error(result?.error || 'No models returned.');
      }
    } catch (err: any) {
      setAvailableModels([]);
      setModelsFetchedAt(null);
      setModelFetchError(err?.message || 'Connection failed. Check your API key.');
    } finally {
      setModelsLoading(false);
    }
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
          <div className="model-grid">
            {ollamaModels.map((model) => (
              <button
                key={model.id}
                className={`model-card ${localSettings.chatModel === model.id ? 'active' : ''}`}
                onClick={() =>
                  setLocalSettings({
                    ...localSettings,
                    chatModel: model.id
                  })
                }
              >
                <div className="model-card-label">{model.name}</div>
                <p className="model-card-desc">{model.description}</p>
              </button>
            ))}
          </div>
          <small className="setting-hint">Used for standard chats with tool calling. Custom APIs override this.</small>
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

        {/* Custom LLM API Section - Simplified */}
        <div className="setting-group custom-llm-section">
          <label className="setting-label">☁️ Cloud API (OpenAI, Anthropic, etc.)</label>
          
          {/* Step 1: Provider Selection */}
          <div className="provider-row">
            <select
              className="setting-input provider-select"
              value={selectedProvider}
              onChange={(e) => {
                const newProvider = e.target.value as any;
                setLocalSettings({
                  ...localSettings,
                  customLLM: { 
                    ...localSettings.customLLM!, 
                    provider: newProvider,
                    apiUrl: getDefaultApiUrl(newProvider)
                  }
                });
                setAvailableModels([]);
                setModelFetchError(null);
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openrouter">OpenRouter</option>
              <option value="custom">Custom URL</option>
            </select>
          </div>

          {/* Step 2: API Key (or URL for custom) */}
          {selectedProvider === 'custom' ? (
            <div className="api-key-row">
              <input
                type="text"
                className="setting-input api-key-input"
                value={localSettings.customLLM?.apiUrl || ''}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    customLLM: { ...localSettings.customLLM!, apiUrl: e.target.value }
                  })
                }
                placeholder="https://your-api.com/v1"
              />
            </div>
          ) : null}
          
          <div className="api-key-row">
            <input
              type="password"
              className="setting-input api-key-input"
              value={localSettings.customLLM?.apiKey || ''}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  customLLM: { ...localSettings.customLLM!, apiKey: e.target.value }
                })
              }
              placeholder={selectedProvider === 'openai' ? 'sk-...' : selectedProvider === 'anthropic' ? 'sk-ant-...' : 'API Key'}
            />
            <button
              type="button"
              className={`button connect-btn ${isConnected ? 'connected' : ''}`}
              onClick={handleFetchModels}
              disabled={modelsLoading || (providerRequiresApiKey && !hasApiKey)}
            >
              {modelsLoading ? '...' : isConnected ? '✓ Connected' : 'Connect'}
            </button>
          </div>
          
          {modelFetchError && (
            <small className="setting-hint error-hint">{modelFetchError}</small>
          )}

          {/* Step 3: Model Selection - only show when connected */}
          {isConnected && (
            <div className="model-chips-section">
              <label className="setting-label chip-label">Select Model</label>
              <div className="custom-models-grid">
                {availableModels.map((model) => (
                  <button
                    type="button"
                    key={model.id}
                    className={`custom-model-chip ${localSettings.customLLM?.model === model.id ? 'active' : ''}`}
                    onClick={() =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        customLLM: { ...(prev.customLLM || { ...defaultCustomLLM }), model: model.id }
                      }))
                    }
                  >
                    <span className="chip-name">{model.name || model.id}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Status indicator */}
          {localSettings.useCustomLLM && localSettings.customLLM?.model && (
            <div className="custom-llm-status">
              <span className="status-dot active"></span>
              Using {localSettings.customLLM.model}
            </div>
          )}

          {/* Disable toggle - only show when connected */}
          {isConnected && (
            <label className="setting-label disable-toggle">
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
              <span>Use this API for all chats</span>
            </label>
          )}
        </div>

        <div className="setting-group">
          <label className="setting-label">🔍 Search API Keys (optional)</label>
          <small className="setting-hint" style={{ marginBottom: 8 }}>
            Add API keys for higher-quality web search results. Falls back to DuckDuckGo scraping if no keys are set.
          </small>
          <label className="setting-sub-label" style={{ fontSize: '0.85em', marginTop: 4 }}>Tavily API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.tavilyApiKey || ''}
            placeholder="tvly-..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, tavilyApiKey: e.target.value })
            }
          />
          <small className="setting-hint">Primary search — AI-optimized results. Get a key at <a href="https://tavily.com" target="_blank" rel="noreferrer">tavily.com</a></small>

          <label className="setting-sub-label" style={{ fontSize: '0.85em', marginTop: 8 }}>Serper.dev API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.serperApiKey || ''}
            placeholder="Enter Serper.dev key..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, serperApiKey: e.target.value })
            }
          />
          <small className="setting-hint">Secondary search — Google results via API. Get a key at <a href="https://serper.dev" target="_blank" rel="noreferrer">serper.dev</a></small>
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
