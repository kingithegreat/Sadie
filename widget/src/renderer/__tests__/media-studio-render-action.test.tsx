/** @jest-environment jsdom */
/**
 * The panel can finish the job.
 *
 * Script and narration always had buttons; rendering — the step that actually
 * produces the video — was reachable only by asking in chat. The panel walked
 * a video to media_production and then went quiet, which for a panel-first
 * user was a dead end at the last step.
 */

import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';
import { SCENE_PICTURE_FAILURE } from '../../shared/scene-picture-qa';

const JOB = {
  id: 'j1',
  title: 'Recap: Why Attention Matters',
  format: 'short',
  state: 'media_production',
  // media_narrate writes narrationPath and THEN transitions to
  // media_production, so a real job in this state always has one. The fixture
  // omitted it, which stopped mattering once the panel began offering the
  // action for what a job is MISSING rather than for its state alone: without
  // narration it now offers "Record narration", because "Make the video" would
  // be refused by the render tool for exactly that reason.
  narrationPath: 'C:\\media\\j1\\narration.mp3',
  createdAt: '2026-08-15T00:00:00Z',
  updatedAt: '2026-08-15T00:00:00Z',
  history: [],
};

afterEach(() => { delete (window as any).electron; });

test('rejected scene art offers reachable regeneration with no inferred payment consent', async () => {
  const mediaRun = jest.fn().mockResolvedValue({ ok: false, error: 'Online generation is off.' });
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([{ ...JOB,
      latestExportAttempt: { id: 'failed', status: 'failed', errorCode: SCENE_PICTURE_FAILURE },
      renderInputs: { imagePath: null, visuals: 'scenes' } }]), mediaRun,
  };
  await act(async () => { render(<MediaStudioPanel />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Regenerate scene pictures' })); });
  expect(mediaRun).toHaveBeenCalledWith('j1', 'render', { regenerateScenes: true });
  expect(screen.getByText('Online generation is off.')).toBeTruthy();
});

test('unrelated provider errors cannot offer scene-art regeneration by matching their text', async () => {
  (window as any).electron = { mediaList: jest.fn().mockResolvedValue([{ ...JOB,
    latestExportAttempt: { id: 'failed', status: 'failed', error: 'Check the picture for scene 1: provider text.' } }]) };
  await act(async () => { render(<MediaStudioPanel />); });
  expect(screen.queryByRole('button', { name: 'Regenerate scene pictures' })).toBeNull();
});

test('a video in media_production offers "Make the video", wired to the render action', async () => {
  const mediaRun = jest.fn().mockResolvedValue({ ok: true, message: 'Rendered.' });
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([JOB]),
    mediaRun,
  };
  await act(async () => { render(<MediaStudioPanel />); });

  const btn = screen.getByText('Make the video');
  await act(async () => { fireEvent.click(btn); });

  expect(mediaRun).toHaveBeenCalledWith('j1', 'render', undefined);
});

test.each([
  { imagePath: 'C:\\media\\j1\\saved.png', visuals: 'scenes' },
  { imagePath: null, visuals: 'plain' },
])('saved inputs %j do not require an image generator', async renderInputs => {
  const mediaRun = jest.fn().mockResolvedValue({ ok: true, message: 'Rendered.' });
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([{ ...JOB, renderInputs }]),
    sdCppStatus: jest.fn().mockResolvedValue({ ready: false }),
    mediaRun,
  };
  await act(async () => { render(<MediaStudioPanel />); });
  await act(async () => { fireEvent.click(screen.getByText('Make the video')); });
  expect(mediaRun).toHaveBeenCalledWith('j1', 'render', undefined);
  expect(screen.queryByRole('dialog', { name: 'Choose where images are made' })).toBeNull();
});

test('a job that needs new scene images still asks about generator setup', async () => {
  const mediaRun = jest.fn();
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([JOB]),
    sdCppStatus: jest.fn().mockResolvedValue({ ready: false }),
    mediaRun,
  };
  await act(async () => { render(<MediaStudioPanel />); });
  await act(async () => { fireEvent.click(screen.getByText('Make the video')); });
  expect(screen.getByRole('dialog', { name: 'Choose where images are made' })).toBeTruthy();
  expect(mediaRun).not.toHaveBeenCalled();
});

