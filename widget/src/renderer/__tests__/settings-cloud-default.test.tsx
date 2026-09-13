/** @jest-environment jsdom */

import { render, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../components/TelemetryConsentModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/TelemetryDashboard', () => ({ __esModule: true, default: () => null }));

import SettingsPanel from '../components/SettingsPanel';

const baseSettings = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space',
};

const noop = () => {};

describe('SettingsPanel — cloud connection defaults', () => {
  beforeEach(() => {
    (window as any).electron = {
      getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
      mcpListServers: jest.fn().mockResolvedValue([]),
      mcpGetStatus: jest.fn().mockResolvedValue([]),
      schedulerList: jest.fn().mockResolvedValue([]),
      listCustomLLMModels: jest.fn().mockResolvedValue({
        success: true,
        models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
      }),
    };
  });

  afterEach(() => {
    delete (window as any).electron;
  });

  /**
   * Settings opens in the Simple view, which shows only the essentials. The
   * cloud-provider block asserted on here lives under Advanced.
   */
  function showAdvanced(container: HTMLElement) {
    const btn = Array.from(container.querySelectorAll('.sp-view-btn'))
      .find(b => b.textContent?.trim() === 'Advanced') as HTMLElement | undefined;
    if (btn && btn.getAttribute('aria-pressed') !== 'true') fireEvent.click(btn);
  }

  function expandSection(container: HTMLElement, label: string) {
    showAdvanced(container);
    const toggles = Array.from(container.querySelectorAll('.sp-section-toggle'));
    const btn = toggles.find(t => t.textContent?.includes(label)) as HTMLElement | undefined;
    if (btn && btn.textContent?.includes('▸')) fireEvent.click(btn);
  }

  test('connecting a cloud API keeps local chat as default until explicitly enabled', async () => {
    const onSave = jest.fn();
    const { container, getByText } = render(
      <SettingsPanel settings={baseSettings as any} onSave={onSave} onClose={noop} />
    );
    expandSection(container, 'API Keys');

    const apiKeyInput = container.querySelector('.custom-llm-section .api-key-input') as HTMLInputElement;
    expect(apiKeyInput).toBeTruthy();
    fireEvent.change(apiKeyInput, { target: { value: 'sk-test' } });

    fireEvent.click(getByText('Connect'));

    await waitFor(() => {
      // Copy updated: the old wording ("available when you choose it") described
      // a state the user had no obvious action for, and people read "Connected"
      // as "in use". The assertion still pins the same behaviour — connected,
      // but explicitly NOT the default until the box is ticked and saved.
      expect(container.textContent).toContain('gpt-4o is connected but NOT in use');
    });

    const saveBtn = container.querySelector('.button-save') as HTMLButtonElement;
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.useCustomLLM).toBe(false);
    expect(saved.customLLM.enabled).toBe(true);
    expect(saved.customLLM.model).toBe('gpt-4o');
  });

  test('switching provider clears stale cloud model and disables cloud default until reconnect', async () => {
    const onSave = jest.fn();
    const { container, getByLabelText } = render(
      <SettingsPanel
        settings={{
          ...baseSettings,
          useCustomLLM: true,
          anthropicApiKey: 'sk-ant-test',
          customLLM: {
            name: 'Custom LLM',
            apiUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-test',
            provider: 'openai',
            model: 'gpt-4o',
            enabled: true,
          },
        } as any}
        onSave={onSave}
        onClose={noop}
      />
    );
    expandSection(container, 'API Keys');

    const providerSelect = getByLabelText('Cloud API provider') as HTMLSelectElement;
    fireEvent.change(providerSelect, { target: { value: 'anthropic' } });

    expect(container.textContent).not.toContain('gpt-4o is connected but NOT in use');
    expect(container.textContent).not.toContain('Using gpt-4o');

    const saveBtn = container.querySelector('.button-save') as HTMLButtonElement;
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.useCustomLLM).toBe(false);
    expect(saved.customLLM.provider).toBe('anthropic');
    expect(saved.customLLM.apiKey).toBe('sk-ant-test');
    expect(saved.customLLM.model).toBe('');
    expect(saved.customLLM.enabled).toBe(false);
  });
});