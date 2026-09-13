/** @jest-environment jsdom */
/**
 * You should be able to read the script and see the slides before approving.
 *
 * Both were already produced and neither was ever shown — the same shape as the
 * `renderPath` dead end this panel already has a test for:
 *
 *   - `script` has been a field on MediaJob since the pipeline existed, and the
 *     panel never rendered it.
 *   - the scene image paths were generated, written into the ffmpeg concat file
 *     and then discarded, so nothing downstream could ever display them. They
 *     are now kept on the job as `scenePaths`.
 *
 * Approving a video you can only judge by playing it end to end is slower than
 * reading it, and the approval gate is where judging happens.
 */

import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { createStudioOutputSpec, type StudioExportState } from '../../shared/media-output';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

const base = {
  id: 'j1',
  title: 'Recap: Why Attention Matters',
  format: 'short' as const,
  createdAt: '2026-08-18T00:00:00Z',
  updatedAt: '2026-08-18T00:00:00Z',
  history: [],
  state: 'awaiting_approval' as const,
};

afterEach(() => { delete (window as any).electron; });

const mount = async (job: any) => {
  (window as any).electron = { mediaList: jest.fn().mockResolvedValue([job]) };
  await act(async () => { render(<MediaStudioPanel />); });
};

const SCRIPT = 'Attention lets a model weigh every word against every other word.';

test('the script is on screen at the gate that approves it', async () => {
  await mount({ ...base, script: SCRIPT });
  expect(screen.getByText(SCRIPT)).toBeInTheDocument();
});

test('no script section when there is no script', async () => {
  await mount({ ...base });
  expect(screen.queryByText('Script')).toBeNull();
});

test('every slide is shown, in order, with a usable src', async () => {
  await mount({
    ...base,
    scenePaths: ['C:\\media\\j1\\scenes\\scene-00.png', 'C:\\media\\j1\\scenes\\scene-01.png'],
  });

  const strip = screen.getByTestId('ms-slides-j1');
  const imgs = Array.from(strip.querySelectorAll('img'));
  expect(imgs).toHaveLength(2);
  // Backslashes have to become forward slashes or file:// will not load them.
  expect(imgs[0].getAttribute('src')).toBe('file:///C:/media/j1/scenes/scene-00.png');
  expect(imgs[1].getAttribute('src')).toBe('file:///C:/media/j1/scenes/scene-01.png');
});

test('a failed slide is named rather than silently missing', async () => {
  await mount({
    ...base,
    scenePaths: ['C:\\media\\j1\\scenes\\scene-00.png', null, 'C:\\media\\j1\\scenes\\scene-02.png'],
  });

  const strip = screen.getByTestId('ms-slides-j1');
  // Three slides in the video, so three in the preview — the gap is labelled,
  // not dropped. A gap the user cannot explain reads as a bug.
  expect(strip.children).toHaveLength(3);
  expect(strip.querySelectorAll('img')).toHaveLength(2);
  expect(strip.querySelector('.ms-slide-missing')).toBeTruthy();
});

test('the count, and how many reused a neighbour, are stated', async () => {
  await mount({ ...base, scenePaths: ['a.png', null, 'c.png'] });
  expect(screen.getByText(/Slides \(3\)/)).toBeInTheDocument();
  expect(screen.getByText(/1 reused a neighbour/)).toBeInTheDocument();
});

test('no slides section before the render stage has made any', async () => {
  await mount({ ...base, script: SCRIPT });
  expect(screen.queryByTestId('ms-slides-j1')).toBeNull();
});

test('a failed replacement is not announced as a ready episode', async () => {
  await mount({ ...base, state: 'needs_revision', renderPath: 'C:\\media\\j1\\good.mp4',
    rejectedRenderPath: 'C:\\media\\j1\\rejected.mp4',
    latestExportAttempt: { id: 'failed-replacement', status: 'failed', sourceRevision: null,
      startedAt: '2026-09-13T00:00:00Z', finishedAt: '2026-09-13T00:00:05Z', error: 'Replacement has no audio stream.' } });
  expect(screen.getByTestId('ms-video-j1')).toHaveAttribute('src', 'file:///C:/media/j1/good.mp4');
  expect(screen.queryByText(/Your episode is ready to watch!/)).not.toBeInTheDocument();
  expect(screen.getByText(/latest attempt failed/i)).toBeInTheDocument();
});

