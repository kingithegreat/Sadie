import { useState, useEffect, useRef } from 'react';
import type { CustomLLMConfig } from '../../shared/types';

interface ModelInfo {
  id: string;
  name: string;
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
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentModel,
  customLLM,
  useCustomLLM,
  onModelChange,
  onConfigureCustom
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Available Ollama models with descriptions
  const ollamaModels: ModelInfo[] = [
    {
      id: 'llama3.2:3b',
      name: 'Llama 3.2 (3B)',
      description: 'Fast, efficient model for everyday chat and simple tasks',
      type: 'ollama'
    },
    {
      id: 'llama3.2:latest',
      name: 'Llama 3.2',
      description: 'Balanced performance for general conversation and coding',
      type: 'ollama'
    },
    {
      id: 'dolphin-llama3:8b',
      name: 'Dolphin Llama 3',
      description: 'Uncensored model for unrestricted conversations',
      type: 'ollama'
    },
    {
      id: 'llava',
      name: 'LLaVA Vision',
      description: 'Multimodal model for analyzing images and screenshots',
      type: 'ollama'
    },
    {
      id: 'codellama',
      name: 'Code Llama',
      description: 'Specialized for code generation and technical tasks',
      type: 'ollama'
    },
    {
      id: 'mistral:latest',
      name: 'Mistral (latest)',
      description: 'High-quality open model for complex reasoning',
      type: 'ollama'
    }
  ];

  // Custom LLM option
  const customModels: ModelInfo[] = customLLM?.enabled ? [
    {
      id: 'custom',
      name: customLLM.name || 'Custom API',
      description: `${customLLM.provider?.toUpperCase() || 'Custom'} - ${customLLM.model || 'Not configured'}`,
      type: 'custom',
      provider: customLLM.provider
    }
  ] : [];

  const allModels = [...customModels, ...ollamaModels];

  // Get current model display info
  const getCurrentModelInfo = (): ModelInfo | undefined => {
    if (useCustomLLM && customModels.length > 0) {
      return customModels[0];
    }
    return ollamaModels.find(m => m.id === currentModel) || ollamaModels[0];
  };

  const currentModelInfo = getCurrentModelInfo();

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
    if (model.type === 'custom') {
      onModelChange(customLLM?.model || '', true);
    } else {
      onModelChange(model.id, false);
    }
    setIsOpen(false);
  };

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button 
        className="model-selector-button"
        onClick={() => setIsOpen(!isOpen)}
        title="Switch AI model"
      >
        <div className="model-selector-current">
          <span className="model-icon">🤖</span>
          <div className="model-info">
            <span className="model-name">{currentModelInfo?.name || 'Select Model'}</span>
            <span className="model-desc">{currentModelInfo?.description || ''}</span>
          </div>
          <span className={`dropdown-arrow ${isOpen ? 'open' : ''}`}>▼</span>
        </div>
      </button>

      {isOpen && (
        <div className="model-dropdown">
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