test('requested changes on a saved movie lead to its source, never a new script on the review', async () => {
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([{ ...JOB, state: 'needs_revision', reviewSource: { type: 'job', id: 'source' } }]),
  };
  await act(async () => { render(<MediaStudioPanel />); });
  expect(screen.getByRole('button', { name: 'Open source project' })).toBeTruthy();
  expect(screen.queryByText('Write script')).toBeNull();
  expect(screen.getByText(/Changes requested.*source project/)).toBeTruthy();
});

const EXPORT_PROGRESS = 'Export in progress — previous movies are kept';

function deferredJobOperation() {
  let resolve!: (result: { ok: boolean; error?: string }) => void;
  const promise = new Promise<{ ok: boolean; error?: string }>(done => { resolve = done; });
  return { promise, resolve };
}

test.each([
  { stage: 'script', state: 'idea', button: 'Write script', script: undefined },
  { stage: 'narrate', state: 'script_draft', button: 'Record narration', script: 'A saved script.' },
])('job export progress: pending $stage is not an export', async ({ stage, state, button, script }) => {
  const operation = deferredJobOperation();
  const mediaRun = jest.fn().mockReturnValue(operation.promise);
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([{ ...JOB, state, script, narrationPath: undefined }]),
    mediaRun,
  };
  await act(async () => { render(<MediaStudioPanel />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: button })); });

  try {
    expect(mediaRun).toHaveBeenCalledTimes(1);
    expect(mediaRun).toHaveBeenCalledWith('j1', stage, stage === 'narrate'
      ? { voice: undefined, engine: undefined } : undefined);
    expect(document.querySelector('.ms-job .ms-working')).toHaveTextContent(button);
    const status = screen.getByRole('region', { name: 'Export freshness' });
    expect(within(status).queryByText(EXPORT_PROGRESS)).toBeNull();
    expect(within(status).getByText('No movie selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: `Burn captions into ${JOB.title}` })).toBeDisabled();
  } finally {
    await act(async () => { operation.resolve({ ok: false, error: 'Controlled stage failure.' }); });
  }
  expect(screen.getByText('Controlled stage failure.')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: `Burn captions into ${JOB.title}` })).not.toBeDisabled();
});

test('job export progress: pending output settings save is not an export', async () => {
  const operation = deferredJobOperation();
  const mediaRun = jest.fn().mockReturnValue(operation.promise);
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([{ ...JOB, burnSubtitles: false }]), mediaRun,
  };
  await act(async () => { render(<MediaStudioPanel />); });
  const captions = screen.getByRole('checkbox', { name: `Burn captions into ${JOB.title}` });
  await act(async () => { fireEvent.click(captions); });

  try {
    expect(mediaRun).toHaveBeenCalledTimes(1);
    expect(mediaRun).toHaveBeenCalledWith('j1', 'output', { burnSubtitles: true });
    expect(document.querySelector('.ms-job .ms-working')).toHaveTextContent('Saving output');
    const status = screen.getByRole('region', { name: 'Export freshness' });
    expect(within(status).queryByText(EXPORT_PROGRESS)).toBeNull();
    expect(within(status).getByText('No movie selected')).toBeInTheDocument();
    expect(captions).toBeDisabled();
  } finally {
    await act(async () => { operation.resolve({ ok: false, error: 'Controlled settings failure.' }); });
  }
  expect(screen.getByText('Controlled settings failure.')).toBeInTheDocument();
  expect(captions).not.toBeDisabled();
});

