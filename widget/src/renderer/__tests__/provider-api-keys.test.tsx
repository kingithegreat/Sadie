/** @jest-environment jsdom */

/**
 * One key per provider, and no key handed to the wrong vendor.
 *
 * Two defects live in the same handler:
 *
 * 1. The UI offers thirteen cloud providers but only four have somewhere to
 *    persist a key (anthropicApiKey / openaiApiKey / geminiApiKey /
 *    moonshotApiKey). groq, deepseek, huggingface, cerebras, sambanova,
 *    together and custom share the single `customLLM.apiKey` slot, so
 *    configuring a second one overwrites the first.
 *
 * 2. Worse, the provider <select> seeds the new provider's key field with
 *    whatever the PREVIOUS provider's key was:
 *
 *        let autoFillKey = localSettings.customLLM?.apiKey || '';
 *
 *    Switching OpenAI -> Groq leaves an `sk-...` OpenAI secret sitting in the
 *    Groq configuration, aimed at api.groq.com. Pressing Connect sends one
 *    vendor's credential to another vendor's endpoint.
 */

import { render, fireEvent } from '@testing-library/react';

jest.mock('../components/TelemetryConsentModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/TelemetryDashboard', () => ({ __esModule: true, default: () => null }));

import SettingsPanel from '../components/SettingsPanel';

const noop = () => {};

const OPENAI_KEY = 'sk-openai-SECRET-do-not-leak';
const GROQ_KEY = 'gsk-groq-key';

const withOpenAI = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space',
  useCustomLLM: false,
  openaiApiKey: OPENAI_KEY,
  customLLM: {
    name: 'Custom LLM',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: OPENAI_KEY,
    provider: 'openai',
    model: 'gpt-4o',
    enabled: true,
  },
};

function mountElectron() {
  // The panel remembers the Simple/Advanced choice in localStorage, and jsdom
  // keeps that for the whole file. Without this reset, a test that clicked
  // Advanced puts every later render in Advanced — which is exactly the state
  // the Simple-view tests below exist to check.
  try { window.localStorage.clear(); } catch { /* not available */ }

  (window as any).electron = {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    mcpListServers: jest.fn().mockResolvedValue([]),
    mcpGetStatus: jest.fn().mockResolvedValue([]),
    schedulerList: jest.fn().mockResolvedValue([]),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    listCustomLLMModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
  };
}

function showAdvanced(container: HTMLElement) {
  const btn = Array.from(container.querySelectorAll('.sp-view-btn'))
    .find(b => b.textContent?.trim() === 'Advanced') as HTMLElement | undefined;
  if (btn && btn.getAttribute('aria-pressed') !== 'true') fireEvent.click(btn);
}

function open(settings: any, onSave = noop) {
  const utils = render(<SettingsPanel settings={settings} onSave={onSave} onClose={noop} />);
  showAdvanced(utils.container);
  return utils;
}

