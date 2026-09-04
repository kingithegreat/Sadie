/** @jest-environment jsdom */

/**
 * Choosing the Claude subscription and actually being able to use it.
 *
 * Reported live: "i saved claude sub without api and its still not letting me
 * use claude", alongside a transcript showing `qwen2.5:7b` answering.
 *
 * Both symptoms were the same cause. Every provider learns its models by
 * calling `/models`, and Settings only does that when the user presses a
 * button. Claude Code is a local CLI with no `/models` endpoint, so choosing it
 * cleared the model list and nothing ever selected a model.
 * `resolveCloudLLM` treats a cloud provider with no model as INACTIVE, so:
 *
 *   - the privacy switch disabled itself — hence "not letting me use claude"
 *   - the router fell back to the local model — hence qwen answering
 *
 * The switch was telling the truth. Nothing would have answered.
 *
 * The lists are constants, so these assert the provider is usable the moment it
 * is chosen, with no fetch and no button.
 */

import { render, fireEvent } from '@testing-library/react';

jest.mock('../components/TelemetryConsentModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/TelemetryDashboard', () => ({ __esModule: true, default: () => null }));

import SettingsPanel from '../components/SettingsPanel';
import { CLAUDE_CODE_MODELS, knownModelsFor } from '../../shared/subscription-models';
import { PROVIDER_API_URLS, defaultApiUrlFor } from '../../shared/provider-urls';

const noop = () => {};

const BASE = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space',
};

function mountElectron() {
  (window as any).electron = {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    mcpListServers: jest.fn().mockResolvedValue([]),
    mcpGetStatus: jest.fn().mockResolvedValue([]),
    schedulerList: jest.fn().mockResolvedValue([]),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    // Deliberately fails. A local CLI has no /models endpoint, and the whole
    // point is that the provider works without this call ever succeeding.
    listCustomLLMModels: jest.fn().mockRejectedValue(new Error('no /models endpoint')),
  };
  try { window.localStorage.clear(); } catch { /* not available */ }
}

beforeEach(mountElectron);
afterEach(() => { delete (window as any).electron; });

describe('the model lists that need no network', () => {
  test('Claude Code offers models without anyone calling /models', () => {
    expect(knownModelsFor('claude-code').length).toBeGreaterThan(0);
    expect(knownModelsFor('claude-code')).toBe(CLAUDE_CODE_MODELS);
  });

  test('Codex too', () => {
    expect(knownModelsFor('codex').length).toBeGreaterThan(0);
  });

  test('a metered provider has no known list — it must still ask', () => {
    // Guards against someone "helpfully" hardcoding OpenAI's catalogue, which
    // would go stale silently.
    expect(knownModelsFor('openai')).toHaveLength(0);
    expect(knownModelsFor(undefined)).toHaveLength(0);
  });
});

describe('the one shared provider-URL map', () => {
  test('the subscription CLIs have NO url, and must not gain one', () => {
    // Callers do `cfg.apiUrl || PROVIDER_API_URLS[cfg.provider]`, so an entry
    // here would send a local CLI's traffic to a web address.
    expect(PROVIDER_API_URLS['claude-code']).toBeUndefined();
    expect(PROVIDER_API_URLS['codex']).toBeUndefined();
    expect(defaultApiUrlFor('claude-code')).toBe('');
  });

  test('Moonshot is present — the drift that motivated sharing the map', () => {
    // It was in main's map and missing from the renderer's private copy, so
    // picking Kimi left the URL blank in Settings.
    expect(PROVIDER_API_URLS['moonshot']).toBe('https://api.moonshot.ai/v1');
  });

  test('TokenRouter resolves to the verified .com base', () => {
    // Measured against the live API: .io answers 401 and is a different
    // service; .com answers 200 and lists models.
    expect(defaultApiUrlFor('tokenrouter')).toBe('https://api.tokenrouter.com/v1');
  });
});

describe('choosing the Claude subscription in Settings', () => {
  const selectProvider = (container: HTMLElement, value: string) => {
    const select = Array.from(container.querySelectorAll('select')).find(s =>
      Array.from(s.options).some(o => o.value === 'claude-code')
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value } });
    return select;
  };

  test('saves a model, so the provider is usable without pressing anything', async () => {
    const onSave = jest.fn();
    const { container } = render(
      <SettingsPanel settings={BASE as any} onSave={onSave} onClose={noop} />
    );

    const advanced = Array.from(container.querySelectorAll('.sp-view-btn'))
      .find(b => b.textContent === 'Advanced') as HTMLButtonElement;
    fireEvent.click(advanced);

    selectProvider(container, 'claude-code');
    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

    expect(onSave).toHaveBeenCalled();
    const saved = onSave.mock.calls[0][0];
    expect(saved.customLLM?.provider).toBe('claude-code');
    // The assertion the bug turns on: a model IS selected. Without one,
    // resolveCloudLLM reports inactive and the privacy switch stays disabled.
    expect(saved.customLLM?.model).toBeTruthy();
    expect(CLAUDE_CODE_MODELS.map(m => m.id)).toContain(saved.customLLM?.model);
  });

  test('TokenRouter is offered as a provider at all', () => {
    const { container } = render(
      <SettingsPanel settings={BASE as any} onSave={noop} onClose={noop} />
    );
    const advanced = Array.from(container.querySelectorAll('.sp-view-btn'))
      .find(b => b.textContent === 'Advanced') as HTMLButtonElement;
    fireEvent.click(advanced);

    const hasTokenRouter = Array.from(container.querySelectorAll('option'))
      .some(o => (o as HTMLOptionElement).value === 'tokenrouter');
    expect(hasTokenRouter).toBe(true);
  });
});
