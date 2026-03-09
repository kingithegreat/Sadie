/** @jest-environment jsdom */
/**
 * model-selector.test.tsx
 * Tests for src/renderer/components/ModelSelector.tsx
 */

import { render, screen, fireEvent } from '@testing-library/react';
import ModelSelector from '../components/ModelSelector';

const defaultProps = {
  currentModel: 'qwen2.5:7b',
  onModelChange: jest.fn(),
  onConfigureCustom: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ModelSelector — initial render', () => {
  test('renders Previous model button', () => {
    render(<ModelSelector {...defaultProps} />);
    expect(screen.getByRole('button', { name: /previous model/i })).toBeInTheDocument();
  });

  test('renders Next model button', () => {
    render(<ModelSelector {...defaultProps} />);
    expect(screen.getByRole('button', { name: /next model/i })).toBeInTheDocument();
  });

  test('shows shortName of the current model', () => {
    render(<ModelSelector {...defaultProps} currentModel="qwen2.5:7b" />);
    expect(screen.getByText('Qwen')).toBeInTheDocument();
  });

  test('shows shortName for unknown model using id split', () => {
    render(<ModelSelector {...defaultProps} currentModel="somemodel:latest" />);
    expect(screen.getByText('somemodel')).toBeInTheDocument();
  });

  test('dropdown is closed initially', () => {
    render(<ModelSelector {...defaultProps} />);
    expect(screen.queryByText('Available Models')).toBeNull();
  });
});

describe('ModelSelector — dropdown', () => {
  function getMainBtn() {
    return document.querySelector('.model-selector-button') as HTMLElement;
  }

  test('opens dropdown on main button click', () => {
    render(<ModelSelector {...defaultProps} />);
    fireEvent.click(getMainBtn());
    expect(screen.getByText('Available Models')).toBeInTheDocument();
  });

  test('lists Local Ollama Models section', () => {
    render(<ModelSelector {...defaultProps} />);
    fireEvent.click(getMainBtn());
    expect(screen.getByText('Local Ollama Models')).toBeInTheDocument();
  });

  test('lists known ollama models in the dropdown', () => {
    render(<ModelSelector {...defaultProps} />);
    fireEvent.click(getMainBtn());
    expect(screen.getByText('Qwen 2.5 (7B)')).toBeInTheDocument();
    expect(screen.getByText('Mistral')).toBeInTheDocument();
  });

  test('calls onConfigureCustom when + Add API is clicked', () => {
    const onConfigureCustom = jest.fn();
    render(<ModelSelector {...defaultProps} onConfigureCustom={onConfigureCustom} />);
    fireEvent.click(getMainBtn());
    fireEvent.click(screen.getByText('+ Add API'));
    expect(onConfigureCustom).toHaveBeenCalledTimes(1);
  });

  test('closes dropdown after + Add API click', () => {
    render(<ModelSelector {...defaultProps} />);
    fireEvent.click(getMainBtn());
    fireEvent.click(screen.getByText('+ Add API'));
    expect(screen.queryByText('Available Models')).toBeNull();
  });

  test('selecting a model calls onModelChange with correct id', () => {
    const onModelChange = jest.fn();
    render(<ModelSelector {...defaultProps} onModelChange={onModelChange} />);
    fireEvent.click(getMainBtn());
    // Click "Mistral" model option (by its full name in dropdown)
    fireEvent.click(screen.getByText('Mistral'));
    expect(onModelChange).toHaveBeenCalledWith('mistral:latest', false);
  });

  test('selecting a model closes the dropdown', () => {
    render(<ModelSelector {...defaultProps} />);
    fireEvent.click(getMainBtn());
    fireEvent.click(screen.getByText('Mistral'));
    expect(screen.queryByText('Available Models')).toBeNull();
  });

  test('clicking outside closes the dropdown', () => {
    render(<ModelSelector {...defaultProps} />);
    fireEvent.click(getMainBtn());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Available Models')).toBeNull();
  });
});

