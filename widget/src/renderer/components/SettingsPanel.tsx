import { useState, useEffect } from 'react';
import TelemetryConsentModal from './TelemetryConsentModal';
import TelemetryDashboard from './TelemetryDashboard';
import type { Settings as SharedSettings, CustomLLMConfig, CustomModelInfo, ScheduledJob } from '../../shared/types';

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
  anthropicApiKey?: string;
  openaiApiKey?: string;
  stableHordeApiKey?: string;
  codeModel?: string;
  codeApiKey?: string;
  codeApiProvider?: 'openai' | 'anthropic' | 'openrouter' | 'custom';
  codeApiUrl?: string;
  chatGuidelines?: string;
  notificationsEnabled?: boolean;
  notificationSound?: boolean;
  notificationDuration?: number;
  messageDensity?: 'compact' | 'comfortable' | 'spacious';
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
    visionModel: 'llava:latest',
    codeModel: 'qwen2.5-coder:3b'
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
    // Auto-fill API key from saved provider keys if not already set
    if (!llm.apiKey) {
      if (llm.provider === 'anthropic' && source.anthropicApiKey) {
        llm.apiKey = source.anthropicApiKey;
      } else if (llm.provider === 'openai' && source.openaiApiKey) {
        llm.apiKey = source.openaiApiKey;
      }
    }
    return {
      ...source,
      chatModel: source.chatModel || defaultModels.chatModel,
      uncensoredModel: source.uncensoredModel || defaultModels.uncensoredModel,
      visionModel: source.visionModel || defaultModels.visionModel,
      codeModel: source.codeModel ?? '',
      useCustomLLM: source.useCustomLLM ?? false,
      customLLM: llm,
      tavilyApiKey: source.tavilyApiKey || '',
      serperApiKey: source.serperApiKey || '',
      anthropicApiKey: source.anthropicApiKey || '',
      openaiApiKey: source.openaiApiKey || '',
      stableHordeApiKey: source.stableHordeApiKey || '',
      codeApiKey: source.codeApiKey || '',
      codeApiProvider: source.codeApiProvider || 'openai',
      codeApiUrl: source.codeApiUrl || '',
      chatGuidelines: source.chatGuidelines || '',
      notificationsEnabled: (source as any).notificationsEnabled !== false,
      notificationSound: !!(source as any).notificationSound,
      notificationDuration: (source as any).notificationDuration ?? 8000,
      messageDensity: (source as any).messageDensity || 'comfortable'
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
      id: 'qwen2.5-coder:3b',
      name: 'Qwen 2.5 Coder (3B)',
      description: '💻 Best for your GPU — fits in 4GB VRAM comfortably (2GB) ⭐'
    },
    {
      id: 'qwen2.5-coder:7b',
      name: 'Qwen 2.5 Coder (7B)',
      description: '💻 Best for coding — specialised code model (4.4GB)'
    },
    {
      id: 'deepseek-coder-v2:latest',
      name: 'DeepSeek Coder V2',
      description: '💻 Excellent code completion & debugging (8.9GB)'
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
  const [_modelsFetchedAt, setModelsFetchedAt] = useState<number | null>(null);

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
  const [showTelemetryDashboard, setShowTelemetryDashboard] = useState(false);

  // Scheduler state
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [showJobForm, setShowJobForm] = useState(false);
  const [jobForm, setJobForm] = useState({
    name: '',
    message: '',
    mode: 'interval' as 'interval' | 'daily',
    intervalMinutes: 60,
    dailyTime: '09:00',
  });

  const loadJobs = async () => {
    try {
      const jobs = await (window as any).electron?.schedulerList?.();
      if (Array.isArray(jobs)) setScheduledJobs(jobs);
    } catch { /* IPC not yet ready */ }
  };

  useEffect(() => { loadJobs(); }, []);

  // MCP server management state
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [mcpStatus, setMcpStatus] = useState<any[]>([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [mcpForm, setMcpForm] = useState({
    type: 'stdio' as 'stdio' | 'sse',
    name: '',
    command: '',
    args: '',
    env: '',
    url: '',
    enabled: true
  });

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

  // Load MCP server list on mount
  const loadMcpServers = async () => {
    try {
      const servers = await (window as any).electron?.mcpListServers?.();
      const status = await (window as any).electron?.mcpGetStatus?.();
      if (servers) setMcpServers(servers);
      if (status) setMcpStatus(status);
    } catch (e) { /* silently ignore if IPC not yet ready */ }
  };

  useEffect(() => { loadMcpServers(); }, []);

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
      codeModel: (localSettings as any).codeModel?.trim() || undefined,
      codeApiKey: (localSettings as any).codeApiKey?.trim() || undefined,
      codeApiProvider: (localSettings as any).codeApiProvider || undefined,
      codeApiUrl: (localSettings as any).codeApiUrl?.trim() || undefined,
      tavilyApiKey: localSettings.tavilyApiKey?.trim() || undefined,
      serperApiKey: localSettings.serperApiKey?.trim() || undefined,
      anthropicApiKey: localSettings.anthropicApiKey?.trim() || undefined,
      openaiApiKey: localSettings.openaiApiKey?.trim() || undefined,
      stableHordeApiKey: (localSettings as any).stableHordeApiKey?.trim() || undefined,
      chatGuidelines: localSettings.chatGuidelines?.trim() || undefined
    } as SharedSettings;
    // Also persist any extra keys that the local-only interface tracks
    (nextSettings as any).notificationsEnabled = (localSettings as any).notificationsEnabled;
    (nextSettings as any).notificationSound = (localSettings as any).notificationSound;
    (nextSettings as any).notificationDuration = (localSettings as any).notificationDuration;
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
    <div className="settings-overlay" role="presentation" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        tabIndex={-1}
      >
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="close-button" onClick={onClose} aria-label="Close settings">
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
          <label className="setting-label">🎨 Theme</label>
          <div className="theme-selector">
            {(['dark', 'light', 'system'] as const).map(t => (
              <button
                key={t}
                className={`theme-btn ${(localSettings as any).theme === t || (!((localSettings as any).theme) && t === 'dark') ? 'active' : ''}`}
                onClick={() => setLocalSettings({ ...localSettings, theme: t } as any)}
                aria-label={`${t} theme`}
              >
                {t === 'dark' ? '🌙' : t === 'light' ? '☀️' : '💻'} {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
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
          <select
            aria-label="Vision model"
            className="setting-input"
            value={[
              'llava:latest', 'llava:7b', 'llava:13b',
              'llava-llama3:latest', 'bakllava:latest',
              'moondream:latest', 'minicpm-v:latest',
            ].includes(localSettings.visionModel || '') ? (localSettings.visionModel || 'llava:latest') : '__custom__'}
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                setLocalSettings({ ...localSettings, visionModel: e.target.value });
              }
            }}
          >
            <option value="llava:latest">llava:latest (recommended, 4.7 GB)</option>
            <option value="llava:7b">llava:7b (4.7 GB)</option>
            <option value="llava:13b">llava:13b (8.0 GB)</option>
            <option value="llava-llama3:latest">llava-llama3:latest (5.5 GB)</option>
            <option value="bakllava:latest">bakllava:latest (4.7 GB)</option>
            <option value="moondream:latest">moondream:latest (1.7 GB, fast)</option>
            <option value="minicpm-v:latest">minicpm-v:latest (5.6 GB)</option>
            <option value="__custom__">Custom…</option>
          </select>
          {(![
            'llava:latest', 'llava:7b', 'llava:13b',
            'llava-llama3:latest', 'bakllava:latest',
            'moondream:latest', 'minicpm-v:latest',
          ].includes(localSettings.visionModel || '')) && (
            <input
              type="text"
              className="setting-input sp-vision-input"
              value={localSettings.visionModel || ''}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  visionModel: e.target.value || defaultModels.visionModel
                })
              }
              placeholder={defaultModels.visionModel}
            />
          )}
          <small className="setting-hint">Used automatically when images are attached. Must be a vision-capable Ollama model.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">💻 Code model</label>
          <input
            type="text"
            className="setting-input"
            value={(localSettings as any).codeModel || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                codeModel: e.target.value
              } as any)
            }
            placeholder={defaultModels.codeModel}
          />
          <small className="setting-hint">Local Ollama model for coding. Leave blank to use the chat model. Recommended for your GPU: <code>qwen2.5-coder:3b</code> (~2GB VRAM). If a Code API key is set below, it takes priority over this.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">🔑 Code model — Cloud API (optional)</label>
          <div className="api-key-row">
            <select
              className="setting-input provider-select"
              title="Code API provider"
              value={(localSettings as any).codeApiProvider || 'openai'}
              onChange={(e) => setLocalSettings({ ...localSettings, codeApiProvider: e.target.value as any } as any)}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="openrouter">OpenRouter</option>
              <option value="custom">Custom URL</option>
            </select>
            <input
              type="password"
              className="setting-input api-key-input"
              value={(localSettings as any).codeApiKey || ''}
              onChange={(e) => setLocalSettings({ ...localSettings, codeApiKey: e.target.value } as any)}
              placeholder="API key (sk-...)" 
            />
          </div>
          {(localSettings as any).codeApiProvider === 'custom' && (
            <input
              type="text"
              className="setting-input"
              value={(localSettings as any).codeApiUrl || ''}
              onChange={(e) => setLocalSettings({ ...localSettings, codeApiUrl: e.target.value } as any)}
              placeholder="Custom API base URL (e.g. http://localhost:8080/v1)"
            />
          )}
          <small className="setting-hint">Paste an API key to route all coding queries to a cloud model. The model name comes from the <em>Code model</em> field above (e.g. <code>gpt-4o</code>, <code>claude-opus-4-20250514</code>). Leave blank to use local Ollama.</small>
        </div>
        <div className="setting-group">
          <label className="setting-label">📝 Chat Guidelines</label>
          <textarea
            className="setting-input setting-textarea"
            value={localSettings.chatGuidelines || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                chatGuidelines: e.target.value
              })
            }
            placeholder="Add custom instructions here... (e.g., 'Always respond in a friendly tone', 'Format code using markdown')"
            rows={4}
          />
          <small className="setting-hint">Custom instructions appended to the system prompt for all conversations.</small>
        </div>

        {/* Notification Preferences */}
        <div className="setting-group">
          <label className="setting-label">🔔 Notifications</label>
          <label className="setting-label">
            <input
              type="checkbox"
              checked={(localSettings as any).notificationsEnabled !== false}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, notificationsEnabled: e.target.checked } as any)
              }
            />
            <span>Show toast notifications</span>
          </label>
          <label className="setting-label">
            <input
              type="checkbox"
              checked={!!(localSettings as any).notificationSound}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, notificationSound: e.target.checked } as any)
              }
            />
            <span>Play notification sound</span>
          </label>
          <label className="setting-label">Toast duration</label>
          <select
            className="setting-input"
            aria-label="Toast notification duration"
            value={(localSettings as any).notificationDuration ?? 8000}
            onChange={(e) =>
              setLocalSettings({ ...localSettings, notificationDuration: Number(e.target.value) } as any)
            }
          >
            <option value={3000}>Short (3s)</option>
            <option value={5000}>Medium (5s)</option>
            <option value={8000}>Long (8s)</option>
            <option value={15000}>Extra long (15s)</option>
          </select>
          <small className="setting-hint">Controls how long toast notifications stay visible.</small>
        </div>

        {/* Message Density */}
        <div className="setting-group">
          <label className="setting-label">📐 Message Density</label>
          <div className="density-options">
            {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
              <button
                key={d}
                className={`density-btn${(localSettings as any).messageDensity === d ? ' active' : ''}`}
                onClick={() => setLocalSettings({ ...localSettings, messageDensity: d } as any)}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
          <small className="setting-hint">Controls spacing between messages in the chat.</small>
        </div>

        {/* Custom LLM API Section - Simplified */}
        <div className="setting-group custom-llm-section">
          <label className="setting-label">☁️ Cloud API (OpenAI, Anthropic, etc.)</label>
          
          {/* Step 1: Provider Selection */}
          <div className="provider-row">
            <select
              aria-label="Cloud API provider"
              className="setting-input provider-select"
              value={selectedProvider}
              onChange={(e) => {
                const newProvider = e.target.value as any;
                // Auto-fill API key from saved keys when switching providers
                let autoFillKey = localSettings.customLLM?.apiKey || '';
                if (newProvider === 'anthropic' && localSettings.anthropicApiKey) {
                  autoFillKey = localSettings.anthropicApiKey;
                } else if (newProvider === 'openai' && localSettings.openaiApiKey) {
                  autoFillKey = localSettings.openaiApiKey;
                }
                setLocalSettings({
                  ...localSettings,
                  customLLM: { 
                    ...localSettings.customLLM!, 
                    provider: newProvider,
                    apiUrl: getDefaultApiUrl(newProvider),
                    apiKey: autoFillKey
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
          <label className="setting-label">� LLM API Keys (optional)</label>
          <small className="setting-hint sp-hint-mb">
            Save your API keys here. They will auto-fill when you select the provider above.
          </small>
          <label className="setting-sub-label sp-sub-label">Anthropic API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.anthropicApiKey || ''}
            placeholder="sk-ant-..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, anthropicApiKey: e.target.value })
            }
          />
          <small className="setting-hint">For Claude models. Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer noopener">console.anthropic.com</a></small>

          <label className="setting-sub-label sp-sub-label-mt8">OpenAI API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.openaiApiKey || ''}
            placeholder="sk-..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, openaiApiKey: e.target.value })
            }
          />
          <small className="setting-hint">For GPT models and DALL-E 3 image generation. Get a key at <a href="https://platform.openai.com" target="_blank" rel="noreferrer noopener">platform.openai.com</a></small>
        </div>

        <div className="setting-group">
          <label className="setting-label">🎨 Image Generation</label>
          <small className="setting-hint sp-hint-mb">
            Images are generated via Stable Horde (free community-powered AI). Register at <a href="https://stablehorde.net" target="_blank" rel="noreferrer noopener">stablehorde.net</a> for a free API key and faster generation.
          </small>
          <label className="setting-sub-label sp-sub-label">Stable Horde API Key</label>
          <input
            type="password"
            className="setting-input"
            value={(localSettings as any).stableHordeApiKey || ''}
            placeholder="Anonymous (slow) — paste your free key for faster results"
            onChange={(e) =>
              setLocalSettings({ ...localSettings, stableHordeApiKey: e.target.value } as any)
            }
          />
          <small className="setting-hint">Without a key, generation uses the anonymous queue (~60-120 s). A free registered key drops this to ~10-20 s.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">�🔍 Search API Keys (optional)</label>
          <small className="setting-hint sp-hint-mb">
            Add API keys for higher-quality web search results. Falls back to DuckDuckGo scraping if no keys are set.
          </small>
          <label className="setting-sub-label sp-sub-label">Tavily API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.tavilyApiKey || ''}
            placeholder="tvly-..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, tavilyApiKey: e.target.value })
            }
          />
          <small className="setting-hint">Primary search — AI-optimized results. Get a key at <a href="https://tavily.com" target="_blank" rel="noreferrer noopener">tavily.com</a></small>

          <label className="setting-sub-label sp-sub-label-mt8">Serper.dev API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.serperApiKey || ''}
            placeholder="Enter Serper.dev key..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, serperApiKey: e.target.value })
            }
          />
          <small className="setting-hint">Secondary search — Google results via API. Get a key at <a href="https://serper.dev" target="_blank" rel="noreferrer noopener">serper.dev</a></small>
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
          <div className="permission-grid space-y-2">
            {Object.keys(permissions).map((k) => {
              const isDangerous = DANGEROUS_PERMISSIONS.has(k);
              return (
                <div key={k} className="flex items-start gap-3">
                  <label
                    className="setting-label inline-flex items-center mr-3"
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
                    <span className="ml-2">
                      {isDangerous && <span className="sp-warn-icon">⚠</span>}
                      {k.replace(/_/g, ' ')}
                    </span>
                  </label>
                  <div>
                    <small className={isDangerous ? 'sp-perm-danger' : 'text-zinc-500'}>
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
            <button className="button button-secondary" onClick={() => setShowTelemetryDashboard(true)}>Open Telemetry Dashboard</button>
          </div>
          <div className="sp-telemetry-log">
            <pre className="sp-telemetry-pre">{telemetryLogPreview()}</pre>
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
        {showTelemetryDashboard && <TelemetryDashboard open={showTelemetryDashboard} onClose={() => setShowTelemetryDashboard(false)} /> }
      </div>

      {/* ── Scheduled Jobs ─────────────────────────────────────────────────── */}
      <div className="settings-section">
        <h3 className="settings-section-title sp-section-title">
          ⏰ Scheduled Jobs
          <small className="sp-section-subtitle">
            — recurring messages and reminders while SADIE is open
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
                    await (window as any).electron?.schedulerAdd?.({
                      name: jobForm.name.trim(),
                      message: jobForm.message.trim(),
                      intervalMinutes: jobForm.intervalMinutes,
                      dailyTime: jobForm.mode === 'daily' ? jobForm.dailyTime : undefined,
                      enabled: true,
                    });
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
            — extend SADIE with any Model Context Protocol server
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
                Changes take effect after restarting SADIE.
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
