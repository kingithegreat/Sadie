/** @jest-environment jsdom */

/**
 * The file trigger's UI half: a person can CHOOSE it, see the folder fields,
 * and the payload that reaches IPC carries what was typed. A trigger option
 * that saves as something else is worse than no option — the create handler
 * used to coerce anything that was not "schedule" into "manual", which is
 * asserted here at the handler boundary, not by trusting the form.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import AutomationCenter from '../components/AutomationCenter';

let createAutomation: jest.Mock;
let updateAutomation: jest.Mock;

function mountElectron(automations: any[] = []) {
  createAutomation = jest.fn().mockResolvedValue({ automation: automations[0] ?? null });
  updateAutomation = jest.fn().mockResolvedValue({ success: true });
  (window as any).electron = {
    loadAutomations: jest.fn().mockResolvedValue({ automations }),
    updateAutomation,
    createAutomation,
    deleteAutomation: jest.fn().mockResolvedValue({ success: true }),
    runAutomation: jest.fn().mockResolvedValue({ success: true }),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online' }),
    getSettings: jest.fn().mockResolvedValue({ n8nUrl: 'http://localhost:5678' }),
    licenseStatus: jest.fn().mockResolvedValue({ tier: 'pro' }),
  };
}

beforeEach(() => mountElectron());
afterEach(() => { delete (window as any).electron; });

async function openCreateForm() {
  await act(async () => { render(<AutomationCenter />); });
  await waitFor(() => expect(screen.getByText('No automations yet.')).toBeTruthy());
  fireEvent.click(screen.getByText(/New Automation/));
  await waitFor(() => expect(screen.getByLabelText('Trigger')).toBeTruthy());
}

describe('creating a file-triggered automation', () => {
  test('the trigger picker offers it, and choosing it reveals folder fields', async () => {
    await openCreateForm();

    const select = screen.getByLabelText('Trigger') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toContain('file');

    fireEvent.change(select, { target: { value: 'file' } });
    expect(screen.getByLabelText('Folder to watch')).toBeTruthy();
    expect(screen.getByLabelText(/File name filter/)).toBeTruthy();
  });

  test('Create stays disabled until the folder is filled, then sends watch fields', async () => {
    await openCreateForm();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Invoice watcher' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Summarise it' } });
    fireEvent.change(screen.getByLabelText('Trigger'), { target: { value: 'file' } });

    const createBtn = screen.getByText('Create Automation') as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Folder to watch'), { target: { value: 'C:\\Users\\me\\Downloads\\invoices' } });
    fireEvent.change(screen.getByLabelText(/File name filter/), { target: { value: '*.csv' } });
    expect(createBtn.disabled).toBe(false);

    fireEvent.click(createBtn);
    await waitFor(() => expect(createAutomation).toHaveBeenCalledTimes(1));
    const payload = createAutomation.mock.calls[0][0];
    expect(payload.trigger).toBe('file');
    expect(payload.watchPath).toBe('C:\\Users\\me\\Downloads\\invoices');
    expect(payload.watchPattern).toBe('*.csv');
  });
});

const EXISTING_FILE_AUTO = {
  id: 'auto-9',
  name: 'Download watcher',
  description: '',
  instructions: 'Sort new downloads',
  trigger: 'file' as const,
  watchPath: 'C:\\Users\\me\\Downloads',
  watchPattern: undefined,
  enabled: true,
  createdAt: new Date().toISOString(),
};

describe('editing a file-triggered automation', () => {
  test('folder and pattern prefill from the saved record and reach updateAutomation', async () => {
    mountElectron([EXISTING_FILE_AUTO]);
    await act(async () => { render(<AutomationCenter />); });
    await waitFor(() => expect(screen.getByText('Download watcher')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Edit Download watcher'));
    const pathInput = (await waitFor(() => screen.getByTestId('edit-watch-path'))) as HTMLInputElement;
    expect(pathInput.value).toBe('C:\\Users\\me\\Downloads');

    fireEvent.change(pathInput, { target: { value: 'C:\\Users\\me\\Documents\\scans' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(updateAutomation).toHaveBeenCalledTimes(1));
    const payload = updateAutomation.mock.calls[0][0];
    expect(payload.trigger).toBe('file');
    expect(payload.watchPath).toBe('C:\\Users\\me\\Documents\\scans');
  });

  test('switching the edit form away from file clears the watch on disk', async () => {
    mountElectron([EXISTING_FILE_AUTO]);
    await act(async () => { render(<AutomationCenter />); });
    await waitFor(() => expect(screen.getByText('Download watcher')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Edit Download watcher'));
    fireEvent.change(screen.getByTestId('edit-watch-path'), { target: { value: '' } });
    // Wait for the prefilled input to exist before switching triggers.
    fireEvent.change(screen.getByTitle('Trigger type'), { target: { value: 'manual' } });

    await waitFor(() => expect(screen.queryByTestId('edit-watch-path')).toBeNull());
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(updateAutomation).toHaveBeenCalledTimes(1));
    const payload = updateAutomation.mock.calls[0][0];
    expect(payload.trigger).toBe('manual');
    // Explicit empty strings — clearing must actually clear on disk.
    expect(payload.watchPath).toBe('');
    expect(payload.watchPattern).toBe('');
  });
});
