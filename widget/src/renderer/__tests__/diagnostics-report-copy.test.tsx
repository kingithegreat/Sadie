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

function expandSection(container: HTMLElement, label: string) {
  const toggles = Array.from(container.querySelectorAll('.sp-section-toggle'));
  const btn = toggles.find(t => t.textContent?.includes(label)) as HTMLElement | undefined;
  if (btn && btn.textContent?.includes('▸')) fireEvent.click(btn);
}

describe('SettingsPanel — Copy diagnostics report', () => {
  afterEach(() => {
    delete (window as any).electron;
    jest.clearAllMocks();
  });

  test('writes a redacted diagnostics report to the clipboard', async () => {
    const writeClipboard = jest.fn();
    const getPerf = jest.fn().mockResolvedValue({ startup: sampleStartup, firstToken: sampleFirstToken });
    const getEnv = jest.fn().mockResolvedValue({
      isE2E: false, isPackagedBuild: true, isReleaseBuild: true,
      userDataPath: 'C:\\Users\\Aden\\AppData\\Roaming\\HomeBot',
    });
    (window as any).electron = {
      getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
      mcpListServers: jest.fn().mockResolvedValue([]),
      mcpGetStatus: jest.fn().mockResolvedValue([]),
      schedulerList: jest.fn().mockResolvedValue([]),
      listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
      getPerfAggregates: getPerf,
      getEnv,
      writeClipboard,
    };

    const { container } = render(
      <SettingsPanel settings={baseSettings as any} onSave={noop} onClose={noop} />
    );
    expandSection(container, 'Diagnostics');
    await waitFor(() => expect(getPerf).toHaveBeenCalled());

    const perfGroup = Array.from(container.querySelectorAll('.setting-group'))
      .find(g => g.textContent?.includes('Performance metrics')) as HTMLElement;
    const copyBtn = Array.from(perfGroup.querySelectorAll('button'))
      .find(b => b.textContent === 'Copy diagnostics report') as HTMLButtonElement;
    expect(copyBtn).toBeTruthy();
    fireEvent.click(copyBtn);

    await waitFor(() => expect(writeClipboard).toHaveBeenCalledTimes(1));
    const report = writeClipboard.mock.calls[0][0] as string;
    expect(report).toContain('# HomeBot diagnostics report');
    expect(report).toContain('- Build: packaged, release');
    expect(report).toContain('Data folder: ~\\AppData\\Roaming\\HomeBot');
    expect(report).not.toContain('Aden');
    // good perf sample → Good health
    expect(report).toContain('Overall health: Good');

    // button shows confirmation text after click
    await waitFor(() => expect(copyBtn.textContent).toContain('Copied report'));
  });
});
