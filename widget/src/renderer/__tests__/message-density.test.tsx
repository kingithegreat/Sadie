/** @jest-environment jsdom */

import { render, fireEvent } from '@testing-library/react';

jest.mock('../components/TelemetryConsentModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/TelemetryDashboard', () => ({ __esModule: true, default: () => null }));

import SettingsPanel from '../components/SettingsPanel';

const baseSettings = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space',
};

const noop = () => {};

describe('SettingsPanel — message density', () => {
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
    if (btn && btn.textContent?.includes('▸')) fireEvent.click(btn);
  }

  test('renders density options with 3 buttons', () => {
    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Appearance');
    const buttons = container.querySelectorAll('.density-btn');
    expect(buttons.length).toBe(3);
    const labels = Array.from(buttons).map(b => b.textContent);
    expect(labels).toEqual(['Compact', 'Comfortable', 'Spacious']);
  });

  test('comfortable is active by default', () => {
    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Appearance');
    const buttons = container.querySelectorAll('.density-btn');
    const active = Array.from(buttons).find(b => b.classList.contains('active'));
    expect(active).not.toBeUndefined();
    expect(active!.textContent).toBe('Comfortable');
  });

  test('clicking compact selects it', () => {
    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Appearance');
    const buttons = container.querySelectorAll('.density-btn');
    fireEvent.click(buttons[0]); // Compact
    expect(buttons[0].classList.contains('active')).toBe(true);
  });

  test('density is persisted on save', () => {
    const onSave = jest.fn();
    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={onSave} onClose={noop} />
    );
    expandSection(container, 'Appearance');
    const buttons = container.querySelectorAll('.density-btn');
    fireEvent.click(buttons[2]); // Spacious

    const saveBtn = container.querySelector('.button-save')!;
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.messageDensity).toBe('spacious');
  });
});
