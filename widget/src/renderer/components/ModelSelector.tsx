import { useState, useEffect, useRef } from 'react';
import type { CustomLLMConfig } from '../../shared/types';

interface ModelInfo {
  id: string;
  name: string;
  shortName: string;
  description: string;
  type: 'ollama' | 'custom';
  provider?: string;
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
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentModel,
  customLLM,
  useCustomLLM,
  onModelChange,
  onConfigureCustom,
  locked = false,
  lockedModelId,
  lockReason
}) => {
  const dropdownId = 'model-selector-menu';
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Available Ollama models with descriptions
  // Ordered by tool-calling capability (best first)
  const ollamaModels: ModelInfo[] = [
    {
      id: 'qwen2.5:7b',
      name: 'Qwen 2.5 (7B)',
      shortName: 'Qwen',
      description: '⭐ Best for tools & function calling (4.4GB)',
      type: 'ollama'
    },
    {
      id: 'llama3.2:3b',
      name: 'Llama 3.2 (3B)',
      shortName: 'Llama 3B',
      description: 'Fast, good tool support (2GB)',
      type: 'ollama'
    },
    {
      id: 'mistral:latest',
      name: 'Mistral',
      shortName: 'Mistral',
      description: 'Great conversation, weaker tools (4.4GB)',
      type: 'ollama'
    },
    {
      id: 'dolphin-llama3:8b',
      name: 'Dolphin Llama 3 (8B)',
      shortName: 'Dolphin',
      description: 'Uncensored chat, no tool calling (4.7GB)',
      type: 'ollama'
    },
    {
      id: 'llava:latest',
      name: 'LLaVA Vision',
      shortName: 'LLaVA',
      description: 'Image analysis only (4.7GB)',
      type: 'ollama'
    }
  ];

  // Custom LLM option
  const customModels: ModelInfo[] = customLLM?.enabled ? [
    {
      id: 'custom',
      name: customLLM.name || 'Custom API',
      shortName: customLLM.model?.split('/').pop()?.split(':')[0] || 'API',
      description: `${customLLM.provider?.toUpperCase() || 'Custom'} - ${customLLM.model || 'Not configured'}`,
      type: 'custom',
      provider: customLLM.provider
    }
  ] : [];

  const allModels = [...customModels, ...ollamaModels];

  // Get current model display info
  const forcedModelId = lockedModelId || 'dolphin-llama3:8b';

  const fallbackModel: ModelInfo = {
    id: forcedModelId,
    name: forcedModelId,
    shortName: 'Dolphin',
    description: 'Active while Uncensored Mode is enabled',
    type: 'ollama'
  };

  const getCurrentModelInfo = (): ModelInfo => {
    if (locked) {
      return ollamaModels.find(m => m.id === forcedModelId) || fallbackModel;
    }
    if (useCustomLLM && customModels.length > 0) {
      return customModels[0];
    }
    return ollamaModels.find(m => m.id === currentModel) || {
      id: currentModel,
      name: currentModel,
      shortName: currentModel.split(':')[0],
      description: 'Currently selected model',
      type: 'ollama'
    };
  };

  const currentModelInfo = getCurrentModelInfo();

  // Get current index for prev/next navigation
  const currentIndex = allModels.findIndex(m => 
    (useCustomLLM && m.type === 'custom') || m.id === currentModel
  );

  const handlePrevModel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (locked) return;
    const prevIndex = currentIndex <= 0 ? allModels.length - 1 : currentIndex - 1;
    const model = allModels[prevIndex];
    if (model.type === 'custom') {
      onModelChange(customLLM?.model || '', true);
    } else {
      onModelChange(model.id, false);
    }
  };

  const handleNextModel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (locked) return;
    const nextIndex = currentIndex >= allModels.length - 1 ? 0 : currentIndex + 1;
    const model = allModels[nextIndex];
    if (model.type === 'custom') {
      onModelChange(customLLM?.model || '', true);
    } else {
      onModelChange(model.id, false);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleSelectModel = (model: ModelInfo) => {
    if (locked) {
      return;
    }

    if (model.type === 'custom') {
      onModelChange(customLLM?.model || '', true);
    } else {
      onModelChange(model.id, false);
    }
    setIsOpen(false);
  };

  useEffect(() => {
    if (locked) {
      setIsOpen(false);
    }
  }, [locked]);

  return (
    <div className={`model-selector ${locked ? 'locked' : ''}`} ref={dropdownRef}>
      <div className="model-selector-row">
        {/* Prev button */}
        <button
          className="model-nav-btn"
          onClick={handlePrevModel}
          disabled={locked}
          title="Previous model"
          aria-label="Previous model"
        >
          ◀
        </button>

        {/* Main button showing current model */}
        <button 
          className="model-selector-button"
          type="button"
          onClick={() => {
            if (!locked) {
              setIsOpen(!isOpen);
            }
          }}
          title={locked ? (lockReason || 'Turn off Uncensored Mode to switch models') : `Using ${currentModelInfo?.name} — click to see all models`}
          aria-haspopup="menu"
          aria-controls={dropdownId}
          aria-expanded={isOpen ? 'true' : 'false'}
        >
          <div className="model-selector-current">
            <span className="model-icon">{useCustomLLM ? '☁️' : '🦙'}</span>
            <span className="model-name-display">{currentModelInfo?.shortName || currentModelInfo?.name || 'Select'}</span>
            {locked && <span className="model-lock-badge">🔒</span>}
            <span className={`dropdown-arrow ${isOpen ? 'open' : ''}`}>▼</span>
          </div>
        </button>

        {/* Next button */}
        <button
          className="model-nav-btn"
          onClick={handleNextModel}
          disabled={locked}
          title="Next model"
          aria-label="Next model"
        >
          ▶
        </button>
      </div>

      {locked && (
        <div className="model-lock-hint">
          🔒 {lockReason || 'Turn off Uncensored Mode to switch models'}
        </div>
      )}

      {isOpen && (
        <div id={dropdownId} className="model-dropdown" role="menu">
          <div className="model-dropdown-header">
            <span>Available Models</span>
            <button 
              className="add-custom-button"
              onClick={() => {
                setIsOpen(false);
                onConfigureCustom();
              }}
              title="Add custom API (OpenAI, Claude, etc.)"
            >
              + Add API
            </button>
          </div>

          <div className="model-list">
            {customModels.length > 0 && (
              <>
                <div className="model-section-label">Custom APIs</div>
                {customModels.map(model => (
                  <button
                    key={model.id}
                    className={`model-option ${useCustomLLM ? 'active' : ''}`}
                    onClick={() => handleSelectModel(model)}
                  >
                    <div className="model-option-header">
                      <span className="model-option-icon">
                        {model.provider === 'openai' ? '🔵' : 
                         model.provider === 'anthropic' ? '🟣' : 
                         model.provider === 'openrouter' ? '🔶' : '⚡'}
                      </span>
                      <span className="model-option-name">{model.name}</span>
                      {useCustomLLM && <span className="active-badge">✓</span>}
                    </div>
                    <span className="model-option-desc">{model.description}</span>
                  </button>
                ))}
              </>
            )}

            <div className="model-section-label">Local Ollama Models</div>
            {ollamaModels.map(model => (
              <button
                key={model.id}
                className={`model-option ${!useCustomLLM && currentModel === model.id ? 'active' : ''}`}
                onClick={() => handleSelectModel(model)}
              >
                <div className="model-option-header">
                  <span className="model-option-icon">🦙</span>
                  <span className="model-option-name">{model.name}</span>
                  {!useCustomLLM && currentModel === model.id && <span className="active-badge">✓</span>}
                </div>
                <span className="model-option-desc">{model.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
