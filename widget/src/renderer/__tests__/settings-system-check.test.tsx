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

function baseElectron(runDiagnostics: jest.Mock) {
  return {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    mcpListServers: jest.fn().mockResolvedValue([]),
    mcpGetStatus: jest.fn().mockResolvedValue([]),
    schedulerList: jest.fn().mockResolvedValue([]),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    getPerfAggregates: jest.fn().mockResolvedValue({ startup: { ...emptyStat }, firstToken: { ...emptyStat } }),
    getPerfHistory: jest.fn().mockResolvedValue({ startup: [], firstToken: [] }),
    runDiagnostics,
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

const sampleReport = {
  disk: { freeGB: 42.5, ok: true, warning: null },
  ollama: { reachable: true, url: 'http://localhost:11434', statusCode: 200, latencyMs: 12 },
  n8n: { reachable: false, url: 'http://localhost:5678', statusCode: null, latencyMs: null },
  qdrant: { reachable: true, url: 'http://localhost:6333', statusCode: 200, latencyMs: 8 },
  permissions: { canWrite: true, path: '/userData' },
  hardware: { vramGB: 8, gpuName: 'NVIDIA RTX 4060', profile: '8gb' },
  durationMs: 120,
  timestamp: new Date('2026-06-30T00:00:00Z').toISOString(),
};

describe('SettingsPanel — System check', () => {
  afterEach(() => {
    delete (window as any).electron;
    jest.clearAllMocks();
  });

  function findInSysCheckGroup(container: HTMLElement, label: string) {
    const group = Array.from(container.querySelectorAll('.setting-group'))
      .find(g => g.textContent?.includes('System check')) as HTMLElement | undefined;
    return Array.from(group?.querySelectorAll('button') ?? [])
      .find(b => b.textContent?.includes(label)) as HTMLButtonElement | undefined;
  }

  test('runs diagnostics on click and renders each check', async () => {
    const runDiagnostics = jest.fn().mockResolvedValue(sampleReport);
    (window as any).electron = baseElectron(runDiagnostics);

    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Diagnostics');

    const runBtn = findInSysCheckGroup(container, 'Run system check');
    expect(runBtn).toBeTruthy();
    fireEvent.click(runBtn!);

    await waitFor(() => expect(runDiagnostics).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const text = container.textContent || '';
      expect(text).toContain('42.5 GB free');
      expect(text).toContain('Ollama');
      expect(text).toContain('online (12 ms)');
      expect(text).toContain('n8n');
      expect(text).toContain('offline');
      expect(text).toContain('NVIDIA RTX 4060');
    });

    // Button flips to a re-run label once results are present
    await waitFor(() => expect(findInSysCheckGroup(container, 'Re-run system check')).toBeTruthy());
  });

  test('shows an error when the diagnostics IPC is unavailable', async () => {
    const runDiagnostics = jest.fn().mockResolvedValue(undefined);
    (window as any).electron = baseElectron(runDiagnostics);

    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Diagnostics');

    fireEvent.click(findInSysCheckGroup(container, 'Run system check')!);

    await waitFor(() => expect(container.textContent).toContain('System check is unavailable'));
  });
});
