/** @jest-environment jsdom */
/**
 * model-selector.test.tsx
 * Tests for src/renderer/components/ModelSelector.tsx
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import ModelSelector from '../components/ModelSelector';

// Mock Ollama models returned by listOllamaModels
const mockInstalledModels = [
  { name: 'qwen2.5:7b', size: 4.4 * 1024 * 1024 * 1024, modifiedAt: '2024-01-01', details: {} },
  { name: 'mistral:latest', size: 4.4 * 1024 * 1024 * 1024, modifiedAt: '2024-01-01', details: {} },
  { name: 'phi4-mini', size: 2.5 * 1024 * 1024 * 1024, modifiedAt: '2024-01-01', details: {} },
];

const mockListOllamaModels = jest.fn().mockResolvedValue({ success: true, models: mockInstalledModels });
const mockPullModel = jest.fn().mockResolvedValue({ success: true });

// Set up window.electron mock
beforeAll(() => {
  (window as any).electron = {
    listOllamaModels: mockListOllamaModels,
    pullModel: mockPullModel,
  };
});

const defaultProps = {
  currentModel: 'qwen2.5:7b',
  onModelChange: jest.fn(),
  onConfigureCustom: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListOllamaModels.mockResolvedValue({ success: true, models: mockInstalledModels });
});

// Helper: render and wait for async model fetch
async function renderSelector(props = {}) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<ModelSelector {...defaultProps} {...props} />);
  });
  return result!;
}

describe('ModelSelector — initial render', () => {
  test('renders Previous model button', async () => {
    await renderSelector();
    expect(screen.getByRole('button', { name: /previous model/i })).toBeInTheDocument();
  });

  test('renders Next model button', async () => {
    await renderSelector();
    expect(screen.getByRole('button', { name: /next model/i })).toBeInTheDocument();
  });

  test('shows shortName of the current model', async () => {
    await renderSelector({ currentModel: 'qwen2.5:7b' });
    expect(screen.getByText('Qwen 7B')).toBeInTheDocument();
  });

  test('shows shortName for unknown model using id split', async () => {
    await renderSelector({ currentModel: 'somemodel:latest' });
    expect(screen.getByText('somemodel')).toBeInTheDocument();
  });

  test('dropdown is closed initially', async () => {
    await renderSelector();
    expect(screen.queryByText('Models')).toBeNull();
  });
});

describe('ModelSelector — dropdown', () => {
  function getMainBtn() {
    return document.querySelector('.model-selector-button') as HTMLElement;
  }

  test('opens dropdown on main button click', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.getByText('Models')).toBeInTheDocument();
  });

  test('lists Installed section with model count', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.getByText(/Installed \(3\)/)).toBeInTheDocument();
  });

  test('lists installed ollama models in the dropdown', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.getByText('Qwen 2.5 (7B)')).toBeInTheDocument();
    expect(screen.getByText('Mistral (7B)')).toBeInTheDocument();
  });

  test('calls onConfigureCustom when + Cloud API is clicked', async () => {
    const onConfigureCustom = jest.fn();
    await renderSelector({ onConfigureCustom });
    await act(async () => { fireEvent.click(getMainBtn()); });
    fireEvent.click(screen.getByText('+ Cloud API'));
    expect(onConfigureCustom).toHaveBeenCalledTimes(1);
  });

  test('closes dropdown after + Cloud API click', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    fireEvent.click(screen.getByText('+ Cloud API'));
    expect(screen.queryByText('Models')).toBeNull();
  });

  test('selecting a model calls onModelChange with correct id', async () => {
    const onModelChange = jest.fn();
    await renderSelector({ onModelChange });
    await act(async () => { fireEvent.click(getMainBtn()); });
    fireEvent.click(screen.getByText('Mistral (7B)'));
    expect(onModelChange).toHaveBeenCalledWith('mistral:latest', false);
  });

  test('selecting a model closes the dropdown', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    fireEvent.click(screen.getByText('Mistral (7B)'));
    expect(screen.queryByText('Models')).toBeNull();
  });

  test('clicking outside closes the dropdown', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Models')).toBeNull();
  });

  test('shows Available to Download section for uninstalled recommended models', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.getByText('Available to Download')).toBeInTheDocument();
  });

  test('shows no-models message when Ollama is offline', async () => {
    mockListOllamaModels.mockResolvedValue({ success: false, models: [] });
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.getByText(/No models found/)).toBeInTheDocument();
  });
});

describe('ModelSelector — prev/next navigation', () => {
  test('Previous model button calls onModelChange', async () => {
    const onModelChange = jest.fn();
    await renderSelector({ currentModel: 'qwen2.5:7b', onModelChange });
    fireEvent.click(screen.getByRole('button', { name: /previous model/i }));
    expect(onModelChange).toHaveBeenCalledTimes(1);
  });

  test('Next model button calls onModelChange with next model', async () => {
    const onModelChange = jest.fn();
    await renderSelector({ currentModel: 'qwen2.5:7b', onModelChange });
    fireEvent.click(screen.getByRole('button', { name: /next model/i }));
    expect(onModelChange).toHaveBeenCalledTimes(1);
    // Second installed model
    expect(onModelChange).toHaveBeenCalledWith('mistral:latest', false);
  });

  test('Next wraps around after last installed model', async () => {
    const onModelChange = jest.fn();
    await renderSelector({ currentModel: 'phi4-mini', onModelChange });
    fireEvent.click(screen.getByRole('button', { name: /next model/i }));
    // Should wrap back to first model
    expect(onModelChange).toHaveBeenCalledWith('qwen2.5:7b', false);
  });
});

describe('ModelSelector — locked state', () => {
  test('shows lock badge when locked', async () => {
    await renderSelector({ locked: true });
    expect(screen.getByText('🔒', { selector: '.model-lock-badge' })).toBeInTheDocument();
  });

  test('Previous button is disabled when locked', async () => {
    await renderSelector({ locked: true });
    expect(screen.getByRole('button', { name: /previous model/i })).toBeDisabled();
  });

  test('Next button is disabled when locked', async () => {
    await renderSelector({ locked: true });
    expect(screen.getByRole('button', { name: /next model/i })).toBeDisabled();
  });

  test('clicking main button does NOT open dropdown when locked', async () => {
    await renderSelector({ locked: true });
    const mainBtn = document.querySelector('.model-selector-button') as HTMLElement;
    fireEvent.click(mainBtn);
    expect(screen.queryByText('Models')).toBeNull();
  });

  test('shows custom lockReason hint', async () => {
    await renderSelector({ locked: true, lockReason: 'Uncensored mode active' });
    expect(screen.getByText(/Uncensored mode active/)).toBeInTheDocument();
  });

  test('does not call onModelChange when prev clicked while locked', async () => {
    const onModelChange = jest.fn();
    await renderSelector({ locked: true, onModelChange });
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

  test('shows Cloud API section when customLLM is enabled', async () => {
    await renderSelector({ customLLM, useCustomLLM: true });
    await act(async () => {
      fireEvent.click(document.querySelector('.model-selector-button') as HTMLElement);
    });
    expect(screen.getByText('Cloud API')).toBeInTheDocument();
  });

  test('shows custom model name in the dropdown', async () => {
    await renderSelector({ customLLM, useCustomLLM: true });
    await act(async () => {
      fireEvent.click(document.querySelector('.model-selector-button') as HTMLElement);
    });
    expect(screen.getByText('My GPT-4')).toBeInTheDocument();
  });

  test('shows cloud icon when useCustomLLM is true', async () => {
    await renderSelector({ customLLM, useCustomLLM: true });
    expect(screen.getByText('☁️')).toBeInTheDocument();
  });
});
