/** @jest-environment jsdom */

/**
 * The privacy switch — "answer on this PC" vs "allowed to use the online AI" —
 * is the setting with the highest stakes in the panel, and it was the hardest
 * one to reach.
 *
 * The only control bound to `useCustomLLM` in SettingsPanel sat behind
 * `{isConnected && ...}`, where `isConnected` is `availableModels.length > 0`.
 * `availableModels` is emptied on mount and again whenever the `settings` prop
 * changes, so opening Settings always started disconnected. A user who had
 * already turned cloud chat on could not find the control that turns it back
 * off without first re-fetching a model list they did not need.
 *
 * These tests pin the switch to being present on open, in both views, and to
 * defaulting to local.
 */

import { render, fireEvent } from '@testing-library/react';

jest.mock('../components/TelemetryConsentModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/TelemetryDashboard', () => ({ __esModule: true, default: () => null }));

import SettingsPanel from '../components/SettingsPanel';

const baseSettings = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space',
};

const cloudConfigured = {
  ...baseSettings,
  useCustomLLM: true,
  openaiApiKey: 'sk-test',
  customLLM: {
    name: 'Custom LLM',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    provider: 'openai',
    model: 'gpt-4o',
    enabled: true,
  },
};

const noop = () => {};

function mountElectron() {
  (window as any).electron = {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    mcpListServers: jest.fn().mockResolvedValue([]),
    mcpGetStatus: jest.fn().mockResolvedValue([]),
    schedulerList: jest.fn().mockResolvedValue([]),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    listCustomLLMModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
  };
}

/** The switch, found by its accessible name rather than its position. */
function privacySwitch(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector('input[data-testid="privacy-switch"]');
}

describe('SettingsPanel — privacy switch reachability', () => {
  beforeEach(mountElectron);
  afterEach(() => { delete (window as any).electron; });

  test('is present as soon as Settings opens, with no model fetch first', () => {
    const { container } = render(
      <SettingsPanel settings={cloudConfigured as any} onSave={noop} onClose={noop} />
    );
    expect(privacySwitch(container)).toBeTruthy();
  });

  test('reflects that cloud is currently allowed', () => {
    const { container } = render(
      <SettingsPanel settings={cloudConfigured as any} onSave={noop} onClose={noop} />
    );
    expect(privacySwitch(container)!.checked).toBe(true);
  });

  test('a fresh install is local-only', () => {
    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expect(privacySwitch(container)!.checked).toBe(false);
  });

  test('turning it off saves useCustomLLM: false — the way back to local exists', () => {
    const onSave = jest.fn();
    const { container } = render(
      <SettingsPanel settings={cloudConfigured as any} onSave={onSave} onClose={noop} />
    );

    fireEvent.click(privacySwitch(container)!);
    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].useCustomLLM).toBe(false);
  });

  test('turning it on requires a configured provider — it cannot silently enable nothing', () => {
    const onSave = jest.fn();
    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={onSave} onClose={noop} />
    );

    // No provider configured: the switch is present but must not be operable,
    // since turning it on would route chat to a provider that cannot answer.
    expect(privacySwitch(container)!.disabled).toBe(true);

    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);
    expect(onSave.mock.calls[0][0].useCustomLLM).toBe(false);
  });
});

describe('SettingsPanel — privacy switch wording', () => {
  beforeEach(mountElectron);
  afterEach(() => { delete (window as any).electron; });

  test('explains uncensored mode rather than telling you to set up what you already have', () => {
    const { container } = render(
      <SettingsPanel
        settings={{ ...cloudConfigured, useCustomLLM: false, uncensoredMode: true } as any}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(container.textContent).toContain('Uncensored mode answers with the model on this PC');
    expect(container.textContent).not.toContain('Set up an online AI under Advanced');
  });

  test('tells someone with no provider where to set one up', () => {
    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expect(container.textContent).toContain('Set up an online AI under Advanced');
  });

  test('a switch that is already on stays operable even if the key has gone missing', () => {
    const { container } = render(
      <SettingsPanel
        settings={{ ...cloudConfigured, openaiApiKey: '', customLLM: { ...cloudConfigured.customLLM, apiKey: '' } } as any}
        onSave={noop}
        onClose={noop}
      />
    );
    // Cloud is on but unusable — the way back to local must not be disabled.
    expect(privacySwitch(container)!.disabled).toBe(false);
  });
});

/**
 * Reported from real use: "selected sonet but still showing quen".
 *
 * Choosing a cloud model saves `customLLM.model` and sets `enabled: true`, but
 * routing is decided by `useCustomLLM` — which stays off, deliberately, so that
 * connecting a provider never silently starts sending chats off the machine.
 * Nothing said so. The switch read "the online AI you set up", which does not
 * connect to "the Sonnet I just picked is sitting there unused".
 */
describe('SettingsPanel — a configured-but-unused cloud model says so', () => {
  beforeEach(mountElectron);
  afterEach(() => { delete (window as any).electron; });

  const claudeSubReady = {
    ...baseSettings,
    useCustomLLM: false,
    chatModel: 'qwen2.5:7b',
    customLLM: {
      name: 'Custom LLM', apiUrl: '', apiKey: '',
      provider: 'claude-code', model: 'sonnet', enabled: true,
    },
  };

  test('names the model that is waiting AND the one answering instead', () => {
    const { container } = render(
      <SettingsPanel settings={claudeSubReady as any} onSave={noop} onClose={noop} />
    );
    expect(container.textContent).toContain('Claude sonnet is set up but NOT in use');
    expect(container.textContent).toContain('qwen2.5:7b is answering');
  });

  test('the switch is operable, so the fix is one click away', () => {
    const { container } = render(
      <SettingsPanel settings={claudeSubReady as any} onSave={noop} onClose={noop} />
    );
    expect(privacySwitch(container)!.disabled).toBe(false);
    expect(privacySwitch(container)!.checked).toBe(false);
  });

  test('turning it on routes to the cloud model', () => {
    const onSave = jest.fn();
    const { container } = render(
      <SettingsPanel settings={claudeSubReady as any} onSave={onSave} onClose={noop} />
    );
    fireEvent.click(privacySwitch(container)!);
    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

    const saved = onSave.mock.calls[0][0];
    expect(saved.useCustomLLM).toBe(true);
    expect(saved.customLLM.provider).toBe('claude-code');
    expect(saved.customLLM.model).toBe('sonnet');
  });

  test('once in use, it stops claiming the model is unused', () => {
    const { container } = render(
      <SettingsPanel settings={{ ...claudeSubReady, useCustomLLM: true } as any} onSave={noop} onClose={noop} />
    );
    expect(container.textContent).not.toContain('set up but NOT in use');
    expect(container.textContent).toContain('Allowed to use the online AI');
  });
});

