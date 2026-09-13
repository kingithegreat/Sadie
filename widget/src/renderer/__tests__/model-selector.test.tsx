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

  test('lists the On this PC section with model count', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.getByText(/On this PC \(3\)/)).toBeInTheDocument();
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

  test('shows the Add more section for uninstalled recommended models', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.getByText(/Add more to your PC/)).toBeInTheDocument();
  });

  test('groups uninstalled models under purpose sub-groups', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.getByText(/Everyday chat/)).toBeInTheDocument();
    expect(screen.getByText(/Coding/)).toBeInTheDocument();
    expect(screen.getByText(/Deep reasoning/)).toBeInTheDocument();
    expect(screen.getByText(/Fast on small PCs/)).toBeInTheDocument();
    expect(screen.getByText(/No guardrails/)).toBeInTheDocument();
  });

  test('floats GPU-picked installed models under a Best for your PC subsection', async () => {
    // 8GB VRAM recommends qwen2.5:7b, which is installed in the mock set.
    await renderSelector({ vramGB: 8 });
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.getByText(/Best for your PC/)).toBeInTheDocument();
    expect(screen.getByText(/Everything else/)).toBeInTheDocument();
    const subgroup = screen.getByText(/Best for your PC/).closest('.model-subgroup-label');
    expect(subgroup).not.toBeNull();
  });

  test('does not show the Best for your PC subsection when VRAM is unknown', async () => {
    await renderSelector({ vramGB: null });
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.queryByText(/Best for your PC/)).toBeNull();
  });

  test('filter box narrows the list to matching models', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    const input = screen.getByLabelText('Filter models') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { value: 'coder' } }); });
    expect(screen.getByText('Qwen 2.5 Coder (7B)')).toBeInTheDocument();
    expect(screen.queryByText('Mistral (7B)')).toBeNull();
    expect(screen.queryByText('Dolphin (7B)')).toBeNull();
  });

  test('prev/next arrows cycle only the filtered subset while a filter is active', async () => {
    const onModelChange = jest.fn();
    // "a" matches mistral, qwen2.5 (has an "a"), and phi4-mini ("Mini") —
    // narrower than all 3 installed models? No: qwen2.5:7b has no "a" in its
    // VISIBLE strings until you hit its id. Use "mistral" instead: exactly one
    // installed model, so next wraps back onto itself.
    await renderSelector({ currentModel: 'phi4-mini', onModelChange });
    await act(async () => { fireEvent.click(getMainBtn()); });
    const input = screen.getByLabelText('Filter models') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { value: 'mistral' } }); });
    fireEvent.click(screen.getByRole('button', { name: /next model/i }));
    expect(onModelChange).toHaveBeenCalledWith('mistral:latest', false);
    // Wraps within the one visible model.
    fireEvent.click(screen.getByRole('button', { name: /next model/i }));
    expect(onModelChange).toHaveBeenLastCalledWith('mistral:latest', false);
    // And never lands on a filtered-out model like phi4-mini.
    expect(onModelChange).not.toHaveBeenCalledWith('phi4-mini', false);
  });

  test('filter with no matches shows a recovery message, not a blank list', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    const input = screen.getByLabelText('Filter models') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { value: 'zzz-nothing' } }); });
    expect(screen.getByText(/No models match/i)).toBeInTheDocument();
  });

  test('Escape in the filter box closes the dropdown', async () => {
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    const input = screen.getByLabelText('Filter models') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('Models')).toBeNull();
  });

  test('the empty state offers an action rather than a question', async () => {
    mockListOllamaModels.mockResolvedValue({ success: false, models: [] });
    await renderSelector();
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(screen.getByText(/No AI models are available yet/)).toBeInTheDocument();
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

describe('ModelSelector — VRAM warnings', () => {
  function getMainBtn() {
    return document.querySelector('.model-selector-button') as HTMLElement;
  }

  test('shows "slow" badge for models exceeding VRAM', async () => {
    await renderSelector({ vramGB: 3 });
    await act(async () => { fireEvent.click(getMainBtn()); });
    const badges = document.querySelectorAll('.vram-badge.over');
    expect(badges.length).toBeGreaterThan(0);
  });

  test('shows "tight" badge for models near VRAM limit', async () => {
    await renderSelector({ vramGB: 5 });
    await act(async () => { fireEvent.click(getMainBtn()); });
    const badges = document.querySelectorAll('.vram-badge.tight');
    expect(badges.length).toBeGreaterThan(0);
  });

  test('shows no VRAM badges when VRAM is null', async () => {
    await renderSelector({ vramGB: null });
    await act(async () => { fireEvent.click(getMainBtn()); });
    expect(document.querySelectorAll('.vram-badge').length).toBe(0);
  });

  test('shows no VRAM badges when VRAM is ample', async () => {
    await renderSelector({ vramGB: 24 });
    await act(async () => { fireEvent.click(getMainBtn()); });
    ['Qwen 2.5 (7B)', 'Mistral (7B)', 'Phi 4 Mini (3.8B)'].forEach((name) => {
      const option = screen.getByText(name).closest('.model-option');
      expect(option?.querySelector('.vram-badge.over')).toBeNull();
    });
  });

  test('prev/next arrows show an inline warning for oversized models', async () => {
    const onModelChange = jest.fn();
    await renderSelector({ currentModel: 'phi4-mini', vramGB: 2, onModelChange });
    fireEvent.click(screen.getByRole('button', { name: /next model/i }));
    expect(screen.getByText(/may run slowly on your gpu/i)).toBeInTheDocument();
    expect(onModelChange).toHaveBeenCalledTimes(1);
  });

  test('prev/next arrows still switch models when warning is shown', async () => {
    const onModelChange = jest.fn();
    await renderSelector({ currentModel: 'phi4-mini', vramGB: 2, onModelChange });
    fireEvent.click(screen.getByRole('button', { name: /next model/i }));
    expect(onModelChange).toHaveBeenCalledTimes(1);
    expect(onModelChange).toHaveBeenCalledWith('qwen2.5:7b', false);
  });

  test('dropdown selection shows an inline warning for oversized models', async () => {
    const onModelChange = jest.fn();
    await renderSelector({ vramGB: 2, onModelChange });
    await act(async () => { fireEvent.click(getMainBtn()); });
    fireEvent.click(screen.getByText('Qwen 2.5 (7B)'));
    expect(screen.getByText(/may run slowly on your gpu/i)).toBeInTheDocument();
    expect(onModelChange).toHaveBeenCalledWith('qwen2.5:7b', false);
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
    expect(screen.getAllByText(/Openai/i).length).toBeGreaterThan(0);
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
    expect(screen.getAllByText('☁️').length).toBeGreaterThan(0);
  });

  test('configured cloud model remains an option when useCustomLLM is false', async () => {
    const onModelChange = jest.fn();
    await renderSelector({
      customLLM: {
        ...customLLM,
        apiKey: 'sk-test-key',
        enabled: false,
      },
      useCustomLLM: false,
      currentModel: 'qwen2.5:7b',
      onModelChange,
    });
    await act(async () => {
      fireEvent.click(document.querySelector('.model-selector-button') as HTMLElement);
    });
    // Cloud section is present even though local model is currently active
    expect(screen.getAllByText(/Openai/i).length).toBeGreaterThan(0);
    expect(screen.getByText('My GPT-4')).toBeInTheDocument();

    // Selecting it activates the cloud model
    fireEvent.click(screen.getByText('My GPT-4'));
    expect(onModelChange).toHaveBeenCalledWith('gpt-4', true, 'openai');
  });

  test('providers with keys in providerApiKeys appear in the dropdown even when local model is active', async () => {
    const onModelChange = jest.fn();
    await renderSelector({
      useCustomLLM: false,
      currentModel: 'qwen2.5:7b',
      providerApiKeys: {
        openai: 'sk-proj-test1234567890',
      },
      onModelChange,
    });
    await act(async () => {
      fireEvent.click(document.querySelector('.model-selector-button') as HTMLElement);
    });
    // Fallback curated OpenAI model appears in the dropdown
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();

    // Selecting it enables cloud with the chosen model and provider
    fireEvent.click(screen.getByText('GPT-4o'));
    expect(onModelChange).toHaveBeenCalledWith('gpt-4o', true, 'openai');
  });

  test('a saved key never offers a model its provider has shut down', async () => {
    // Every one of these was offered here after its provider switched it off,
    // so picking it either failed every request or was silently answered by
    // a different model than the one the chat said it switched to.
    const retired = ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'deepseek-chat', 'deepseek-reasoner', 'gemini-2.0-flash'];
    const onModelChange = jest.fn();
    await renderSelector({
      useCustomLLM: false,
      currentModel: 'qwen2.5:7b',
      providerApiKeys: { anthropic: 'sk-ant-test', deepseek: 'sk-ds-test', 'google-ai-studio': 'AIza-test' },
      onModelChange,
    });
    const open = () => act(async () => {
      fireEvent.click(document.querySelector('.model-selector-button') as HTMLElement);
    });
    const cloudOptions = () => Array.from(document.querySelectorAll('.model-option'))
      .filter(el => el.querySelector('.model-option-icon')?.textContent === '☁️');
    await open();
    const count = cloudOptions().length;
    expect(count).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < count; i++) {
      if (cloudOptions().length === 0) await open();
      fireEvent.click(cloudOptions()[i]);
    }
    // Assert what a click actually sends, not the label on the button.
    const sent = onModelChange.mock.calls.map(([id, isCloud, provider]) => ({ id, isCloud, provider }));
    expect(sent).toHaveLength(count);
    for (const s of sent) {
      expect(s.isCloud).toBe(true);
      expect(retired).not.toContain(s.id);
    }
    expect(sent).toEqual(expect.arrayContaining([
      { id: 'claude-sonnet-5', isCloud: true, provider: 'anthropic' },
      { id: 'claude-haiku-4-5', isCloud: true, provider: 'anthropic' },
      { id: 'deepseek-v4-flash', isCloud: true, provider: 'deepseek' },
      { id: 'gemini-2.5-flash', isCloud: true, provider: 'google-ai-studio' },
    ]));
  });
});

