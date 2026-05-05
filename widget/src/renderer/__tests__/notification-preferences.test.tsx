/** @jest-environment jsdom */

import { render, fireEvent } from '@testing-library/react';

// We only need to test the SettingsPanel notification UI
jest.mock('../components/TelemetryConsentModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/TelemetryDashboard', () => ({ __esModule: true, default: () => null }));

import SettingsPanel from '../components/SettingsPanel';

const baseSettings = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space',
};

const noop = () => {};

describe('SettingsPanel — notification preferences', () => {
  beforeEach(() => {
    (window as any).electron = {
      getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
      mcpListServers: jest.fn().mockResolvedValue([]),
      mcpGetStatus: jest.fn().mockResolvedValue([]),
      schedulerList: jest.fn().mockResolvedValue([]),
    };
  });
  afterEach(() => { delete (window as any).electron; });

  function expandSection(container: HTMLElement, label: string) {
    const toggles = Array.from(container.querySelectorAll('.sp-section-toggle'));
    const btn = toggles.find(t => t.textContent?.includes(label)) as HTMLElement | undefined;
    if (btn) fireEvent.click(btn);
  }

  test('renders notification toggle checkboxes', () => {
    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Appearance');
    const labels = Array.from(container.querySelectorAll('.setting-label'));
    expect(labels.some(l => l.textContent?.includes('Notifications'))).toBe(true);
    expect(labels.some(l => l.textContent?.includes('Show toast notifications'))).toBe(true);
    expect(labels.some(l => l.textContent?.includes('Play notification sound'))).toBe(true);
  });

  test('toast duration selector is present with default value', () => {
    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Appearance');
    const select = container.querySelector('select[aria-label="Toast notification duration"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('8000');
  });

  test('notification settings are persisted on save', () => {
    const onSave = jest.fn();
    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={onSave} onClose={noop} />
    );
    expandSection(container, 'Appearance');
    // Change duration
    const select = container.querySelector('select[aria-label="Toast notification duration"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '3000' } });

    // Click save
    const saveBtn = container.querySelector('.button-save')!;
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.notificationDuration).toBe(3000);
    expect(saved.notificationsEnabled).toBe(true);
  });
});
