/** @jest-environment jsdom */
/**
 * permission-history.test.tsx
 * Tests for src/renderer/components/PermissionHistory.tsx
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PermissionHistory from '../components/PermissionHistory';

function setup(overrides?: {
  readPermissionAudit?: () => Promise<any>;
  clearPermissionAudit?: () => Promise<any>;
}) {
  const readPermissionAudit =
    overrides?.readPermissionAudit ?? jest.fn().mockResolvedValue({ success: true, events: [] });
  const clearPermissionAudit =
    overrides?.clearPermissionAudit ?? jest.fn().mockResolvedValue({ success: true });
  (window as any).electron = { readPermissionAudit, clearPermissionAudit };
  return { readPermissionAudit, clearPermissionAudit };
}

afterEach(() => {
  delete (window as any).electron;
  jest.clearAllMocks();
});

const sampleEvents = [
  { id: 'a', timestamp: new Date().toISOString(), permissions: ['write_file'], reason: 'Save a report', decision: 'allow_once' },
  { id: 'b', timestamp: new Date().toISOString(), permissions: ['network_access'], reason: 'Fetch a page', decision: 'always_allow' },
  { id: 'c', timestamp: new Date().toISOString(), permissions: ['delete_file'], reason: 'Remove a file', decision: 'cancel' },
];

describe('PermissionHistory — open/closed', () => {
  test('renders nothing when open=false', () => {
    setup();
    const { container } = render(<PermissionHistory open={false} onClose={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders the dialog when open=true', async () => {
    setup();
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    expect(await screen.findByText('Permission History')).toBeInTheDocument();
  });

  test('does not call the audit API while closed', () => {
    const { readPermissionAudit } = setup();
    render(<PermissionHistory open={false} onClose={jest.fn()} />);
    expect(readPermissionAudit).not.toHaveBeenCalled();
  });
});

describe('PermissionHistory — empty state', () => {
  test('shows the empty message when there are no entries', async () => {
    setup();
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    expect(await screen.findByText(/No permission requests recorded yet/i)).toBeInTheDocument();
  });

  test('falls back to empty when the API reports failure', async () => {
    setup({ readPermissionAudit: jest.fn().mockResolvedValue({ success: false, error: 'boom' }) });
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    expect(await screen.findByText(/No permission requests recorded yet/i)).toBeInTheDocument();
  });
});

describe('PermissionHistory — entries', () => {
  test('renders each decision with its human-readable label and reason', async () => {
    setup({ readPermissionAudit: jest.fn().mockResolvedValue({ success: true, events: sampleEvents }) });
    render(<PermissionHistory open={true} onClose={jest.fn()} />);

    // Permission name underscores are humanised.
    expect(await screen.findByText('write file')).toBeInTheDocument();
    expect(screen.getByText('network access')).toBeInTheDocument();

    // Decision labels appear.
    expect(screen.getByText(/Allowed once/)).toBeInTheDocument();
    expect(screen.getByText(/Always allowed/)).toBeInTheDocument();
    expect(screen.getByText(/Denied/)).toBeInTheDocument();

    // Reasons appear.
    expect(screen.getByText(/Save a report/)).toBeInTheDocument();
  });

  test('shows newest entries first', async () => {
    setup({ readPermissionAudit: jest.fn().mockResolvedValue({ success: true, events: sampleEvents }) });
    const { container } = render(<PermissionHistory open={true} onClose={jest.fn()} />);
    await screen.findByText('write file');
    const items = container.querySelectorAll('.notif-item');
    expect(items).toHaveLength(3);
    // Last recorded (delete_file) should be first in the list.
    expect(items[0].textContent).toContain('delete file');
  });
});

describe('PermissionHistory — actions', () => {
  test('Clear all calls clearPermissionAudit and empties the list', async () => {
    const { clearPermissionAudit } = setup({
      readPermissionAudit: jest.fn().mockResolvedValue({ success: true, events: sampleEvents }),
    });
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    const clearBtn = await screen.findByText('Clear all');
    fireEvent.click(clearBtn);
    await waitFor(() => expect(clearPermissionAudit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/No permission requests recorded yet/i)).toBeInTheDocument();
  });

  test('Clear all button is hidden when there are no entries', async () => {
    setup();
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    await screen.findByText(/No permission requests recorded yet/i);
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
  });

  test('close button invokes onClose', async () => {
    setup();
    const onClose = jest.fn();
    render(<PermissionHistory open={true} onClose={onClose} />);
    const closeBtn = await screen.findByLabelText('Close permission history');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