describe('ModelSelector — prev/next navigation', () => {
  test('Previous model button calls onModelChange with previous model', () => {
    const onModelChange = jest.fn();
    // qwen2.5:7b is index 0 in ollamaModels, so prev wraps to last
    render(<ModelSelector {...defaultProps} currentModel="qwen2.5:7b" onModelChange={onModelChange} />);
    fireEvent.click(screen.getByRole('button', { name: /previous model/i }));
    expect(onModelChange).toHaveBeenCalledTimes(1);
  });

  test('Next model button calls onModelChange with next model', () => {
    const onModelChange = jest.fn();
    render(<ModelSelector {...defaultProps} currentModel="qwen2.5:7b" onModelChange={onModelChange} />);
    fireEvent.click(screen.getByRole('button', { name: /next model/i }));
    expect(onModelChange).toHaveBeenCalledWith('llama3.2:3b', false);
  });

  test('Next wraps around after last model', () => {
    const onModelChange = jest.fn();
    render(<ModelSelector {...defaultProps} currentModel="llava:latest" onModelChange={onModelChange} />);
    fireEvent.click(screen.getByRole('button', { name: /next model/i }));
    // Should wrap back to first model
    expect(onModelChange).toHaveBeenCalledWith('qwen2.5:7b', false);
  });
});

describe('ModelSelector — locked state', () => {
  test('shows lock badge when locked', () => {
    render(<ModelSelector {...defaultProps} locked={true} />);
    expect(screen.getByText('🔒')).toBeInTheDocument();
  });

  test('Previous button is disabled when locked', () => {
    render(<ModelSelector {...defaultProps} locked={true} />);
    expect(screen.getByRole('button', { name: /previous model/i })).toBeDisabled();
  });

  test('Next button is disabled when locked', () => {
    render(<ModelSelector {...defaultProps} locked={true} />);
    expect(screen.getByRole('button', { name: /next model/i })).toBeDisabled();
  });

  test('clicking main button does NOT open dropdown when locked', () => {
    render(<ModelSelector {...defaultProps} locked={true} />);
    const mainBtn = document.querySelector('.model-selector-button') as HTMLElement;
    fireEvent.click(mainBtn);
    expect(screen.queryByText('Available Models')).toBeNull();
  });

  test('shows custom lockReason hint', () => {
    render(<ModelSelector {...defaultProps} locked={true} lockReason="Uncensored mode active" />);
    expect(screen.getByText(/Uncensored mode active/)).toBeInTheDocument();
  });

  test('does not call onModelChange when prev clicked while locked', () => {
    const onModelChange = jest.fn();
    render(<ModelSelector {...defaultProps} locked={true} onModelChange={onModelChange} />);
    fireEvent.click(screen.getByRole('button', { name: /previous model/i }));
    expect(onModelChange).not.toHaveBeenCalled();
  });
});

describe('ModelSelector — custom LLM', () => {
  const customLLM = {
    enabled: true,
    provider: 'openai' as const,
    name: 'My GPT-4',
    model: 'gpt-4',
    apiKey: '',
    apiUrl: '',
  };

  test('shows Custom APIs section when customLLM is enabled', () => {
    render(
      <ModelSelector
        {...defaultProps}
        customLLM={customLLM}
        useCustomLLM={true}
      />
    );
    fireEvent.click(document.querySelector('.model-selector-button') as HTMLElement);
    expect(screen.getByText('Custom APIs')).toBeInTheDocument();
  });

  test('shows custom model name in the dropdown', () => {
    render(
      <ModelSelector
        {...defaultProps}
        customLLM={customLLM}
        useCustomLLM={true}
      />
    );
    fireEvent.click(document.querySelector('.model-selector-button') as HTMLElement);
    expect(screen.getByText('My GPT-4')).toBeInTheDocument();
  });

  test('shows cloud icon when useCustomLLM is true', () => {
    render(
      <ModelSelector {...defaultProps} customLLM={customLLM} useCustomLLM={true} />
    );
    expect(screen.getByText('☁️')).toBeInTheDocument();
  });
});