test('job export progress: pending render is an export and keeps the previous movie', async () => {
  const operation = deferredJobOperation();
  const mediaRun = jest.fn().mockReturnValue(operation.promise);
  const moviePath = 'C:\\media\\j1\\previous.mp4';
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([{ ...JOB, renderPath: moviePath,
      renderInputs: { imagePath: null, visuals: 'plain' } }]), mediaRun,
  };
  await act(async () => { render(<MediaStudioPanel />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make the video' })); });

  try {
    expect(mediaRun).toHaveBeenCalledTimes(1);
    expect(mediaRun).toHaveBeenCalledWith('j1', 'render', undefined);
    const status = screen.getByRole('region', { name: 'Export freshness' });
    expect(within(status).getByText(EXPORT_PROGRESS)).toBeInTheDocument();
    expect(screen.getByTestId('ms-video-j1')).toHaveAttribute('src', 'file:///C:/media/j1/previous.mp4');
    expect(screen.getByRole('checkbox', { name: `Burn captions into ${JOB.title}` })).toBeDisabled();
  } finally {
    await act(async () => { operation.resolve({ ok: false, error: 'Controlled render failure.' }); });
  }
  expect(screen.getByText('Controlled render failure.')).toBeInTheDocument();
  expect(screen.getByTestId('ms-video-j1')).toHaveAttribute('src', 'file:///C:/media/j1/previous.mp4');
  expect(screen.getByRole('region', { name: 'Export freshness' })).not.toHaveTextContent(EXPORT_PROGRESS);
});

test.each(['preparing', 'rendering', 'validating'])(
  'job export progress: persisted %s attempt remains an export', async status => {
    const mediaRun = jest.fn();
    (window as any).electron = {
      mediaList: jest.fn().mockResolvedValue([{ ...JOB,
        latestExportAttempt: { id: 'existing-attempt', status, sourceRevision: null,
          startedAt: '2026-10-05T00:00:00Z' } }]), mediaRun,
    };
    await act(async () => { render(<MediaStudioPanel />); });
    const exportStatus = screen.getByRole('region', { name: 'Export freshness' });
    expect(within(exportStatus).getByText(EXPORT_PROGRESS)).toBeInTheDocument();
    expect(mediaRun).not.toHaveBeenCalled();
  },
);

function jobRow(id: string) {
  const row = document.querySelector(`[data-job-id="${id}"]`);
  if (!row) throw new Error(`Missing rendered job ${id}`);
  return within(row as HTMLElement);
}

async function selectJobExport(id: string) {
  const row = jobRow(id);
  const details = row.queryByRole('button', { name: 'Movie details and history' });
  if (details) await act(async () => { fireEvent.click(details); });
  return row.getByRole('region', { name: 'Export freshness' });
}

test.each([
  { stage: 'output', settled: false },
  { stage: 'output', settled: true },
  { stage: 'render', settled: false },
  { stage: 'render', settled: true },
])('job export overlap: A stays rendering during B $stage, B settled=$settled', async ({ stage, settled }) => {
  const renderA = deferredJobOperation();
  const operationB = deferredJobOperation();
  const jobB = { ...JOB, id: 'j2', title: 'Another real job', burnSubtitles: false,
    renderInputs: { imagePath: null, visuals: 'plain' } };
  const mediaRun = jest.fn((id: string) => id === 'j1' ? renderA.promise : operationB.promise);
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([{ ...JOB,
      renderInputs: { imagePath: null, visuals: 'plain' } }, jobB]), mediaRun,
  };
  try {
    await act(async () => { render(<MediaStudioPanel />); });
    await act(async () => { fireEvent.click(jobRow('j1').getByRole('button', { name: 'Make the video' })); });
    expect(jobRow('j1').getByRole('region', { name: 'Export freshness' })).toHaveTextContent(EXPORT_PROGRESS);
    await act(async () => { fireEvent.click(stage === 'render'
      ? jobRow('j2').getByRole('button', { name: 'Make the video' })
      : jobRow('j2').getByRole('checkbox', { name: `Burn captions into ${jobB.title}` })); });
    expect(mediaRun.mock.calls).toEqual([
      ['j1', 'render', undefined],
      ['j2', stage, stage === 'render' ? undefined : { burnSubtitles: true }],
    ]);
    if (settled) await act(async () => { operationB.resolve({ ok: false, error: 'B finished.' }); });
    const statusA = await selectJobExport('j1');
    expect(statusA).toHaveTextContent(EXPORT_PROGRESS);
    const statusB = await selectJobExport('j2');
    if (stage === 'render' && !settled) expect(statusB).toHaveTextContent(EXPORT_PROGRESS);
    else expect(statusB).not.toHaveTextContent(EXPORT_PROGRESS);
  } finally {
    await act(async () => {
      renderA.resolve({ ok: false, error: 'A finished.' });
      operationB.resolve({ ok: false, error: 'B finished.' });
    });
  }
  expect(await selectJobExport('j1')).not.toHaveTextContent(EXPORT_PROGRESS);
  expect(await selectJobExport('j2')).not.toHaveTextContent(EXPORT_PROGRESS);
});

test('job export overlap: A finishes first without clearing pending B render', async () => {
  const renderA = deferredJobOperation();
  const renderB = deferredJobOperation();
  const mediaRun = jest.fn((id: string) => id === 'j1' ? renderA.promise : renderB.promise);
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue(['j1', 'j2'].map(id => ({ ...JOB, id, title: `Job ${id}`,
      renderInputs: { imagePath: null, visuals: 'plain' } }))), mediaRun,
  };
  try {
    await act(async () => { render(<MediaStudioPanel />); });
    for (const id of ['j1', 'j2']) {
      await act(async () => { fireEvent.click(jobRow(id).getByRole('button', { name: 'Make the video' })); });
    }
    expect(mediaRun.mock.calls).toEqual([['j1', 'render', undefined], ['j2', 'render', undefined]]);
    expect(await selectJobExport('j2')).toHaveTextContent(EXPORT_PROGRESS);
    await act(async () => { renderA.resolve({ ok: false, error: 'A finished first.' }); });
    expect(await selectJobExport('j2')).toHaveTextContent(EXPORT_PROGRESS);
    expect(await selectJobExport('j1')).not.toHaveTextContent(EXPORT_PROGRESS);
  } finally {
    await act(async () => {
      renderA.resolve({ ok: false, error: 'A finished first.' });
      renderB.resolve({ ok: false, error: 'B finished.' });
    });
  }
  expect(await selectJobExport('j2')).not.toHaveTextContent(EXPORT_PROGRESS);
});