const exportState = (id: string): StudioExportState => ({ sourceRevision: 'a'.repeat(64), sourceSavedAt: base.updatedAt,
  outputs: ['new', 'old'].map((version, index) => ({ exportId: `${id}-${version}`, filename: `${version}.mp4`,
    moviePath: `C:\\media\\${id}\\${version}.mp4`, createdAt: `2026-09-1${3 - index}T00:00:00Z`,
    sourceSavedAt: base.updatedAt, durationSeconds: 3, burnSubtitles: false, outputSpec: createStudioOutputSpec(),
    scenePaths: [`C:\\media\\${id}\\${version}.png`],
    sourceRevision: 'a'.repeat(64) })) });

test('history selects the exact player and reveal path and cannot approve the current movie while watching an older one', async () => {
  const job = { ...base, renderPath: 'C:\\media\\j1\\new.mp4' };
  const mediaApprove = jest.fn().mockResolvedValue({ ok: true });
  const showInFolder = jest.fn().mockResolvedValue({ success: true });
  (window as any).electron = { mediaList: jest.fn().mockResolvedValue([job]),
    mediaGetExportState: jest.fn().mockResolvedValue(exportState('j1')), mediaApprove, showInFolder };
  await act(async () => { render(<MediaStudioPanel />); });
  await act(async () => { fireEvent.change(screen.getByLabelText('Export history'), { target: { value: 'C:\\media\\j1\\old.mp4' } }); });
  expect(screen.getByTestId('ms-video-j1')).toHaveAttribute('src', 'file:///C:/media/j1/old.mp4');
  expect(within(screen.getByTestId('ms-slides-j1')).getByRole('img')).toHaveAttribute('src', 'file:///C:/media/j1/old.png');
  expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Open file location/ })); });
  expect(showInFolder).toHaveBeenCalledWith('C:\\media\\j1\\old.mp4');
  expect(mediaApprove).not.toHaveBeenCalled();
  showInFolder.mockResolvedValueOnce({ success: false, error: 'The selected file is missing.' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Open file location/ })); });
  expect(screen.getByText('The selected file is missing.')).toBeVisible();
  await act(async () => { fireEvent.change(screen.getByLabelText('Export history'), { target: { value: job.renderPath } }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })); });
  expect(mediaApprove).toHaveBeenCalledWith('j1', undefined, job.renderPath);
});

test('a late history result from A cannot replace selected B', async () => {
  const jobs = [{ ...base, renderPath: 'C:\\media\\j1\\new.mp4' },
    { ...base, id: 'j2', title: 'Second project', renderPath: 'C:\\media\\j2\\new.mp4' }];
  let resolveA!: (state: StudioExportState) => void;
  const pendingA = new Promise<StudioExportState>(resolve => { resolveA = resolve; });
  (window as any).electron = { mediaList: jest.fn().mockResolvedValue(jobs),
    mediaGetExportState: jest.fn((id: string) => id === 'j1' ? pendingA : Promise.resolve(exportState('j2'))) };
  await act(async () => { render(<MediaStudioPanel />); });
  const second = screen.getByText('Second project').closest('li')!;
  await act(async () => { fireEvent.click(within(second).getByRole('button', { name: 'Movie details and history' })); });
  expect(screen.getByLabelText('Export history')).toHaveValue(jobs[1].renderPath);
  await act(async () => { resolveA(exportState('j1')); });
  expect(screen.getByLabelText('Export history')).toHaveValue(jobs[1].renderPath);
  expect(within(screen.getByLabelText('Export history')).queryByRole('option', { name: /j1-old/ })).not.toBeInTheDocument();
});
