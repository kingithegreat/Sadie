/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import YouTubeConnectionCard from '../components/YouTubeConnectionCard';

test('an unreadable saved grant can be removed from the visible recovery screen', async () => {
  const clean = { ok: true, status: { configured: false, signedIn: false, busy: false, channels: [] } };
  const status = jest.fn().mockResolvedValue({ ok: false, error: 'HomeBot cannot read this saved Google connection.' });
  const remove = jest.fn(async () => { status.mockResolvedValue(clean); return clean; });
  (window as any).electron = { youtubeConnectionStatus: status, youtubeRemove: remove };
  render(<YouTubeConnectionCard />);
  expect(await screen.findByRole('alert')).toHaveTextContent('cannot read');
  expect(screen.getByRole('button', { name: 'Choose Google JSON' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove saved connection' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose Google JSON' })).toBeEnabled());
  expect(screen.queryByRole('alert')).toBeNull();
});

test('an import cancelled by the owner never shows a success notice', async () => {
  const status = { configured: false, signedIn: false, busy: false, channels: [] };
  const picker = jest.fn(async () => ({ ok: true, cancelled: true, status }));
  (window as any).electron = { youtubeConnectionStatus: async () => ({ ok: true, status }), youtubeImportCredentials: picker };
  render(<YouTubeConnectionCard />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose Google JSON' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Choose Google JSON' }));
  await waitFor(() => expect(picker).toHaveBeenCalledWith());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose Google JSON' })).toBeEnabled());
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText('Ready to sign in')).toBeNull();
});
