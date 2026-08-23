/** @jest-environment jsdom */

/**
 * Finding the reading service.
 *
 * `webReaderFallbackEnabled` is the last fetch tier and the only one that sends
 * a page address off this machine, so it is correctly OFF by default — that is
 * a deliberate local-first decision, not a bug, and these tests protect it.
 *
 * What was wrong is that the switch lived in `AdvancedSettingsTab`, and Settings
 * opens in Simple. The people who would happily turn it on could not discover it
 * existed. The capability is worth finding: measured against live sites, a plain
 * request and HomeBot's own browser both returned nothing on pages where the
 * reading service returned roughly 90,000 characters.
 *
 * So it moved beside the privacy switch, which renders in both views. These
 * assert what `onSave` RECEIVES, because a checkbox that toggles and never
 * reaches disk is the same defect wearing a tick.
 */

import { render, fireEvent } from '@testing-library/react';

jest.mock('../components/TelemetryConsentModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/TelemetryDashboard', () => ({ __esModule: true, default: () => null }));

import SettingsPanel from '../components/SettingsPanel';

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
    listCustomLLMModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
  };
  // Cleared because the chosen view persists in localStorage — without this a
  // test that clicked Advanced would leave later renders in Advanced and this
  // suite would pass for the wrong reason.
  try { window.localStorage.clear(); } catch { /* not available */ }
}

beforeEach(mountElectron);
afterEach(() => { delete (window as any).electron; });

const toggle = (c: HTMLElement) =>
  c.querySelector('input[data-testid="web-reader-fallback"]') as HTMLInputElement;

test('it is in the default view — the whole point of the move', () => {
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={noop} onClose={noop} />);

  expect(container.querySelector('.sp-view-btn[aria-pressed="true"]')?.textContent).toBe('Simple');
  expect(toggle(container)).toBeTruthy();
});

test('it is still there in Advanced — moving it must not hide it from anyone', () => {
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={noop} onClose={noop} />);

  const advancedBtn = Array.from(container.querySelectorAll('.sp-view-btn'))
    .find(b => b.textContent === 'Advanced') as HTMLButtonElement;
  fireEvent.click(advancedBtn);

  expect(toggle(container)).toBeTruthy();
});

test('exactly one control is bound to the setting', () => {
  // It was MOVED, not copied. Two controls on one setting is how the duplicated
  // delete-confirmation shipped, and in Advanced both would be on screen at once.
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={noop} onClose={noop} />);

  const advancedBtn = Array.from(container.querySelectorAll('.sp-view-btn'))
    .find(b => b.textContent === 'Advanced') as HTMLButtonElement;
  fireEvent.click(advancedBtn);

  expect(container.querySelectorAll('input[data-testid="web-reader-fallback"]')).toHaveLength(1);
});

test('absent reads as OFF — the local-first default is unchanged', () => {
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={noop} onClose={noop} />);
  expect(toggle(container).checked).toBe(false);
});

test('turning it on saves true', () => {
  const onSave = jest.fn();
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={onSave} onClose={noop} />);

  fireEvent.click(toggle(container));
  fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0][0].webReaderFallbackEnabled).toBe(true);
});

test('turning it back off saves false', () => {
  const onSave = jest.fn();
  const { container } = render(
    <SettingsPanel
      settings={{ ...BASE, webReaderFallbackEnabled: true } as any}
      onSave={onSave}
      onClose={noop}
    />
  );

  expect(toggle(container).checked).toBe(true);
  fireEvent.click(toggle(container));
  fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

  expect(onSave.mock.calls[0][0].webReaderFallbackEnabled).toBe(false);
});

test('saving without touching it does not silently turn it on', () => {
  // The privacy-relevant direction: nobody should acquire this by pressing Save.
  const onSave = jest.fn();
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={onSave} onClose={noop} />);

  fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

  expect(onSave.mock.calls[0][0].webReaderFallbackEnabled).toBeFalsy();
});
