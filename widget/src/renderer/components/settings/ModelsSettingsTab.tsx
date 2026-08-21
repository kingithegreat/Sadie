/**
 * Which model answers: the local model choices, routing, and the cloud provider setup.
 *
 * Moved verbatim out of SettingsPanel.tsx; the controls and their bindings are
 * unchanged. State comes from useSettingsCtx().
 */

import { useSettingsCtx } from './SettingsContext';
import CloudProviderSection from './CloudProviderSection';
import type { Settings } from './useSettingsState';


export default function ModelsSettingsTab() {
  const {
    defaultModels,
    ollamaModels,
    localSettings,
    setLocalSettings,
    installedOllamaModels,
    openSections,
    toggleSection,
    effectiveVramGB,
    getModelFit,
    modelFitLabel,
  } = useSettingsCtx();

  return (
    <>
      <CloudProviderSection />

        {/* ── Models ── */}
        <button type="button" className={`sp-section-toggle${openSections.models ? ' open' : ''}`} onClick={() => toggleSection('models')}>
          <span className="sp-section-arrow">{openSections.models ? '▾' : '▸'}</span> Models
        </button>
        {openSections.models && <>
        <div className="setting-group">
          <label className="setting-label">Chat model</label>
          <div className="model-grid">
            {/* Show installed Ollama models with hardware-aware recommendations. */}
            {(installedOllamaModels.length > 0
              ? installedOllamaModels.map(m => {
                  const known = ollamaModels.find(o => m.name === o.id || m.name.startsWith(o.id.split(':')[0]));
                  return {
                    id: m.name,
                    name: known?.name || m.name,
                    description: known?.description || `${(m.size / (1024*1024*1024)).toFixed(1)}GB`,
                    sizeGB: known?.sizeGB || (m.size / (1024*1024*1024)),
                    recommendedFor: known?.recommendedFor,
                    installed: true,
                  };
                })
              : ollamaModels.map(m => ({ ...m, installed: false }))
            ).sort((a, b) => {
              const rank: Record<string, number> = { recommended: 0, ok: 1, tight: 2, over: 3, unknown: 4 };
              return (rank[getModelFit(a)] ?? 4) - (rank[getModelFit(b)] ?? 4);
            }).map((model) => {
              const fit = getModelFit(model);
              const fitLabel = modelFitLabel(fit);
              return (
                <button
                  key={model.id}
                  className={`model-card ${localSettings.chatModel === model.id ? 'active' : ''} ${fit !== 'ok' && fit !== 'unknown' ? `model-fit-${fit}` : ''}`}
                  title={fit === 'over' ? `This model is larger than the detected ${effectiveVramGB} GB VRAM and may fall back to CPU or fail to load.` : undefined}
                  onClick={() =>
                    setLocalSettings({
                      ...localSettings,
                      chatModel: model.id
                    })
                  }
                >
                  <div className="model-card-label">
                    {model.name}
                    {fitLabel && <span className="model-fit-badge">{fitLabel}</span>}
                  </div>
                  <p className="model-card-desc">{model.description}</p>
                </button>
              );
            })}
          </div>
          <small className="setting-hint">
            {installedOllamaModels.length > 0
              ? `Showing ${installedOllamaModels.length} installed model(s). Recommendations are based on ${effectiveVramGB ? `${effectiveVramGB} GB VRAM` : 'your hardware profile'}; you can still choose any model.`
              : 'Ollama offline — showing recommended models. Custom APIs override this.'}
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Model routing</label>
          <select
            aria-label="Model routing mode"
            className="setting-input"
            value={localSettings.modelRoutingMode || 'prompt'}
            onChange={(e) => setLocalSettings({
              ...localSettings,
              modelRoutingMode: e.target.value as 'off' | 'prompt' | 'auto'
            })}
          >
            <option value="off">Off — never override my chosen model</option>
            <option value="prompt">Prompt — suggest a better model for the task</option>
            <option value="auto">Auto — switch requests automatically</option>
          </select>
          <small className="setting-hint">Controls whether HomeBot only suggests stronger local models for a task or applies them automatically.</small>
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
          <small className="setting-hint">Local Ollama model for coding. Leave blank to use the chat model. Recommended: <code>qwen2.5-coder:7b</code> (~4.4GB VRAM). If a Code API key is set below, it takes priority over this.</small>
        </div>
        </>}


        {/* ── Cloud & Integration ── */}
        <button type="button" className={`sp-section-toggle${openSections.cloud ? ' open' : ''}`} onClick={() => toggleSection('cloud')}>
          <span className="sp-section-arrow">{openSections.cloud ? '▾' : '▸'}</span> Cloud &amp; Integration
        </button>
        {openSections.cloud && <>
        <div className="setting-group">
          <label className="setting-label">🔑 Coding questions only — Cloud API (optional)</label>
          <div className="api-key-row">
            <select
              className="setting-input provider-select"
              title="Code API provider"
              value={(localSettings as any).codeApiProvider || 'openai'}
              onChange={(e) => setLocalSettings({ ...localSettings, codeApiProvider: e.target.value as any } as any)}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
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
          <small className="setting-hint">This affects <strong>coding questions only</strong> — it is not your main chat model. To change the model that answers everything else, use <strong>Cloud API</strong> under <em>API Keys &amp; Cloud LLM</em> further down. The model name comes from the <em>Code model</em> field above (e.g. <code>gpt-4o</code>, <code>claude-sonnet-5</code>). Leave blank to use local Ollama.</small>
        </div>
        {/* Hardware Profile — applies safe model defaults for the card's VRAM */}
        <div className="setting-group">
          <label className="setting-label">🖥️ Hardware Profile</label>
          <div className="density-options">
            {(['4gb', '8gb', '16gb+'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`hw-profile-btn${localSettings.hardwareProfile === p ? ' active' : ''}`}
                onClick={() => {
                  const profileDefaults: Record<string, Partial<Settings>> = {
                    '4gb':   { chatModel: 'qwen2.5:7b', visionModel: 'moondream', uncensoredModel: 'dolphin-mistral:7b', moaEnabled: false },
                    '8gb':   { chatModel: 'qwen2.5:7b', visionModel: 'moondream', uncensoredModel: 'dolphin-mistral:7b', moaEnabled: false },
                    '16gb+': { chatModel: 'qwen2.5:7b',  visionModel: 'moondream',  uncensoredModel: 'dolphin-mistral:7b' },
                  };
                  setLocalSettings({ ...localSettings, ...(profileDefaults[p] || {}), hardwareProfile: p });
                }}
              >
                {p === '4gb' ? '4 GB' : p === '8gb' ? '8 GB' : '16 GB+'}
              </button>
            ))}
          </div>
          <small className="setting-hint">
            Applies safe model defaults for your GPU.&nbsp;
            <strong>4 GB:</strong> qwen2.5:7b + moondream.&nbsp;
            <strong>8 GB:</strong> qwen2.5:7b + moondream.&nbsp;
            <strong>16 GB+:</strong> gemma4:e4b + moondream + MoA recommended.
            Auto-detected on first launch — only change if it was wrong.
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Default Location</label>
          <input
            type="text"
            className="setting-input"
            value={(localSettings as any).defaultLocation || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                defaultLocation: e.target.value
              } as any)
            }
            placeholder="e.g. Auckland, London, New York"
          />
          <small className="setting-hint">Used for weather queries when you don't specify a location.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Chat Guidelines</label>
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
        </>}

    </>
  );
}
