/** @jest-environment jsdom */

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import AdvancedSettingsTab from '../components/settings/AdvancedSettingsTab';
import { SettingsProvider } from '../components/settings/SettingsContext';
import { useSettingsState } from '../components/settings/useSettingsState';

test('Settings support-report copy records a failure state', async () => {
  (window as any).electron = {
    writeClipboard: jest.fn().mockResolvedValue({ success: false, error: 'denied' }),
  };
  const settings = {} as any;
  const onSave = jest.fn();
  const onClose = jest.fn();
  const { result } = renderHook(() => useSettingsState({ settings, onSave, onClose }));

  await act(async () => { await result.current.copySupportReport(); });
  expect(result.current.reportCopied).toBe(false);
  expect(result.current.reportCopyFailed).toBe(true);
});

test('Settings support-report copy renders a visible failure', async () => {
  (window as any).electron = {
    writeClipboard: jest.fn().mockResolvedValue({ success: false, error: 'denied' }),
  };
  const settings = {} as any;
  const onSave = jest.fn();
  const onClose = jest.fn();
  function SettingsHarness() {
    const state = useSettingsState({ settings, onSave, onClose });
    return (
      <SettingsProvider value={state}>
        <AdvancedSettingsTab />
      </SettingsProvider>
    );
  }

  render(<SettingsHarness />);
  fireEvent.click(screen.getByRole('button', { name: /Diagnostics & Performance/i }));
  fireEvent.click(await screen.findByRole('button', { name: /Copy support report/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copy failed' })).toBeVisible());
});