test.each([0, 1])('job export overlap: repeated A regeneration stays announced when invocation %i finishes', async first => {
  const renders = [deferredJobOperation(), deferredJobOperation()];
  const settingsB = deferredJobOperation();
  let renderIndex = 0;
  const mediaRun = jest.fn((id: string) => id === 'j1' ? renders[renderIndex++].promise : settingsB.promise);
  const jobB = { ...JOB, id: 'j2', title: 'Settings job', burnSubtitles: false };
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([{ ...JOB,
      latestExportAttempt: { id: 'failed', status: 'failed', errorCode: SCENE_PICTURE_FAILURE },
      renderInputs: { imagePath: null, visuals: 'scenes' } }, jobB]), mediaRun,
  };
  try {
    await act(async () => { render(<MediaStudioPanel />); });
    await act(async () => { fireEvent.click(jobRow('j1').getByRole('button', { name: 'Regenerate scene pictures' })); });
    await act(async () => { fireEvent.click(jobRow('j2').getByRole('checkbox', { name: `Burn captions into ${jobB.title}` })); });
    // B's independent action leaves A's regeneration control reachable while A's first call is pending.
    await act(async () => { fireEvent.click(jobRow('j1').getByRole('button', { name: 'Regenerate scene pictures' })); });
    expect(mediaRun.mock.calls).toEqual([
      ['j1', 'render', { regenerateScenes: true }],
      ['j2', 'output', { burnSubtitles: true }],
      ['j1', 'render', { regenerateScenes: true }],
    ]);
    await act(async () => { settingsB.resolve({ ok: false, error: 'B settings finished.' }); });
    await act(async () => { renders[first].resolve({ ok: false, error: 'One regeneration finished.' }); });
    expect(await selectJobExport('j1')).toHaveTextContent(EXPORT_PROGRESS);
    await act(async () => { renders[1 - first].resolve({ ok: false, error: 'Both regenerations finished.' }); });
    expect(await selectJobExport('j1')).not.toHaveTextContent(EXPORT_PROGRESS);
  } finally {
    await act(async () => {
      renders.forEach(operation => operation.resolve({ ok: false, error: 'Regeneration finished.' }));
      settingsB.resolve({ ok: false, error: 'B settings finished.' });
    });
  }
});
