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

const sampleStartup = { count: 3, avg_ms: 1200, p50_ms: 1200, p95_ms: 1500, min_ms: 900, max_ms: 1500, last_ms: 1500 };
const sampleFirstToken = { count: 2, avg_ms: 375, p50_ms: 450, p95_ms: 450, min_ms: 300, max_ms: 450, last_ms: 450 };
const emptyStat = { count: 0, avg_ms: 0, p50_ms: 0, p95_ms: 0, min_ms: 0, max_ms: 0, last_ms: null };

function electronWith(getPerfAggregates: jest.Mock, getPerfHistory: jest.Mock) {
  return {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    mcpListServers: jest.fn().mockResolvedValue([]),
    mcpGetStatus: jest.fn().mockResolvedValue([]),
    schedulerList: jest.fn().mockResolvedValue([]),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    getPerfAggregates,
    getPerfHistory,
  };
}

/**
 * Settings opens in the Simple view, which shows only the essentials (which
 * model answers, the privacy switch, voice, appearance). Everything this file
 * asserts on lives under Advanced, so switch there before looking for it.
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

describe('SettingsPanel — perf trend sparkline', () => {
  afterEach(() => {
    delete (window as any).electron;
    jest.clearAllMocks();
  });

  test('renders an SVG sparkline when history has 2+ samples', async () => {
    const getPerf = jest.fn().mockResolvedValue({ startup: sampleStartup, firstToken: sampleFirstToken });
    const getHist = jest.fn().mockResolvedValue({ startup: [900, 1200, 1500], firstToken: [300, 450] });
    (window as any).electron = electronWith(getPerf, getHist);

    const { container } = render(<SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />);
    expandSection(container, 'Diagnostics');

    await waitFor(() => expect(getHist).toHaveBeenCalled());
    await waitFor(() => {
      const svgs = container.querySelectorAll('svg.perf-sparkline');
      expect(svgs.length).toBeGreaterThanOrEqual(1);
      expect(container.textContent).toContain('latest 1500 ms');
    });
  });

  test('does not render a sparkline when history has fewer than 2 samples', async () => {
    const getPerf = jest.fn().mockResolvedValue({ startup: { ...emptyStat, count: 1, last_ms: 1000 }, firstToken: { ...emptyStat } });
    const getHist = jest.fn().mockResolvedValue({ startup: [1000], firstToken: [] });
    (window as any).electron = electronWith(getPerf, getHist);

    const { container } = render(<SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />);
    expandSection(container, 'Diagnostics');

    await waitFor(() => expect(getHist).toHaveBeenCalled());
    await waitFor(() => expect(getPerf).toHaveBeenCalled());
    expect(container.querySelectorAll('svg.perf-sparkline').length).toBe(0);
  });

  test('Refresh re-queries the history IPC', async () => {
    const getPerf = jest.fn().mockResolvedValue({ startup: sampleStartup, firstToken: sampleFirstToken });
    const getHist = jest.fn().mockResolvedValue({ startup: [900, 1200, 1500], firstToken: [300, 450] });
    (window as any).electron = electronWith(getPerf, getHist);

    const { container } = render(<SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />);
    expandSection(container, 'Diagnostics');

    await waitFor(() => expect(getHist).toHaveBeenCalledTimes(1));
    // Scope to the Performance metrics group — other sections (e.g. Telemetry
    // Consent Log) also render a "Refresh" button, and it appears earlier in the DOM.
    const perfGroup = Array.from(container.querySelectorAll('.setting-group'))
      .find(g => g.textContent?.includes('Performance metrics')) as HTMLElement;
    const refreshBtn = Array.from(perfGroup.querySelectorAll('button')).find(b => b.textContent === 'Refresh') as HTMLButtonElement;
    fireEvent.click(refreshBtn);
    await waitFor(() => expect(getHist).toHaveBeenCalledTimes(2));
  });
});
