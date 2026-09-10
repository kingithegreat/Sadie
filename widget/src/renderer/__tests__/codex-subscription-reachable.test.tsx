/** @jest-environment jsdom */

/**
 * Can anyone actually CHOOSE the ChatGPT subscription?
 *
 * The Codex provider was fully built and fully unit-tested on main: a
 * `streamCodex` subprocess client, `CODEX_MODELS`, `codex` in the settings type
 * union, in `KEYLESS_PROVIDERS`, in `curatedProviders`, deliberately absent from
 * `PROVIDER_API_URLS`, and handled by name in the IPC layer. Its sibling test
 * file even asserted `knownModelsFor('codex')` returns models.
 *
 * Every one of those passed. None of them touched the Settings dropdown, which
 * had no `codex` option — so the provider could not be selected, and therefore
 * could never run. A capability that exists, is exported, is unit-tested, and
 * that no user action can reach.
 *
 * These tests fail against a build without the option. That is the point:
 * `knownModelsFor('codex')` was never able to notice this, because it asks the
 * catalogue a question instead of asking the UI whether anyone can get there.
 */

import { render, fireEvent } from '@testing-library/react';

jest.mock('../components/TelemetryConsentModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/TelemetryDashboard', () => ({ __esModule: true, default: () => null }));

import SettingsPanel from '../components/SettingsPanel';
import { CODEX_MODELS } from '../../shared/subscription-models';
import { resolveCloudLLM } from '../../shared/cloud-llm';

const noop = () => {};

const BASE = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space',
};

beforeEach(() => {
  (window as any).electron = {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    mcpListServers: jest.fn().mockResolvedValue([]),
    mcpGetStatus: jest.fn().mockResolvedValue([]),
    schedulerList: jest.fn().mockResolvedValue([]),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    // A local CLI has no /models endpoint. The provider must be usable without
    // this call ever succeeding.
    listCustomLLMModels: jest.fn().mockRejectedValue(new Error('no /models endpoint')),
  };
  try { window.localStorage.clear(); } catch { /* not available */ }
});
afterEach(() => { delete (window as any).electron; });

function openAdvanced() {
  const view = render(<SettingsPanel settings={BASE as any} onSave={noop} onClose={noop} />);
  const advanced = Array.from(view.container.querySelectorAll('.sp-view-btn'))
    .find(b => b.textContent === 'Advanced') as HTMLButtonElement;
  fireEvent.click(advanced);
  return view;
}

function providerSelect(container: HTMLElement) {
  const select = Array.from(container.querySelectorAll('select')).find(s =>
    Array.from(s.options).some(o => o.value === 'claude-code')
  ) as HTMLSelectElement;
  expect(select).toBeTruthy();
  return select;
}

describe('the Codex front door', () => {
  test('codex is offered in the provider dropdown at all', () => {
    const { container } = openAdvanced();
    const values = Array.from(providerSelect(container).options).map(o => o.value);
    expect(values).toContain('codex');
  });

  test('its label says subscription and no API key, like its Claude sibling', () => {
    // The label is the whole discovery mechanism. "codex" alone reads like an
    // API product you need a key for, which is the opposite of what it is.
    const { container } = openAdvanced();
    const opt = Array.from(providerSelect(container).options)
      .find(o => o.value === 'codex') as HTMLOptionElement;
    expect(opt.textContent).toMatch(/subscription/i);
    expect(opt.textContent).toMatch(/no API key/i);
  });

  test('choosing it saves a usable config with no button pressed', () => {
    const onSave = jest.fn();
    const { container } = render(
      <SettingsPanel settings={BASE as any} onSave={onSave} onClose={noop} />
    );
    const advanced = Array.from(container.querySelectorAll('.sp-view-btn'))
      .find(b => b.textContent === 'Advanced') as HTMLButtonElement;
    fireEvent.click(advanced);

    fireEvent.change(providerSelect(container), { target: { value: 'codex' } });
    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

    expect(onSave).toHaveBeenCalled();
    const saved = onSave.mock.calls[0][0];
    expect(saved.customLLM?.provider).toBe('codex');
    // The assertion the Claude-subscription bug turned on: a model IS selected.
    // Without one, resolveCloudLLM reports inactive, the privacy switch stays
    // disabled, and the local model answers instead.
    expect(CODEX_MODELS.map(m => m.id)).toContain(saved.customLLM?.model);
  });

  test('the saved config is one resolveCloudLLM calls active — with no key', () => {
    // Proves the real downstream effect, not just the shape of the object the
    // panel handed back. This is what decides whether Codex ever answers.
    const onSave = jest.fn();
    const { container } = render(
      <SettingsPanel settings={BASE as any} onSave={onSave} onClose={noop} />
    );
    const advanced = Array.from(container.querySelectorAll('.sp-view-btn'))
      .find(b => b.textContent === 'Advanced') as HTMLButtonElement;
    fireEvent.click(advanced);

    fireEvent.change(providerSelect(container), { target: { value: 'codex' } });
    fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

    const saved = onSave.mock.calls[0][0];
    expect(saved.customLLM?.apiKey || '').toBe('');
    expect(resolveCloudLLM({ ...saved, useCustomLLM: true }).active).toBe(true);
  });

  test('it asks for a CLI path, never for an API key', () => {
    // Codex is keyless. A password box here would be asking for a credential
    // that does not exist, and would hide the one field that IS useful — the
    // path, for a CLI that is not on PATH.
    const { container } = openAdvanced();
    fireEvent.change(providerSelect(container), { target: { value: 'codex' } });

    const keyRow = container.querySelector('.api-key-row') as HTMLElement;
    const input = keyRow.querySelector('input') as HTMLInputElement;
    expect(input.type).not.toBe('password');
    expect(input.placeholder).toMatch(/codex/i);
    expect(input.placeholder).toMatch(/path/i);
  });

  test('a metered provider still gets a password box', () => {
    // Rule 13: the previous assertion has to be able to come out the other way,
    // or it proves nothing about codex specifically.
    const { container } = openAdvanced();
    fireEvent.change(providerSelect(container), { target: { value: 'openai' } });

    const keyRow = container.querySelector('.api-key-row') as HTMLElement;
    const input = keyRow.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  test('the hint explains the ChatGPT plan and the login step', () => {
    const { container } = openAdvanced();
    fireEvent.change(providerSelect(container), { target: { value: 'codex' } });

    const text = container.textContent || '';
    expect(text).toMatch(/ChatGPT/);
    expect(text).toMatch(/codex login/);
    // Claude Code's hint must not leak in alongside it.
    expect(text).not.toMatch(/Claude Pro\/Max subscription/);
  });
});
