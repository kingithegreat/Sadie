/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
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
