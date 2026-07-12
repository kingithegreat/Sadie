/** @jest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import PermissionModal from '../components/PermissionModal';

const PERMS = ['file_read', 'file_write'];

function makeElectron() {
  return {
    sendPermissionResponse: jest.fn(),
    getSettings: jest.fn().mockResolvedValue({ permissions: {} }),
    saveSettings: jest.fn().mockResolvedValue({}),
  };
}

function setup(overrides: Partial<Parameters<typeof PermissionModal>[0]> = {}) {
  const onClose = jest.fn();
  const el = makeElectron();
  (window as any).electron = el;
  const props = {
    open: true,
    missingPermissions: PERMS,
    requestId: 'req-123',
    onClose,
    ...overrides,
  };
  const utils = render(<PermissionModal {...props} />);
  return { ...utils, onClose, el };
}

afterEach(() => {
  delete (window as any).electron;
});

// ─── closed / missing requestId ───────────────────────────────────────────────

test('renders nothing when open=false', () => {
  const { container } = setup({ open: false });
  expect(container.firstChild).toBeNull();
});

test('renders nothing when requestId is undefined', () => {
  const { container } = setup({ requestId: undefined });
  expect(container.firstChild).toBeNull();
});

// ─── visible state ────────────────────────────────────────────────────────────

test('renders "Permission Required" heading', () => {
  setup();
  expect(screen.getByText('Permission Required')).toBeInTheDocument();
});

test('renders each permission with underscores replaced by spaces', () => {
  setup();
  expect(screen.getByText('file read')).toBeInTheDocument();
  expect(screen.getByText('file write')).toBeInTheDocument();
});

test('shows custom reason when provided', () => {
  setup({ reason: 'Custom leason text' });
  expect(screen.getByText('Custom leason text')).toBeInTheDocument();
});

test('shows default reason when reason is omitted', () => {
  setup({ reason: undefined });
  expect(screen.getByText(/This action will modify files/)).toBeInTheDocument();
});

test('renders Cancel, Allow once, and Always allow buttons', () => {
  setup();
  expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /allow once/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /always allow/i })).toBeInTheDocument();
});

// ─── Cancel ───────────────────────────────────────────────────────────────────

test('Cancel calls sendPermissionResponse with "cancel"', () => {
  const { el } = setup();
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  expect(el.sendPermissionResponse).toHaveBeenCalledWith('req-123', 'cancel');
});

test('Cancel calls onClose', () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  expect(onClose).toHaveBeenCalled();
});

// ─── Allow once ───────────────────────────────────────────────────────────────

test('Allow once calls sendPermissionResponse with allow_once + perms', () => {
  const { el } = setup();
  fireEvent.click(screen.getByRole('button', { name: /allow once/i }));
  expect(el.sendPermissionResponse).toHaveBeenCalledWith('req-123', 'allow_once', PERMS);
});

test('Allow once calls onClose', () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByRole('button', { name: /allow once/i }));
  expect(onClose).toHaveBeenCalled();
});

// ─── Always allow ─────────────────────────────────────────────────────────────

test('Always allow calls getSettings and saveSettings', async () => {
  const { el } = setup();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /always allow/i })); });
  expect(el.getSettings).toHaveBeenCalled();
  expect(el.saveSettings).toHaveBeenCalled();
});

test('Always allow saves permissions for each missing perm', async () => {
  const { el } = setup();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /always allow/i })); });
  const saved = el.saveSettings.mock.calls[0][0];
  expect(saved.permissions.file_read).toBe(true);
  expect(saved.permissions.file_write).toBe(true);
});

test('Always allow calls sendPermissionResponse with always_allow + perms', async () => {
  const { el } = setup();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /always allow/i })); });
  expect(el.sendPermissionResponse).toHaveBeenCalledWith('req-123', 'always_allow', PERMS);
});

test('Always allow calls onClose', async () => {
  const { onClose } = setup();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /always allow/i })); });
  expect(onClose).toHaveBeenCalled();
});

test('Always allow still sends response even if getSettings throws', async () => {
  const { el, onClose } = setup();
  el.getSettings.mockRejectedValue(new Error('settings unavailable'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /always allow/i })); });
  expect(el.sendPermissionResponse).toHaveBeenCalledWith('req-123', 'always_allow', PERMS);
  expect(onClose).toHaveBeenCalled();
});

// ─── accessibility (issue #6) ─────────────────────────────────────────────────

test('exposes a labelled, described modal dialog', () => {
  setup();
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  // accessible name comes from the heading
  expect(dialog).toHaveAccessibleName('Permission Required');
  // described by the intro + reason text
  const describedby = dialog.getAttribute('aria-describedby') || '';
  expect(describedby.split(' ').length).toBe(2);
});

test('permissions are exposed as a semantic list', () => {
  setup();
  expect(screen.getByRole('list', { name: /requested permissions/i })).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(PERMS.length);
});

test('focus moves to the Cancel button when opened', () => {
  setup();
  expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus();
});

test('Escape key declines the request (cancel) and closes', () => {
  const { el, onClose } = setup();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(el.sendPermissionResponse).toHaveBeenCalledWith('req-123', 'cancel');
  expect(onClose).toHaveBeenCalled();
});

test('does not handle Escape when closed', () => {
  const { el } = setup({ open: false });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(el.sendPermissionResponse).not.toHaveBeenCalled();
});

test('clarifies the difference between Allow once and Always allow', () => {
  setup();
  expect(screen.getByText(/saves these permissions for future actions/i)).toBeInTheDocument();
});

test('action buttons are type="button" (no accidental form submit)', () => {
  setup();
  for (const name of [/cancel/i, /allow once/i, /always allow/i]) {
    expect(screen.getByRole('button', { name })).toHaveAttribute('type', 'button');
  }
});

// ─── Selective always allow (checkbox per permission) ─────────────────────────

test('permission checkboxes render checked by default', () => {
  setup();
  expect(screen.getByLabelText(/remember file read/i)).toBeChecked();
  expect(screen.getByLabelText(/remember file write/i)).toBeChecked();
});

test('unticking a permission persists it as not-remembered but still grants all for this action', async () => {
  const { el } = setup();
  fireEvent.click(screen.getByLabelText(/remember file write/i)); // uncheck file_write
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /always allow/i })); });
  const saved = el.saveSettings.mock.calls[0][0];
  expect(saved.permissions.file_read).toBe(true);
  expect(saved.permissions.file_write).toBe(false);
  // The grant for THIS action still includes every requested permission.
  expect(el.sendPermissionResponse).toHaveBeenCalledWith('req-123', 'always_allow', PERMS);
});