describe('cloud provider API keys', () => {
  beforeEach(mountElectron);
  afterEach(() => { delete (window as any).electron; });

  test('switching provider does NOT carry the previous provider\'s key across', () => {
    const onSave = jest.fn();
    const { container, getByLabelText } = open(withOpenAI, onSave);

    fireEvent.change(getByLabelText('Cloud API provider'), { target: { value: 'groq' } });
    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

    const saved = onSave.mock.calls[0][0];
    expect(saved.customLLM.provider).toBe('groq');
    // The OpenAI secret must not end up in a config aimed at Groq.
    expect(saved.customLLM.apiKey).not.toBe(OPENAI_KEY);
  });

  test('a key entered for a keyless-vault provider survives a round trip', () => {
    const onSave = jest.fn();
    const { container, getByLabelText } = open(withOpenAI, onSave);

    fireEvent.change(getByLabelText('Cloud API provider'), { target: { value: 'groq' } });
    const keyInput = container.querySelector('.custom-llm-section .api-key-input') as HTMLInputElement;
    expect(keyInput).toBeTruthy();
    fireEvent.change(keyInput, { target: { value: GROQ_KEY } });
    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

    const saved = onSave.mock.calls[0][0];
    // Groq's key has to be stored somewhere that survives switching away and back.
    expect(saved.providerApiKeys?.groq).toBe(GROQ_KEY);
    // ...and the previously-saved OpenAI key must still be there.
    expect(saved.openaiApiKey || saved.providerApiKeys?.openai).toBe(OPENAI_KEY);
  });

  test('switching back to a provider restores ITS key, not the last one used', () => {
    const onSave = jest.fn();
    const settings = {
      ...withOpenAI,
      providerApiKeys: { openai: OPENAI_KEY, groq: GROQ_KEY },
    };
    const { getByLabelText, container } = open(settings, onSave);

    fireEvent.change(getByLabelText('Cloud API provider'), { target: { value: 'groq' } });
    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

    expect(onSave.mock.calls[0][0].customLLM.apiKey).toBe(GROQ_KEY);
  });

  test('the panel says which providers already have a key', () => {
    const { container } = open({
      ...withOpenAI,
      providerApiKeys: { openai: OPENAI_KEY, groq: GROQ_KEY, cerebras: 'csk' },
    });

    const list = container.querySelector('[data-testid="saved-provider-keys"]');
    expect(list).toBeTruthy();
    expect(list!.textContent).toContain('openai');
    expect(list!.textContent).toContain('groq');
    expect(list!.textContent).toContain('cerebras');
    expect(list!.textContent).toContain('3 services');
  });

  test('nothing is listed on a fresh install', () => {
    const { container } = open({
      alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space',
    });
    expect(container.querySelector('[data-testid="saved-provider-keys"]')).toBeNull();
  });

  test('the shared Google key is listed once, not twice', () => {
    const { container } = open({
      ...withOpenAI,
      providerApiKeys: { 'google-ai-studio': 'AIza-x', 'google-gemini': 'AIza-x' },
    });
    const list = container.querySelector('[data-testid="saved-provider-keys"]')!;
    expect(list.textContent).toContain('1 service');
    expect(list.textContent).not.toContain('google-gemini');
  });

  test('removing a saved key clears it with an empty string, so the clear persists', () => {
    const onSave = jest.fn();
    const { container, getByLabelText } = open({
      ...withOpenAI,
      providerApiKeys: { openai: OPENAI_KEY, groq: GROQ_KEY },
    }, onSave);

    fireEvent.click(getByLabelText('Remove the saved key for groq'));
    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

    const saved = onSave.mock.calls[0][0];
    // An omitted provider means "unchanged" in the main process, so a removal
    // has to be an explicit empty string or it silently does nothing.
    expect(saved.providerApiKeys.groq).toBe('');
    expect(saved.providerApiKeys.openai).toBe(OPENAI_KEY);
  });
});

/**
 * Reported from real use: "when I try to use my Claude Pro sub in HomeBot the
 * option has changed."
 *
 * It had not changed — it had moved. The cloud provider picker lived inside
 * AdvancedSettingsTab, which the new Simple view does not render, so the
 * Claude-subscription option vanished from the default panel. "Which model
 * answers" is the most basic setting there is; it belongs in Simple, beside
 * the local model picker, not behind a disclosure with the MCP server ports.
 *
 * These render WITHOUT clicking Advanced.
 */
describe('choosing the cloud provider is reachable in the Simple view', () => {
  beforeEach(mountElectron);
  afterEach(() => { delete (window as any).electron; });

  const simple = (settings: any = withOpenAI) =>
    render(<SettingsPanel settings={settings} onSave={noop} onClose={noop} />);

  test('the provider picker is on screen without switching to Advanced', () => {
    const { getByLabelText } = simple();
    expect(getByLabelText('Cloud API provider')).toBeInTheDocument();
  });

  test('the Claude subscription option is offered', () => {
    const { getByLabelText } = simple();
    const select = getByLabelText('Cloud API provider') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toContain('claude-code');
  });

  test('and it can actually be selected and saved', () => {
    const onSave = jest.fn();
    const { getByLabelText, container } = render(
      <SettingsPanel settings={withOpenAI as any} onSave={onSave} onClose={noop} />
    );

    fireEvent.change(getByLabelText('Cloud API provider'), { target: { value: 'claude-code' } });
    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

    expect(onSave.mock.calls[0][0].customLLM.provider).toBe('claude-code');
  });

  test('the API keys section stays in Advanced — only the picker moved', () => {
    const { container } = simple();
    const toggles = Array.from(container.querySelectorAll('.sp-section-toggle'))
      .map(t => t.textContent || '');
    expect(toggles.some(t => t.includes('API Keys'))).toBe(false);
  });
});

