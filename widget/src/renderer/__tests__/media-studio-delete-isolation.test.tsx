/** @jest-environment jsdom */
/**
 * G-3 regression: the delete path used to defer its IPC call across a
 * macrotask (releaseMediaThen awaits setTimeout(0) so a <video> handle is
 * released before main removes the folder) while resolving the electron
 * bridge LAZILY at call time. When the macrotask landed after the panel that
 * started it had unmounted and a different `window.electron` was mounted, the
 * call went to the wrong mock — "expected 0 calls, called once with 'j1'",
 * issue #229's rotating victim.
 *
 * Fake timers make the macrotask deterministic; the assertion is that the
 * deferred call binds to the bridge that was live when the user confirmed.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

jest.useFakeTimers();

const base = {
  id: 'j1',
  title: 'Recap: Why Attention Matters',
  format: 'short' as const,
  createdAt: '2026-08-18T00:00:00Z',
  updatedAt: '2026-08-18T00:00:00Z',
  history: [],
};

afterEach(() => { delete (window as any).electron; });

const mount = async (job: any, api: Record<string, any> = {}) => {
  const mediaList = jest.fn().mockResolvedValue([job]);
  (window as any).electron = { mediaList, ...api };
  await act(async () => { render(<MediaStudioPanel />); });
};

test('a deferred delete binds to the api live when confirmed, not a later one', async () => {
  const first = jest.fn().mockResolvedValue({ ok: true, message: 'Deleted.' });
  await mount({ ...base, state: 'media_production' }, { mediaDelete: first });

  await act(async () => { fireEvent.click(screen.getByLabelText(`Delete ${base.title}`)); });
  await act(async () => { fireEvent.click(screen.getByText('Delete it')); });

  // The IPC call is deferred by the media-handle release, so it has not fired yet.
  expect(first).not.toHaveBeenCalled();

  // Now the macrotask lands AFTER this panel is gone and a different bridge is
  // mounted — the exact cross-test ordering that produced the rotating failure.
  const second = jest.fn().mockResolvedValue({ ok: true });
  await act(async () => {
    (window as any).electron = { mediaList: jest.fn().mockResolvedValue([]), mediaDelete: second };
  });
  await act(async () => { jest.advanceTimersByTime(0); });

  // The call must land on the bridge that was live at confirm time...
  expect(first).toHaveBeenCalledWith('j1');
  // ...and must NOT leak onto the later one.
  expect(second).not.toHaveBeenCalled();
});
