/**
 * Choosing who answers: the cloud provider, its key, and its model.
 *
 * This lived inside AdvancedSettingsTab, which the Simple view does not render
 * — so after the panel gained Simple/Advanced, someone wanting to use their
 * Claude Pro subscription could not find the option at all. "Which model
 * answers" is the most basic setting in the panel and belongs beside the local
 * model picker, not behind a disclosure with the MCP ports.
 *
 * Rendered by ModelsSettingsTab, which appears in both views.
 */

import { useSettingsCtx } from './SettingsContext';
import { apiKeyForProvider } from '../../../shared/cloud-llm';

export default function CloudProviderSection() {
  const {
    defaultCustomLLM,
    getDefaultApiUrl,
    localSettings,
    setLocalSettings,
    availableModels,
    setAvailableModels,
    modelsLoading,
    modelFetchError,
    setModelFetchError,
    setModelsFetchedAt,
    selectedProvider,
    isClaudeCode,
    providerRequiresApiKey,
    hasApiKey,
    isConnected,
    handleFetchModels,
  } = useSettingsCtx();

  return (
        <div className="setting-group custom-llm-section">
          <label className="setting-label">☁️ Main chat model — Cloud API (OpenAI, Anthropic, Claude subscription…)</label>
          
          {/* Step 1: Provider Selection */}
          <div className="provider-row">
            <select
              aria-label="Cloud API provider"
              className="setting-input provider-select"
              value={selectedProvider}
              onChange={(e) => {
                const newProvider = e.target.value as any;
                // Show the key saved for the provider being switched TO, or
                // nothing.
                //
                // This used to start from `localSettings.customLLM?.apiKey` —
                // the key belonging to the provider being switched AWAY from —
                // and only overwrite it for the three providers named below.
                // Switching OpenAI -> Groq therefore left an sk-... OpenAI
                // secret sitting in a config aimed at api.groq.com, and
                // pressing Connect sent one vendor's credential to another
                // vendor's endpoint.
                //
                // An empty box is the correct answer when nothing is saved for
                // the new provider. Convenience is not worth misrouting a
                // credential.
                const autoFillKey = apiKeyForProvider(localSettings as any, newProvider);
                setLocalSettings({
                  ...localSettings,
                  customLLM: { 
                    ...localSettings.customLLM!, 
                    provider: newProvider,
                    apiUrl: getDefaultApiUrl(newProvider),
                    apiKey: autoFillKey,
                    model: '',
                    enabled: false
                  },
                  useCustomLLM: false
                });
                setAvailableModels([]);
                setModelFetchError(null);
                setModelsFetchedAt(null);
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="claude-code">Claude subscription — no API key (via Claude Code)</option>
              <option value="openrouter">OpenRouter (all models, one key)</option>
              <option value="groq">Groq (free tier — Llama, Gemma, Mixtral)</option>
              <option value="deepseek">DeepSeek (GPT-4 quality, ~20x cheaper)</option>
              <option value="google-ai-studio">Google AI Studio (Gemini, free tier)</option>
              <option value="google-gemini">Google Gemini Native API</option>
              <option value="huggingface">Hugging Face (free tier — open-source models)</option>
              <option value="cerebras">Cerebras (free tier — fastest inference)</option>
              <option value="sambanova">SambaNova (free tier — Llama, DeepSeek)</option>
              <option value="together">Together AI ($5 free credits, 200+ models)</option>
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
            {isClaudeCode ? (
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
                placeholder="Claude Code path (optional — leave blank to find it automatically)"
              />
            ) : (
              <input
                type="password"
                className="setting-input api-key-input"
                value={localSettings.customLLM?.apiKey || ''}
                onChange={(e) => {
                  const key = e.target.value;
                  const update: any = {
                    ...localSettings,
                    customLLM: { ...localSettings.customLLM!, apiKey: key },
                    // Record it against THIS provider straight away, so the
                    // saved-keys list below reflects the typing and switching
                    // provider can bring it back. Every provider lands here,
                    // not just the four with a dedicated field.
                    providerApiKeys: { ...(localSettings.providerApiKeys || {}), [selectedProvider]: key },
                  };
                  if (selectedProvider === 'anthropic') update.anthropicApiKey = key;
                  else if (selectedProvider === 'openai') update.openaiApiKey = key;
                  else if (selectedProvider === 'google-ai-studio' || selectedProvider === 'google-gemini') update.geminiApiKey = key;
                  else if (selectedProvider === 'moonshot') update.moonshotApiKey = key;
                  setLocalSettings(update);
                }}
                placeholder={
                  selectedProvider === 'openai' ? 'sk-...' :
                  selectedProvider === 'anthropic' ? 'sk-ant-...' :
                  selectedProvider === 'groq' ? 'gsk_...' :
                  selectedProvider === 'deepseek' ? 'sk-...' :
                  selectedProvider === 'google-ai-studio' ? 'AIza...' :
                  selectedProvider === 'google-gemini' ? 'AIza...' :
                  'API Key'
                }
              />
            )}
            <button
              type="button"
              className={`button connect-btn ${isConnected ? 'connected' : ''}`}
              onClick={handleFetchModels}
              disabled={modelsLoading || (providerRequiresApiKey && !hasApiKey)}
            >
              {modelsLoading ? '...' : isConnected ? '✓ Connected' : 'Connect'}
            </button>
          </div>

          {isClaudeCode && (
            <small className="setting-hint">
              Runs on your own Claude Pro/Max subscription through the Claude Code CLI — no API key, no per-token billing.
              Requires Claude Code installed and signed in on this machine. Replies count against your plan's usage limits.
              It can read and edit files, search your project and run commands — always through HomeBot's own permission
              prompt, never Claude Code's unsupervised tools. Leave the path blank unless Claude Code isn't on your PATH.
            </small>
          )}

          {modelFetchError && (
            <small className="setting-hint error-hint">{modelFetchError}</small>
          )}

          {/* Which providers already have a key.
              Thirteen providers share one input box, so without this the only
              way to find out whether you had saved a key for a given service
              was to select it and look. */}
          {(() => {
            const saved = Object.entries(localSettings.providerApiKeys || {})
              .filter(([, key]) => typeof key === 'string' && key.trim().length > 0)
              // google-ai-studio and google-gemini share one key; list it once.
              .filter(([provider]) => provider !== 'google-gemini')
              .map(([provider]) => provider)
              .sort();
            if (saved.length === 0) return null;
            return (
              <div className="sp-saved-keys" data-testid="saved-provider-keys">
                <small className="setting-hint">
                  Keys saved for {saved.length} {saved.length === 1 ? 'service' : 'services'}. Switching between them keeps each key.
                </small>
                <div className="sp-saved-keys-list">
                  {saved.map(provider => (
                    <span key={provider} className={`sp-saved-key${provider === selectedProvider ? ' current' : ''}`}>
                      {provider}
                      <button
                        type="button"
                        className="sp-saved-key-remove"
                        aria-label={`Remove the saved key for ${provider}`}
                        title={`Remove the saved key for ${provider}`}
                        onClick={() => {
                          // An explicit empty string is what clears one — the
                          // main process treats an omitted provider as
                          // "unchanged", so deleting the entry would not stick.
                          const cleared: any = {
                            ...localSettings,
                            providerApiKeys: {
                              ...(localSettings.providerApiKeys || {}),
                              [provider]: '',
                              ...(provider === 'google-ai-studio' ? { 'google-gemini': '' } : {}),
                            },
                          };
                          if (provider === 'anthropic') cleared.anthropicApiKey = '';
                          else if (provider === 'openai') cleared.openaiApiKey = '';
                          else if (provider === 'google-ai-studio') cleared.geminiApiKey = '';
                          else if (provider === 'moonshot') cleared.moonshotApiKey = '';
                          if (provider === selectedProvider) {
                            cleared.customLLM = { ...localSettings.customLLM!, apiKey: '' };
                          }
                          setLocalSettings(cleared);
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

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
                    {model.costHint && (
                      <span className="chip-cost">{model.costHint}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Status indicator */}
          {localSettings.customLLM?.enabled && localSettings.customLLM?.model && (
            <div className="custom-llm-status">
              <span className={`status-dot ${localSettings.useCustomLLM ? 'active' : ''}`}></span>
              {localSettings.useCustomLLM
                ? `Using ${localSettings.customLLM.model}`
                : `${localSettings.customLLM.model} is connected but NOT in use — tick the box below, then Save.`}
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
              <span>Use this API by default for chats</span>
            </label>
          )}

          {/* Creativity — unset means each provider's own default (0.5 for
              OpenAI-compatible APIs, 0.7 for Anthropic). Cloud only: local
              models keep their tuned values. */}
          {isConnected && (
            <div className="setting-group" style={{ marginTop: 8 }}>
              <label className="setting-label" htmlFor="chat-temperature">
                Response creativity{localSettings.chatTemperature == null ? ' (provider default)' : `: ${localSettings.chatTemperature.toFixed(2)}`}
              </label>
              <input
                id="chat-temperature"
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={localSettings.chatTemperature ?? 0.7}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    chatTemperature: Number(e.target.value)
                  })
                }
              />
              {localSettings.chatTemperature != null && (
                <button
                  type="button"
                  className="setting-link"
                  onClick={() => {
                    const next = { ...localSettings };
                    delete next.chatTemperature;
                    setLocalSettings(next);
                  }}
                >
                  Back to provider default
                </button>
              )}
            </div>
          )}
        </div>
  );
}
