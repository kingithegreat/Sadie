/** @jest-environment jsdom */

/**
 * Editing an automation reaches every field creating one does.
 *
 * The create form collected name, description, instructions, trigger, interval
 * and an optional workflow webhook URL. The edit form collected four of those —
 * description and the webhook URL were missing — so both could be set once and
 * never changed.
 *
 * The main-process handler had accepted both all along
 * (`if (data.description !== undefined)`, `if (data.n8nWebhookUrl !== undefined)`);
 * only the interface never sent them, and the typed preload bridge would not
 * even permit it. A stored value was uneditable by omission rather than by
 * design — which is this codebase's usual shape, one level down.
 *
 * These assert what `updateAutomation` RECEIVES, because a field that renders
 * and never reaches disk is the same defect wearing an input box.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import AutomationCenter from '../components/AutomationCenter';

const EXISTING = {
  id: 'auto-1',
  name: 'Morning digest',
  description: 'A short summary each morning',
  instructions: 'Summarise the news',
  trigger: 'manual' as const,
  enabled: true,
  n8nWebhookUrl: 'http://localhost:5678/webhook/abc',
  createdAt: new Date().toISOString(),
};

let updateAutomation: jest.Mock;

function mountElectron(automations: any[] = [EXISTING]) {
  updateAutomation = jest.fn().mockResolvedValue({ success: true });
  (window as any).electron = {
    loadAutomations: jest.fn().mockResolvedValue({ automations }),
    updateAutomation,
    createAutomation: jest.fn().mockResolvedValue({ success: true }),
    deleteAutomation: jest.fn().mockResolvedValue({ success: true }),
    runAutomation: jest.fn().mockResolvedValue({ success: true }),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online' }),
    getSettings: jest.fn().mockResolvedValue({ n8nUrl: 'http://localhost:5678' }),
    licenseStatus: jest.fn().mockResolvedValue({ tier: 'pro' }),
  };
}

async function openEditor() {
  await act(async () => { render(<AutomationCenter />); });
  await waitFor(() => expect(screen.getByText('Morning digest')).toBeTruthy());
  fireEvent.click(screen.getByLabelText('Edit Morning digest'));
  await waitFor(() => expect(screen.getByTestId('edit-description')).toBeTruthy());
}

beforeEach(() => mountElectron());
afterEach(() => { delete (window as any).electron; });

describe('the two fields that were missing', () => {
  test('the description field exists and is prefilled from the saved value', async () => {
    await openEditor();
    expect((screen.getByTestId('edit-description') as HTMLInputElement).value)
      .toBe('A short summary each morning');
  });

  test('the webhook field exists and is prefilled from the saved value', async () => {
    await openEditor();
    expect((screen.getByTestId('edit-n8n-url') as HTMLInputElement).value)
      .toBe('http://localhost:5678/webhook/abc');
  });
});

describe('what actually reaches the handler', () => {
  test('an edited description is sent, not just displayed', async () => {
    await openEditor();
    fireEvent.change(screen.getByTestId('edit-description'), { target: { value: 'Now a weekly digest' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(updateAutomation).toHaveBeenCalled());
    expect(updateAutomation.mock.calls[0][0].description).toBe('Now a weekly digest');
  });

  test('an edited webhook URL is sent', async () => {
    await openEditor();
    fireEvent.change(screen.getByTestId('edit-n8n-url'), { target: { value: 'http://localhost:5678/webhook/new' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(updateAutomation).toHaveBeenCalled());
    expect(updateAutomation.mock.calls[0][0].n8nWebhookUrl).toBe('http://localhost:5678/webhook/new');
  });

  test('CLEARING the webhook sends an empty string, so it actually detaches', async () => {
    // The important one. Omitting the key instead would leave the stale URL in
    // place and read as though the edit had been ignored — the handler maps ''
    // to undefined, but only if it receives the key at all.
    await openEditor();
    fireEvent.change(screen.getByTestId('edit-n8n-url'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(updateAutomation).toHaveBeenCalled());
    expect(updateAutomation.mock.calls[0][0]).toHaveProperty('n8nWebhookUrl');
    expect(updateAutomation.mock.calls[0][0].n8nWebhookUrl).toBe('');
  });

  test('the fields that already worked still reach the handler', async () => {
    // Adding two must not drop the four that were fine.
    await openEditor();
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(updateAutomation).toHaveBeenCalled());
    const sent = updateAutomation.mock.calls[0][0];
    expect(sent.id).toBe('auto-1');
    expect(sent.name).toBe('Morning digest');
    expect(sent.instructions).toBe('Summarise the news');
    expect(sent.trigger).toBe('manual');
  });
});

describe('an automation with neither field set', () => {
  test('opens with empty boxes rather than crashing on undefined', async () => {
    mountElectron([{ ...EXISTING, description: undefined, n8nWebhookUrl: undefined }]);
    await openEditor();
    expect((screen.getByTestId('edit-description') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('edit-n8n-url') as HTMLInputElement).value).toBe('');
  });
});
