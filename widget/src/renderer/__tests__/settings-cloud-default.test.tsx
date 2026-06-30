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

  function expandSection(container: HTMLElement, label: string) {
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
      expect(container.textContent).toContain('Connected: gpt-4o is available when you choose it');
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

    expect(container.textContent).not.toContain('Connected: gpt-4o is available when you choose it');
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