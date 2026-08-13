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
  exportPermissionAudit?: () => Promise<any>;
  getSettings?: () => Promise<any>;
  saveSettings?: (s: any) => Promise<any>;
}) {
  const readPermissionAudit =
    overrides?.readPermissionAudit ?? jest.fn().mockResolvedValue({ success: true, events: [] });
  const clearPermissionAudit =
    overrides?.clearPermissionAudit ?? jest.fn().mockResolvedValue({ success: true });
  const exportPermissionAudit =
    overrides?.exportPermissionAudit ?? jest.fn().mockResolvedValue({ success: true, path: '/tmp/export.json' });
  // Empty permissions by default so the "always allowed" section stays hidden
  // and does not interfere with the log-focused tests.
  const getSettings = overrides?.getSettings ?? jest.fn().mockResolvedValue({ permissions: {} });
  const saveSettings = overrides?.saveSettings ?? jest.fn().mockResolvedValue({});
  (window as any).electron = { readPermissionAudit, clearPermissionAudit, exportPermissionAudit, getSettings, saveSettings };
  return { readPermissionAudit, clearPermissionAudit, exportPermissionAudit, getSettings, saveSettings };
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
  // The panel portals to document.body so the blanket `.app-container > *`
  // rule cannot lay it out as a page row (see PermissionHistory.tsx), which
  // puts it outside RTL's `container`. `container.firstChild` is therefore null
  // whether it is open or not — it would pass this test vacuously — so the
  // closed state is asserted against the document instead.
  test('renders nothing when open=false', () => {
    setup();
    render(<PermissionHistory open={false} onClose={jest.fn()} />);
    expect(document.querySelector('[data-role="permission-history"]')).toBeNull();
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
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    await screen.findByText('write file');
    const items = document.querySelectorAll('.notif-item');
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

describe('PermissionHistory — export', () => {
  test('Export button calls exportPermissionAudit and shows the path', async () => {
    const { exportPermissionAudit } = setup();
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    const btn = await screen.findByText('Export');
    fireEvent.click(btn);
    await waitFor(() => expect(exportPermissionAudit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Exported to \/tmp\/export\.json/)).toBeInTheDocument();
  });
});

describe('PermissionHistory — always-allowed revoke', () => {
  const grantedEvents = [
    { id: 'g1', timestamp: new Date().toISOString(), permissions: ['write_file'], reason: 'Save', decision: 'always_allow' },
  ];

  test('lists permissions granted via always-allow that are still enabled', async () => {
    setup({
      readPermissionAudit: jest.fn().mockResolvedValue({ success: true, events: grantedEvents }),
      getSettings: jest.fn().mockResolvedValue({ permissions: { write_file: true } }),
    });
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    expect(await screen.findByText(/won't ask again/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Revoke write file/i)).toBeInTheDocument();
  });

  test('Revoke persists the permission as disabled and removes it from the list', async () => {
    const { saveSettings } = setup({
      readPermissionAudit: jest.fn().mockResolvedValue({ success: true, events: grantedEvents }),
      getSettings: jest.fn().mockResolvedValue({ permissions: { write_file: true } }),
    });
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    const revokeBtn = await screen.findByLabelText(/Revoke write file/i);
    fireEvent.click(revokeBtn);
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect((saveSettings as jest.Mock).mock.calls[0][0].permissions.write_file).toBe(false);
    await waitFor(() => expect(screen.queryByLabelText(/Revoke write file/i)).not.toBeInTheDocument());
  });

  test('does not show the always-allowed section when a granted perm is no longer enabled', async () => {
    setup({
      readPermissionAudit: jest.fn().mockResolvedValue({ success: true, events: grantedEvents }),
      getSettings: jest.fn().mockResolvedValue({ permissions: { write_file: false } }),
    });
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    await screen.findByText('Permission History');
    expect(screen.queryByText(/won't ask again/)).not.toBeInTheDocument();
  });

  test('read-only safe defaults (never prompted) do not appear as revocable', async () => {
    setup({
      readPermissionAudit: jest.fn().mockResolvedValue({ success: true, events: [] }),
      getSettings: jest.fn().mockResolvedValue({ permissions: { read_file: true, list_directory: true } }),
    });
    render(<PermissionHistory open={true} onClose={jest.fn()} />);
    await screen.findByText('Permission History');
    expect(screen.queryByText(/won't ask again/)).not.toBeInTheDocument();
  });
});
