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

const emptyStat = { count: 0, avg_ms: 0, p50_ms: 0, p95_ms: 0, min_ms: 0, max_ms: 0, last_ms: null };
const sampleStartup = { count: 3, avg_ms: 1200, p50_ms: 1200, p95_ms: 1500, min_ms: 900, max_ms: 1500, last_ms: 1500 };
const sampleFirstToken = { count: 2, avg_ms: 375, p50_ms: 450, p95_ms: 450, min_ms: 300, max_ms: 450, last_ms: 450 };

function baseElectron(getPerfAggregates: jest.Mock) {
  return {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    mcpListServers: jest.fn().mockResolvedValue([]),
    mcpGetStatus: jest.fn().mockResolvedValue([]),
    schedulerList: jest.fn().mockResolvedValue([]),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    getPerfAggregates,
  };
}

function expandSection(container: HTMLElement, label: string) {
  const toggles = Array.from(container.querySelectorAll('.sp-section-toggle'));
  const btn = toggles.find(t => t.textContent?.includes(label)) as HTMLElement | undefined;
  if (btn && btn.textContent?.includes('▸')) fireEvent.click(btn);
}

describe('SettingsPanel — Diagnostics & Performance', () => {
  afterEach(() => {
    delete (window as any).electron;
    jest.clearAllMocks();
  });

  test('renders p50/p95 badges when perf samples exist', async () => {
    const getPerf = jest.fn().mockResolvedValue({ startup: sampleStartup, firstToken: sampleFirstToken });
    (window as any).electron = baseElectron(getPerf);

    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Diagnostics');

    await waitFor(() => expect(getPerf).toHaveBeenCalled());
    await waitFor(() => {
      expect(container.textContent).toContain('p50 1200 ms');
      expect(container.textContent).toContain('p95 1500 ms');
      expect(container.textContent).toContain('p50 450 ms');
    });
  });

  test('shows empty-state when there are no samples', async () => {
    const getPerf = jest.fn().mockResolvedValue({ startup: { ...emptyStat }, firstToken: { ...emptyStat } });
    (window as any).electron = baseElectron(getPerf);

    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Diagnostics');

    await waitFor(() => expect(getPerf).toHaveBeenCalled());
    await waitFor(() => {
      expect(container.textContent).toContain('No performance samples yet');
    });
  });

  test('Refresh re-queries the perf aggregates IPC', async () => {
    const getPerf = jest.fn().mockResolvedValue({ startup: sampleStartup, firstToken: sampleFirstToken });
    (window as any).electron = baseElectron(getPerf);

    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Diagnostics');

    await waitFor(() => expect(getPerf).toHaveBeenCalledTimes(1));

    // Scope to the Performance metrics group — other sections (e.g. Telemetry
    // Consent Log) also render a "Refresh" button, and it appears earlier in the DOM.
    const perfGroup = Array.from(container.querySelectorAll('.setting-group'))
      .find(g => g.textContent?.includes('Performance metrics')) as HTMLElement;
    expect(perfGroup).toBeTruthy();
    const refreshBtn = Array.from(perfGroup.querySelectorAll('button'))
      .find(b => b.textContent === 'Refresh') as HTMLButtonElement;
    expect(refreshBtn).toBeTruthy();
    fireEvent.click(refreshBtn);

    await waitFor(() => expect(getPerf).toHaveBeenCalledTimes(2));
  });
});
