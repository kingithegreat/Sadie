/** @jest-environment jsdom */

/**
 * Turning the morning briefing off.
 *
 * From the 2026-08-22 reachability audit. `morning-briefing.ts` says in its own
 * header:
 *
 *     • Respects user opt-out via settings.morningBriefing === false
 *
 * and `shouldOfferBriefing()` does exactly that. But `settings.morningBriefing`
 * was read there and written NOWHERE — no control, no default, no migration.
 * The briefing was therefore on for everyone permanently, and the opt-out the
 * code documents could not be exercised.
 *
 * Same shape as `saveConversationHistory` before it: a setting the code honours
 * and the interface cannot reach.
 *
 * These drive the panel and assert what `onSave` RECEIVES, because a checkbox
 * that toggles and never reaches disk is the same defect wearing a tick.
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
  try { window.localStorage.clear(); } catch { /* not available */ }
}

beforeEach(mountElectron);
afterEach(() => { delete (window as any).electron; });

const toggle = (c: HTMLElement) => c.querySelector('input[data-testid="morning-briefing"]') as HTMLInputElement;

test('the control exists — the opt-out is reachable at all', () => {
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={noop} onClose={noop} />);
  expect(toggle(container)).toBeTruthy();
});

test('it is in the default view, not buried under Advanced', () => {
  // A proactive behaviour that surprises people should be switchable without
  // hunting for it.
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={noop} onClose={noop} />);
  expect(container.querySelector('.sp-view-btn[aria-pressed="true"]')?.textContent).toBe('Simple');
  expect(toggle(container)).toBeTruthy();
});

test('undefined reads as ON — the behaviour everyone already has', () => {
  // morning-briefing.ts tests `=== false`, so absent means enabled. The box has
  // to agree, or it would show OFF while briefings kept arriving.
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={noop} onClose={noop} />);
  expect(toggle(container).checked).toBe(true);
});

test('an explicit false reads as OFF', () => {
  const { container } = render(
    <SettingsPanel settings={{ ...BASE, morningBriefing: false } as any} onSave={noop} onClose={noop} />
  );
  expect(toggle(container).checked).toBe(false);
});

test('turning it off SAVES false — the value shouldOfferBriefing looks for', () => {
  const onSave = jest.fn();
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={onSave} onClose={noop} />);

  fireEvent.click(toggle(container));
  fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

  expect(onSave).toHaveBeenCalledTimes(1);
  // Strictly false, not undefined and not falsy-by-omission: the check is
  // `=== false`, so anything else leaves the briefing on.
  expect(onSave.mock.calls[0][0].morningBriefing).toBe(false);
});

test('turning it back on saves true', () => {
  const onSave = jest.fn();
  const { container } = render(
    <SettingsPanel settings={{ ...BASE, morningBriefing: false } as any} onSave={onSave} onClose={noop} />
  );

  fireEvent.click(toggle(container));
  fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

  expect(onSave.mock.calls[0][0].morningBriefing).toBe(true);
});

test('saving without touching it does not silently turn it off', () => {
  const onSave = jest.fn();
  const { container } = render(<SettingsPanel settings={BASE as any} onSave={onSave} onClose={noop} />);

  fireEvent.click(container.querySelector('.button-save') as HTMLButtonElement);

  expect(onSave.mock.calls[0][0].morningBriefing).not.toBe(false);
});
