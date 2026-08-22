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

import { render, screen, act } from '@testing-library/react';
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
