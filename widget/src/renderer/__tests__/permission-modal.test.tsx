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

test('renders unknown permissions with prettified fallback labels', () => {
  setup();
  // file_read / file_write are not registry names — the fallback prettifier
  // still produces a human label, never a raw slug.
  expect(screen.getByText('File read')).toBeInTheDocument();
  expect(screen.getByText('File write')).toBeInTheDocument();
});

test('renders known permissions with plain-English label and detail (copy pass)', () => {
  setup({ missingPermissions: ['write_file', 'email_send'] });
  expect(screen.getByText('Write files')).toBeInTheDocument();
  expect(screen.getByText(/Create a new file or overwrite an existing one/)).toBeInTheDocument();
  expect(screen.getByText('Send email')).toBeInTheDocument();
});

test('shows custom reason when provided', () => {
  setup({ reason: 'Custom leason text' });
  expect(screen.getByText('Custom leason text')).toBeInTheDocument();
});

test('shows an honest neutral line when reason is omitted', () => {
  setup({ reason: undefined });
  expect(screen.getByText(/Nothing has run yet/)).toBeInTheDocument();
});

test('suppresses the machine-generated "Requires permissions:" reason (copy pass)', () => {
  setup({ reason: 'Requires permissions: file_read, file_write' });
  // The permission list already shows this with better copy — the raw
  // enumeration must not be duplicated below it.
  expect(screen.queryByText(/Requires permissions:/)).not.toBeInTheDocument();
  expect(screen.getByText(/Nothing has run yet/)).toBeInTheDocument();
});

test('states the auto-decline timeout, matching the timeoutMs prop', () => {
  setup({ timeoutMs: 60000 } as any);
  expect(screen.getByText(/about a minute declines the request automatically/i)).toBeInTheDocument();
});

test('timeout notice falls back to the 60s default without the prop', () => {
  setup();
  expect(screen.getByText(/declines the request automatically/i)).toBeInTheDocument();
});

test('renders Don\u2019t allow, Allow once, and Always allow buttons', () => {
  setup();
  expect(screen.getByRole('button', { name: /don.t allow/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /allow once/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /always allow/i })).toBeInTheDocument();
});

// ─── Don't allow (decline) ────────────────────────────────────────────────────

test('Don\u2019t allow calls sendPermissionResponse with "cancel"', () => {
  const { el } = setup();
  fireEvent.click(screen.getByRole('button', { name: /don.t allow/i }));
  expect(el.sendPermissionResponse).toHaveBeenCalledWith('req-123', 'cancel');
});

test('Don\u2019t allow calls onClose', () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByRole('button', { name: /don.t allow/i }));
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

test('focus moves to the Don\u2019t allow button when opened (safest default)', () => {
  setup();
  expect(screen.getByRole('button', { name: /don.t allow/i })).toHaveFocus();
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
  for (const name of [/don.t allow/i, /allow once/i, /always allow/i]) {
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
