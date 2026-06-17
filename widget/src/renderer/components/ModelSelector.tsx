import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { CustomLLMConfig, CustomModelInfo } from '../../shared/types';

interface OllamaModel {
  name: string;
  size: number;
  modifiedAt: string;
  details: any;
}

interface ModelInfo {
  id: string;
  name: string;
  shortName: string;
  description: string;
  type: 'ollama' | 'custom';
  provider?: string;
  installed?: boolean;
  sizeGB?: number;
  costHint?: string;
}

interface ModelSelectorProps {
  currentModel: string;
  customLLM?: CustomLLMConfig;
  useCustomLLM?: boolean;
  onModelChange: (model: string, useCustom: boolean) => void;
  onConfigureCustom: () => void;
  locked?: boolean;
  lockedModelId?: string;
  lockReason?: string;
  vramGB?: number | null;
}

// Well-known models with descriptions — shown even if not installed (with a "pull" option)
const RECOMMENDED_MODELS: ModelInfo[] = [
  { id: 'qwen2.5:7b', name: 'Qwen 2.5 (7B)', shortName: 'Qwen 7B', description: 'Smartest local model — best tool use & reasoning (4.4GB)', type: 'ollama', sizeGB: 4.4 },
  { id: 'qwen2.5:14b', name: 'Qwen 2.5 (14B)', shortName: 'Qwen 14B', description: 'Stronger reasoning and coding for bigger GPUs (8.2GB)', type: 'ollama', sizeGB: 8.2 },
  { id: 'gemma4:e4b', name: 'Gemma 4 (E4B)', shortName: 'Gemma4 E4B', description: 'Google quality-focused Gemma 4 — strong general chat, but heavier (~5.5GB)', type: 'ollama', sizeGB: 5.5 },
  { id: 'gemma4:e2b', name: 'Gemma 4 (E2B)', shortName: 'Gemma4 E2B', description: 'Lighter Gemma 4 option for modest hardware (~3GB)', type: 'ollama', sizeGB: 3.0 },
  { id: 'gemma3:4b', name: 'Gemma 3 (4B)', shortName: 'Gemma3 4B', description: 'Google lightweight — vision & multilingual (3.3GB)', type: 'ollama', sizeGB: 3.3 },
  { id: 'mistral:latest', name: 'Mistral (7B)', shortName: 'Mistral', description: 'Best conversation quality (4.4GB)', type: 'ollama', sizeGB: 4.4 },
  { id: 'mistral-small:latest', name: 'Mistral Small (24B)', shortName: 'Mistral Sm', description: 'Powerful reasoning, function calling (14GB)', type: 'ollama', sizeGB: 14 },
  { id: 'mistral-nemo:latest', name: 'Mistral Nemo (12B)', shortName: 'Nemo', description: 'Great all-rounder, 128K context (7.1GB)', type: 'ollama', sizeGB: 7.1 },
  { id: 'deepseek-r1:8b', name: 'DeepSeek R1 (8B)', shortName: 'DS-R1 8B', description: 'Chain-of-thought reasoning, slower but precise (4.9GB)', type: 'ollama', sizeGB: 4.9 },
  { id: 'phi4-mini', name: 'Phi 4 Mini (3.8B)', shortName: 'Phi4', description: 'Best reasoning for small VRAM (2.5GB)', type: 'ollama', sizeGB: 2.5 },
  { id: 'qwen2.5:3b', name: 'Qwen 2.5 (3B)', shortName: 'Qwen 3B', description: 'Good tool-calling, lightweight (2GB)', type: 'ollama', sizeGB: 2 },
  { id: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder (7B)', shortName: 'Coder 7B', description: 'Best coding model (4.4GB)', type: 'ollama', sizeGB: 4.4 },
  { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder (14B)', shortName: 'Coder 14B', description: 'Higher-end local coding quality (8.2GB)', type: 'ollama', sizeGB: 8.2 },
  { id: 'llama3.1:8b', name: 'Llama 3.1 (8B)', shortName: 'Llama 8B', description: 'Strong general-purpose (4.7GB)', type: 'ollama', sizeGB: 4.7 },
  { id: 'llama3.1:70b', name: 'Llama 3.1 (70B)', shortName: 'Llama 70B', description: 'Top-tier local quality for high-end rigs (43GB)', type: 'ollama', sizeGB: 43 },
  { id: 'llama3.2:3b', name: 'Llama 3.2 (3B)', shortName: 'Llama 3B', description: 'Reliable general chat (2GB)', type: 'ollama', sizeGB: 2 },
];

function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

function normalizeModelId(id: string): string {
  return (id || '').toLowerCase().replace(/:latest$/, '').replace(/[^a-z0-9]/g, '');
}

function getVramWarning(modelSizeGB: number | undefined, vramGB: number | null | undefined): 'ok' | 'tight' | 'over' {
  if (!vramGB || !modelSizeGB) return 'ok';
  if (modelSizeGB > vramGB) return 'over';
  if (modelSizeGB > vramGB * 0.8) return 'tight';
  return 'ok';
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentModel,
  customLLM,
  useCustomLLM,
  onModelChange,
  onConfigureCustom,
  locked = false,
  lockedModelId,
  lockReason,
  vramGB
}) => {
  const dropdownId = 'model-selector-menu';
  const [isOpen, setIsOpen] = useState(false);
  const [installedModels, setInstalledModels] = useState<OllamaModel[]>([]);
  const [cloudModels, setCloudModels] = useState<CustomModelInfo[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [vramWarning, setVramWarning] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Fetch installed Ollama models
  const fetchModels = useCallback(async () => {
    try {
      const result = await window.electron?.listOllamaModels?.();
      if (result?.success && result.models) {
        setInstalledModels(result.models);
      } else {
        setTimeout(async () => {
          try {
            const retry = await window.electron?.listOllamaModels?.();
            if (retry?.success && retry.models) setInstalledModels(retry.models);
          } catch { /* still offline */ }
        }, 2000);
      }
    } catch { /* Ollama offline */ }
  }, []);

  // Fetch available cloud models for configured provider
  const fetchCloudModels = useCallback(async () => {
    if (!customLLM?.enabled || !customLLM.apiUrl) return;
    setCloudLoading(true);
    try {
      const result = await window.electron?.listCustomLLMModels?.({
        apiUrl: customLLM.apiUrl,
        apiKey: customLLM.apiKey,
        provider: customLLM.provider,
      });
      if (result?.success && result.models) {
        setCloudModels(result.models);
      }
    } catch { /* failed to fetch */ }
    setCloudLoading(false);
  }, [customLLM?.enabled, customLLM?.apiUrl, customLLM?.apiKey, customLLM?.provider]);

  useEffect(() => {
    fetchModels();
    const interval = setInterval(fetchModels, 30000);
    return () => clearInterval(interval);
  }, [fetchModels]);

  // Fetch cloud models on mount if provider is configured
  useEffect(() => {
    if (customLLM?.enabled) fetchCloudModels();
  }, [customLLM?.enabled, fetchCloudModels]);

  // Refresh both when dropdown opens
  useEffect(() => {
    if (isOpen) {
      fetchModels();
      if (customLLM?.enabled) fetchCloudModels();
    }
  }, [isOpen, fetchModels, fetchCloudModels, customLLM?.enabled]);

  // Build the merged model list: installed models first, then recommended uninstalled ones
  const installedModelInfos: ModelInfo[] = installedModels.map(m => {
    const recommended = RECOMMENDED_MODELS.find(r => normalizeModelId(r.id) === normalizeModelId(m.name));
    return {
      id: m.name,
      name: recommended?.name || m.name,
      shortName: recommended?.shortName || m.name.split(':')[0],
      description: recommended?.description || formatSize(m.size),
      type: 'ollama' as const,
      installed: true,
      sizeGB: m.size / (1024 * 1024 * 1024),
    };
  });

  const uninstalledRecommended = RECOMMENDED_MODELS.filter(
    r => !installedModels.some(m => normalizeModelId(m.name) === normalizeModelId(r.id))
  ).map(r => ({ ...r, installed: false }));

  // Build cloud model list from fetched provider models
  const customModelInfos: ModelInfo[] = cloudModels.map(cm => ({
    id: cm.id,
    name: cm.name || cm.id,
    shortName: (cm.name || cm.id).split('/').pop()?.split(':')[0] || cm.id,
    description: [cm.description, cm.costHint].filter(Boolean).join(' — '),
    type: 'custom' as const,
    provider: cm.provider || customLLM?.provider,
    installed: true,
    costHint: cm.costHint,
  }));

  // Fallback: if cloud fetch returned nothing but we have a configured model, show it
  if (customModelInfos.length === 0 && customLLM?.enabled) {
    customModelInfos.push({
      id: customLLM.model || 'custom',
      name: customLLM.name || 'Custom API',
      shortName: customLLM.model?.split('/').pop()?.split(':')[0] || 'API',
      description: `${customLLM.provider?.toUpperCase() || 'Custom'} — ${customLLM.model || 'Not configured'}`,
      type: 'custom',
      provider: customLLM.provider,
      installed: true,
    });
  }

  const allModels = [...customModelInfos, ...installedModelInfos];

  const forcedModelId = lockedModelId || 'qwen2.5:7b';

  const activeCustomModelId = customLLM?.model || '';

  const getCurrentModelInfo = (): ModelInfo => {
    if (locked) {
      return allModels.find(m => m.id === forcedModelId) || {
        id: forcedModelId, name: forcedModelId, shortName: forcedModelId.split(':')[0],
        description: 'Active while Uncensored Mode is enabled', type: 'ollama', installed: true,
      };
    }
    if (useCustomLLM && customModelInfos.length > 0) {
      return customModelInfos.find(m => m.id === activeCustomModelId) || customModelInfos[0];
    }
    return allModels.find(m => normalizeModelId(m.id) === normalizeModelId(currentModel)) || {
      id: currentModel, name: currentModel, shortName: currentModel.split(':')[0],
      description: 'Currently selected model', type: 'ollama', installed: true,
    };
  };

  const currentModelInfo = getCurrentModelInfo();

  // Prev/next navigation through all models
  const currentIndex = allModels.findIndex(m => {
    if (useCustomLLM && m.type === 'custom') return m.id === activeCustomModelId;
    return normalizeModelId(m.id) === normalizeModelId(currentModel);
  });

  const selectModelWithVramCheck = (model: ModelInfo) => {
    const warn = getVramWarning(model.sizeGB, vramGB);
    if (warn === 'over') {
      setVramWarning(`⚠️ ${model.name} needs ~${model.sizeGB}GB VRAM — may run slowly on your GPU (CPU offload)`);
      setTimeout(() => setVramWarning(null), 5000);
    } else {
      setVramWarning(null);
    }
    onModelChange(model.id, model.type === 'custom');
  };

  const handlePrevModel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (locked || allModels.length === 0) return;
    const prevIndex = currentIndex <= 0 ? allModels.length - 1 : currentIndex - 1;
    selectModelWithVramCheck(allModels[prevIndex]);
  };

  const handleNextModel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (locked || allModels.length === 0) return;
    const nextIndex = currentIndex >= allModels.length - 1 ? 0 : currentIndex + 1;
    selectModelWithVramCheck(allModels[nextIndex]);
  };

  const handleSelectModel = (model: ModelInfo) => {
    if (locked) return;
    selectModelWithVramCheck(model);
    setIsOpen(false);
  };

  const handlePullModel = async (modelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPulling(modelId);
    setPullError(null);
    try {
      const result = await window.electron?.pullModel?.(modelId);
      if (result?.success) {
        await fetchModels();
        setPulling(null);
      } else {
        setPullError(result?.error || 'Pull failed');
        setPulling(null);
      }
    } catch (err: any) {
      setPullError(err.message || 'Pull failed');
      setPulling(null);
    }
  };

  // Close dropdown on outside click (portal-aware)
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inDropdown = dropdownRef.current?.contains(target);
      const inButton = buttonRef.current?.contains(target);
      if (!inDropdown && !inButton) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  useEffect(() => { if (locked) setIsOpen(false); }, [locked]);

  const providerLabel = customLLM?.provider
    ? customLLM.provider.charAt(0).toUpperCase() + customLLM.provider.slice(1)
    : 'Cloud API';

  return (
    <div className={`model-selector ${locked ? 'locked' : ''}`} ref={dropdownRef}>
      <div className="model-selector-row">
        <button className="model-nav-btn" onClick={handlePrevModel} disabled={locked} title="Previous model" aria-label="Previous model">◀</button>

        <button
          ref={buttonRef}
          className="model-selector-button"
          type="button"
          onClick={() => {
            if (locked) return;
            if (!isOpen) {
              setDropdownPos({ top: 100, left: Math.max(20, (window.innerWidth - 380) / 2), width: 380 });
            }
            setIsOpen(!isOpen);
          }}
          title={locked ? (lockReason || 'Turn off Uncensored Mode to switch models') : `Using ${currentModelInfo?.name} — click to see all models`}
          aria-haspopup="menu"
          aria-controls={dropdownId}
          aria-expanded={isOpen ? 'true' : 'false'}
        >
          <div className="model-selector-current">
            <span className="model-icon">{currentModelInfo?.type === 'custom' ? '☁️' : '🦙'}</span>
            <span className="model-name-display">{currentModelInfo?.shortName || currentModelInfo?.name || 'Select'}</span>
            {locked && <span className="model-lock-badge">🔒</span>}
            <span className={`dropdown-arrow ${isOpen ? 'open' : ''}`}>▼</span>
          </div>
        </button>

        <button className="model-nav-btn" onClick={handleNextModel} disabled={locked} title="Next model" aria-label="Next model">▶</button>
      </div>

      {locked && (
        <div className="model-lock-hint">🔒 {lockReason || 'Turn off Uncensored Mode to switch models'}</div>
      )}

      {vramWarning && (
        <div className="model-vram-warning">{vramWarning}</div>
      )}

      {isOpen && dropdownPos && createPortal(
        <div
          id={dropdownId}
          className="model-dropdown model-dropdown--portal"
          ref={dropdownRef}
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          <div className="model-dropdown-header">
            <span>Models</span>
            <button
              className="add-custom-button"
              type="button"
              onClick={() => { setIsOpen(false); onConfigureCustom(); }}
              title="Add custom API (OpenAI, Claude, etc.)"
            >
              + Cloud API
            </button>
          </div>

          <div className="model-list">
            {/* Cloud API models */}
            {customLLM?.enabled && (
              <>
                <div className="model-section-label">
                  ☁️ {providerLabel}
                  {cloudLoading && <span className="cloud-loading"> loading...</span>}
                </div>
                {customModelInfos.map(model => {
                  const isActive = useCustomLLM && model.id === activeCustomModelId;
                  return (
                    <button key={model.id}
                      className={`model-option ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelectModel(model)}>
                      <div className="model-option-header">
                        <span className="model-option-icon">☁️</span>
                        <span className="model-option-name">{model.name}</span>
                        {model.costHint && <span className="model-cost-badge">{model.costHint}</span>}
                        {isActive && <span className="active-badge">✓</span>}
                      </div>
                      <span className="model-option-desc">{model.description}</span>
                    </button>
                  );
                })}
              </>
            )}

            {/* Installed local models */}
            {installedModelInfos.length > 0 && (
              <>
                <div className="model-section-label">🦙 Installed ({installedModelInfos.length})</div>
                {installedModelInfos.map(model => {
                  const warn = getVramWarning(model.sizeGB, vramGB);
                  return (
                    <button key={model.id}
                      className={`model-option ${!useCustomLLM && normalizeModelId(currentModel) === normalizeModelId(model.id) ? 'active' : ''} ${warn !== 'ok' ? 'vram-warn' : ''}`}
                      onClick={() => handleSelectModel(model)}>
                      <div className="model-option-header">
                        <span className="model-option-icon">🦙</span>
                        <span className="model-option-name">{model.name}</span>
                        <span className="model-size-badge">{model.sizeGB ? `${model.sizeGB.toFixed(1)}GB` : ''}</span>
                        {warn === 'over' && <span className="vram-badge over" title={`Exceeds ${vramGB}GB VRAM — will use CPU offload (slow)`}>⚠️ slow</span>}
                        {warn === 'tight' && <span className="vram-badge tight" title={`Tight fit for ${vramGB}GB VRAM`}>⚡ tight</span>}
                        {!useCustomLLM && normalizeModelId(currentModel) === normalizeModelId(model.id) && <span className="active-badge">✓</span>}
                      </div>
                      <span className="model-option-desc">{model.description}</span>
                    </button>
                  );
                })}
              </>
            )}

            {/* Recommended models not yet installed */}
            {uninstalledRecommended.length > 0 && (
              <>
                <div className="model-section-label">📦 Available to Download</div>
                {uninstalledRecommended.map(model => {
                  const warn = getVramWarning(model.sizeGB, vramGB);
                  return (
                    <div key={model.id} className={`model-option not-installed ${warn !== 'ok' ? 'vram-warn' : ''}`}>
                      <div className="model-option-header">
                        <span className="model-option-icon">📦</span>
                        <span className="model-option-name">{model.name}</span>
                        <span className="model-size-badge">{model.sizeGB ? `${model.sizeGB}GB` : ''}</span>
                        {warn === 'over' && <span className="vram-badge over" title={`Exceeds ${vramGB}GB VRAM`}>⚠️</span>}
                        {warn === 'tight' && <span className="vram-badge tight" title={`Tight fit for ${vramGB}GB VRAM`}>⚡</span>}
                        <button
                          type="button"
                          className="pull-model-btn"
                          onClick={(e) => handlePullModel(model.id, e)}
                          disabled={pulling !== null}
                        >
                          {pulling === model.id ? '⏳ Pulling...' : '⬇ Pull'}
                        </button>
                      </div>
                      <span className="model-option-desc">{model.description}</span>
                    </div>
                  );
                })}
              </>
            )}

            {/* No models at all */}
            {installedModelInfos.length === 0 && !customLLM?.enabled && (
              <div className="model-option-empty">
                No models found. Is Ollama running?
              </div>
            )}

            {pullError && (
              <div className="model-pull-error">⚠️ {pullError}</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ModelSelector;
