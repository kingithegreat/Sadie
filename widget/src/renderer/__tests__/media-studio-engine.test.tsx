/** @jest-environment jsdom */
/**
 * The video engine offer.
 *
 * Rendering is the one stage with a dependency the app does not ship, and the
 * old answer to a missing one was an error telling the user to run
 * `winget install Gyan.FFmpeg`. The panel now offers to do it, and — more
 * importantly — offers it BEFORE the user spends a minute on a script and
 * narration that dead-ends.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

afterEach(() => { delete (window as any).electron; });

const mount = async (api: Record<string, any>) => {
  (window as any).electron = { mediaList: jest.fn().mockResolvedValue([]), ...api };
  await act(async () => { render(<MediaStudioPanel />); });
};

test('when the engine is missing, the panel offers to install it', async () => {
  await mount({
    mediaFfmpegStatus: jest.fn().mockResolvedValue({ ready: false, supported: true }),
  });

  expect(await screen.findByText('Set it up for me')).toBeTruthy();
  // It must not read as a failure — nothing has gone wrong yet.
  expect(screen.queryByRole('alert')).toBeNull();
});

test('when the engine is already there, nothing is offered', async () => {
  await mount({
    mediaFfmpegStatus: jest.fn().mockResolvedValue({ ready: true, supported: true }),
  });

  await waitFor(() => expect(screen.queryByText('Set it up for me')).toBeNull());
});

test('the button runs the setup and reports the result', async () => {
  const mediaFfmpegSetup = jest.fn().mockResolvedValue({ ok: true, message: 'Ready — videos can now be made on this PC.' });
  const mediaFfmpegStatus = jest.fn()
    .mockResolvedValueOnce({ ready: false, supported: true })
    .mockResolvedValue({ ready: true, supported: true });

  await mount({ mediaFfmpegStatus, mediaFfmpegSetup });

  await act(async () => { fireEvent.click(await screen.findByText('Set it up for me')); });

  expect(mediaFfmpegSetup).toHaveBeenCalled();
  expect(await screen.findByText(/Ready — videos can now be made/)).toBeTruthy();
  // Re-checked afterwards, so the offer disappears without a reload.
  await waitFor(() => expect(screen.queryByText('Set it up for me')).toBeNull());
});

test('a failed setup shows the reason instead of disappearing', async () => {
  await mount({
    mediaFfmpegStatus: jest.fn().mockResolvedValue({ ready: false, supported: true }),
    mediaFfmpegSetup: jest.fn().mockResolvedValue({ ok: false, error: 'The download stopped early — check the internet connection and try again.' }),
  });

  await act(async () => { fireEvent.click(await screen.findByText('Set it up for me')); });

  expect(await screen.findByText(/download stopped early/)).toBeTruthy();
});

test('progress is shown in megabytes, not as a bare spinner', async () => {
  let push: ((p: any) => void) | null = null;
  await mount({
    mediaFfmpegStatus: jest.fn().mockResolvedValue({ ready: false, supported: true }),
    onMediaFfmpegProgress: (cb: any) => { push = cb; return () => {}; },
    mediaFfmpegSetup: jest.fn(() => new Promise(() => {})), // never settles
  });

  await act(async () => { fireEvent.click(await screen.findByText('Set it up for me')); });
  await act(async () => { push!({ phase: 'downloading', note: 'Downloading the video engine…', receivedMB: 50, totalMB: 169 }); });

  expect(await screen.findByText(/Downloading the video engine…\s*50 of 169 MB/)).toBeTruthy();
});

test('off Windows it points at the manual instructions rather than a dead button', async () => {
  await mount({
    mediaFfmpegStatus: jest.fn().mockResolvedValue({ ready: false, supported: false }),
  });

  const link = await screen.findByText('Show me how');
  expect(link.getAttribute('href')).toBe('https://ffmpeg.org/download.html');
  expect(screen.queryByText('Set it up for me')).toBeNull();
});
