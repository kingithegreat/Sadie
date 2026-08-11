/**
 * @jest-environment jsdom
 */
/**
 * The update path was fully unreachable: main checked, downloaded and
 * installed updates, and no renderer code listened — so a released user was
 * never told and could never upgrade. These tests hold the surface to the
 * behaviour that makes it trustworthy rather than annoying.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import UpdateBanner from '../components/UpdateBanner';

type Cb = (...args: any[]) => void;

let available: Cb | null;
let progress: Cb | null;
let downloaded: Cb | null;
let downloadUpdate: jest.Mock;
let installUpdate: jest.Mock;

beforeEach(() => {
  available = progress = downloaded = null;
  downloadUpdate = jest.fn().mockResolvedValue({ success: true });
  installUpdate = jest.fn().mockResolvedValue({ success: true });

  (window as any).electron = {
    onUpdateAvailable: (cb: Cb) => { available = cb; return () => { available = null; }; },
    onUpdateProgress: (cb: Cb) => { progress = cb; return () => { progress = null; }; },
    onUpdateDownloaded: (cb: Cb) => { downloaded = cb; return () => { downloaded = null; }; },
    downloadUpdate,
    installUpdate,
  };
});

describe('UpdateBanner', () => {
  it('shows nothing until an update actually exists', () => {
    const { container } = render(<UpdateBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces the version when one becomes available', () => {
    render(<UpdateBanner />);
    act(() => available!({ version: '1.4.0' }));
    expect(screen.getByText(/1\.4\.0 is available/i)).toBeInTheDocument();
  });

  it('Download calls through to main', async () => {
    render(<UpdateBanner />);
    act(() => available!({ version: '1.4.0' }));
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    await waitFor(() => expect(downloadUpdate).toHaveBeenCalledTimes(1));
  });

  it('shows progress while downloading', () => {
    render(<UpdateBanner />);
    act(() => available!({ version: '1.4.0' }));
    act(() => progress!({ percent: 42.6 }));
    expect(screen.getByText(/43%/)).toBeInTheDocument();
  });

  it('clamps a nonsense percent instead of rendering a broken bar', () => {
    render(<UpdateBanner />);
    act(() => progress!({ percent: 250 }));
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it('offers a restart once the download finishes', () => {
    render(<UpdateBanner />);
    act(() => available!({ version: '1.4.0' }));
    act(() => downloaded!());
    expect(screen.getByRole('button', { name: /restart now/i })).toBeInTheDocument();
  });

  it('Restart now calls install', async () => {
    render(<UpdateBanner />);
    act(() => downloaded!());
    fireEvent.click(screen.getByRole('button', { name: /restart now/i }));
    await waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(1));
  });

  it('"Later" dismisses it — an update must never trap the user', () => {
    const { container } = render(<UpdateBanner />);
    act(() => available!({ version: '1.4.0' }));
    fireEvent.click(screen.getByRole('button', { name: /later/i }));
    expect(container).toBeEmptyDOMElement();
  });

  it('a NEW version undoes an earlier dismissal', () => {
    render(<UpdateBanner />);
    act(() => available!({ version: '1.4.0' }));
    fireEvent.click(screen.getByRole('button', { name: /later/i }));
    act(() => available!({ version: '1.5.0' }));
    expect(screen.getByText(/1\.5\.0 is available/i)).toBeInTheDocument();
  });

  it('a failed download surfaces the reason and offers a retry', async () => {
    downloadUpdate.mockResolvedValue({ success: false, error: 'Network unreachable' });
    render(<UpdateBanner />);
    act(() => available!({ version: '1.4.0' }));
    fireEvent.click(screen.getByRole('button', { name: /download/i }));

    // Must not leave a progress bar stuck at 0% with no explanation.
    await waitFor(() => expect(screen.getByText(/network unreachable/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('a thrown error is handled the same way as a reported failure', async () => {
    downloadUpdate.mockRejectedValue(new Error('boom'));
    render(<UpdateBanner />);
    act(() => available!({ version: '1.4.0' }));
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
  });

  it('unsubscribes on unmount so listeners do not leak', () => {
    const { unmount } = render(<UpdateBanner />);
    expect(available).not.toBeNull();
    unmount();
    expect(available).toBeNull();
  });
});
