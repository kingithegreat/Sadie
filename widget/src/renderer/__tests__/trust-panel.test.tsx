/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TrustPanel from '../components/TrustPanel';

const getSupervisorStatus = jest.fn();
const getCrmActivity = jest.fn();
const onSupervisorStatus = jest.fn();
const unsubscribe = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  onSupervisorStatus.mockReturnValue(unsubscribe);
  (window as any).electron = { getSupervisorStatus, getCrmActivity, onSupervisorStatus };
});

const healthyStatus = {
  success: true,
  status: {
    startedAt: 1,
    stopped: false,
    services: [
      { name: 'ollama', health: 'healthy', required: true, totalRecoveries: 0, lastOkAt: Date.now() },
      { name: 'n8n', health: 'recovering', required: true, totalRecoveries: 2, lastOkAt: Date.now() - 5000 },
      { name: 'qdrant', health: 'down', required: false, totalRecoveries: 0, lastOkAt: null },
    ],
  },
};

const activity = {
  success: true,
  items: [
    {
      id: 42,
      at: '2026-08-02T03:00:00.000Z',
      summary: 'Advanced deal “Website rebuild”: qualified → proposal',
      toolName: 'crm_advance_deal',
      actor: 'sadie',
      changes: [{ field: 'stage', from: 'qualified', to: 'proposal' }],
    },
    {
      id: 41,
      at: '2026-08-02T02:00:00.000Z',
      summary: 'Created company “Bayfair Fitness”',
      toolName: 'crm_create_company',
      actor: 'sadie',
      changes: [],
    },
  ],
};

describe('TrustPanel', () => {
  test('renders nothing when closed and subscribes/unsubscribes with open state', async () => {
    getSupervisorStatus.mockResolvedValue(healthyStatus);
    getCrmActivity.mockResolvedValue(activity);
    const { rerender, unmount } = render(<TrustPanel open={false} onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSupervisorStatus).not.toHaveBeenCalled();

    rerender(<TrustPanel open={true} onClose={() => undefined} />);
    await waitFor(() => expect(onSupervisorStatus).toHaveBeenCalledTimes(1));
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  test('shows service health with recovery count and activity summaries', async () => {
    getSupervisorStatus.mockResolvedValue(healthyStatus);
    getCrmActivity.mockResolvedValue(activity);
    render(<TrustPanel open={true} onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByText(/ollama — healthy/)).toBeTruthy());
    expect(screen.getByText(/n8n — recovering/)).toBeTruthy();
    expect(screen.getByText(/auto-recovered ×2/)).toBeTruthy();
    expect(screen.getByText(/qdrant — down \(optional\)/)).toBeTruthy();
    expect(screen.getByText('Advanced deal “Website rebuild”: qualified → proposal')).toBeTruthy();
    expect(screen.getByText('Created company “Bayfair Fitness”')).toBeTruthy();
  });

  test('expands field-level changes on demand', async () => {
    getSupervisorStatus.mockResolvedValue(healthyStatus);
    getCrmActivity.mockResolvedValue(activity);
    render(<TrustPanel open={true} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByText('1 field')).toBeTruthy());

    fireEvent.click(screen.getByText('1 field'));
    expect(screen.getByText(/stage: qualified → proposal/)).toBeTruthy();
    fireEvent.click(screen.getByText('Hide'));
    expect(screen.queryByText(/stage: qualified → proposal/)).toBeNull();
  });

  test('supervision-off (null status) and empty activity render honest empty states', async () => {
    getSupervisorStatus.mockResolvedValue({ success: true, status: null });
    getCrmActivity.mockResolvedValue({ success: true, items: [] });
    render(<TrustPanel open={true} onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByText('Supervision is off in this mode')).toBeTruthy());
    expect(screen.getByText(/No CRM activity yet/)).toBeTruthy();
  });

  test('a supervisor push re-pulls the snapshot and updates the strip', async () => {
    getSupervisorStatus.mockResolvedValueOnce(healthyStatus);
    getCrmActivity.mockResolvedValue(activity);
    render(<TrustPanel open={true} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/n8n — recovering/)).toBeTruthy());

    const updated = JSON.parse(JSON.stringify(healthyStatus));
    updated.status.services[1].health = 'healthy';
    getSupervisorStatus.mockResolvedValueOnce(updated);

    const pushCallback = onSupervisorStatus.mock.calls[0][0];
    pushCallback({ service: 'n8n', from: 'recovering', to: 'healthy', at: Date.now() });

    await waitFor(() => expect(screen.getByText(/n8n — healthy/)).toBeTruthy());
  });
});
