/** @jest-environment jsdom */
/**
 * media-studio-storyboard.test.tsx — Unit tests for Media Studio Visual Storyboard Deck,
 * shot cards, camera framing pills, AI frame generation, and Chat navContext handoff.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';
import { createStudioOutputSpec } from '../../shared/media-output';

function setup(overrides: Record<string, any> = {}) {
  const mediaList = jest.fn().mockResolvedValue([]);
  const mediaStoryboardList = jest.fn().mockResolvedValue({
    ok: true,
    storyboards: [
      {
        projectId: 'pyramid-builders',
        title: 'Pyramid Builders',
        totalShots: 3,
        renderedFrames: 1,
        totalDurationSec: 14,
        projectDir: 'C:/Users/User/Desktop/homebot-movie-projects/pyramid-builders',
      },
    ],
  });
  const mediaStoryboardGet = jest.fn().mockResolvedValue({
    ok: true,
    result: {
      project: {
        projectId: 'pyramid-builders',
        name: 'Pyramid Builders',
        notes: 'Ancient historical documentary',
      },
      scenes: [
        {
          sceneId: 'scene_01',
          title: 'Construction Sequence',
          shots: [
            {
              shotId: 'shot_001',
              order: 1,
              prompt: 'Establishing wide shot of the limestone ramps at sunrise',
              framing: 'wide',
              lens: '24mm',
              movement: 'slow push in',
              durationSec: 5,
              narration: 'The sun rises over the limestone ramps.',
              status: 'COMPLETED',
              frameImagePath: 'C:/fake/path/shot_001.png',
            },
            {
              shotId: 'shot_002',
              order: 2,
              prompt: 'Medium shot of mason carving hieroglyphic marker',
              framing: 'medium',
              lens: '35mm',
              movement: 'static',
              durationSec: 5,
              narration: 'Precision marks recorded for the pharaoh.',
              status: 'PLANNED',
              frameImagePath: null,
            },
            {
              shotId: 'shot_003',
              order: 3,
              prompt: 'Dramatic close-up of hammer striking bronze chisel',
              framing: 'close',
              lens: '50mm',
              movement: 'tilt up',
              durationSec: 4,
              narration: 'Bronze strikes stone.',
              status: 'PLANNED',
              frameImagePath: null,
            },
          ],
        },
      ],
      projectDir: 'C:/Users/User/Desktop/homebot-movie-projects/pyramid-builders',
    },
  });
  const mediaStoryboardCreate = jest.fn().mockResolvedValue({
    ok: true,
    result: {
      projectId: 'new-board-test',
      title: 'New Board Test',
    },
  });
  const mediaStoryboardSave = jest.fn().mockResolvedValue({
    ok: true,
    message: 'Saved',
  });
  const mediaStoryboardGenerateFrame = jest.fn().mockResolvedValue({
    ok: true,
    result: {
      projectId: 'pyramid-builders',
      shotId: 'shot_002',
      provider: 'pollinations',
      frameImagePath: 'C:/fake/path/shot_002.png',
    },
  });
  const mediaStoryboardRender = jest.fn().mockResolvedValue({
    ok: true,
    moviePath: 'C:/fake/path/pyramid-builders-1080p.mp4',
    durationSec: 14,
    totalShots: 3,
  });
  const mediaStoryboardBreakdown = jest.fn().mockResolvedValue({
    ok: true,
    projectId: 'auto-directed-board',
    title: 'Auto Directed Board',
    genre: 'cyberpunk_scifi',
    shots: [
      { shotId: 'shot_001', framing: 'wide', prompt: 'Wide shot', durationSec: 5 },
      { shotId: 'shot_002', framing: 'medium', prompt: 'Medium shot', durationSec: 5 },
      { shotId: 'shot_003', framing: 'close', prompt: 'Close shot', durationSec: 4 },
      { shotId: 'shot_004', framing: 'wide', prompt: 'Hero wide', durationSec: 6 },
    ],
    totalDurationSec: 20,
  });

  (window as any).electron = {
    mediaList,
    mediaStoryboardList,
    mediaStoryboardGet,
    mediaStoryboardCreate,
    mediaStoryboardSave,
    mediaStoryboardGenerateFrame,
    mediaStoryboardRender,
    mediaStoryboardBreakdown,
    ...overrides,
  };

  return {
    mediaList,
    mediaStoryboardList,
    mediaStoryboardGet,
    mediaStoryboardCreate,
    mediaStoryboardSave,
    mediaStoryboardGenerateFrame,
    mediaStoryboardRender,
    mediaStoryboardBreakdown,
  };
}


afterEach(() => {
  delete (window as any).electron;
});

describe('Media Studio Visual Storyboard Deck', () => {
  test('visible portrait retry renders only portrait and the successful landscape remains selectable for review', async () => {
    const mocks = setup();
    const board: any = (await mocks.mediaStoryboardGet()).result;
    board.project.outputSpec = { ...createStudioOutputSpec(), variants: [createStudioOutputSpec().variants[0], createStudioOutputSpec('9:16').variants[0]] };
    const landscape = { exportId: 'landscape', filename: 'landscape.mp4', moviePath: 'C:/proof/landscape.mp4',
      createdAt: '2026-09-13T00:00:00Z', sourceSavedAt: null, sourceRevision: 'a'.repeat(64), durationSeconds: 14,
      burnSubtitles: true, outputSpec: createStudioOutputSpec() };
    const portrait = { ...landscape, exportId: 'portrait', filename: 'portrait.mp4', moviePath: 'C:/proof/portrait.mp4',
      sourceRevision: 'b'.repeat(64), outputSpec: createStudioOutputSpec('9:16') };
    board.renderedMoviePath = landscape.moviePath;
    board.exportState = { sourceRevision: 'batch', sourceSavedAt: null, outputs: [landscape],
      variantRevisions: { landscape: landscape.sourceRevision, portrait: portrait.sourceRevision },
      variantAttempts: { landscape: { id: 'landscape', variantId: 'landscape', status: 'succeeded', sourceRevision: landscape.sourceRevision, startedAt: landscape.createdAt },
        portrait: { id: 'failed-portrait', variantId: 'portrait', status: 'failed', sourceRevision: portrait.sourceRevision, startedAt: landscape.createdAt, error: 'Portrait stopped' } } };
    mocks.mediaList.mockResolvedValue([{ id: 'sbexport_landscape', title: 'Landscape review', state: 'awaiting_approval', format: 'short',
      renderPath: landscape.moviePath, durationSeconds: 14, createdAt: landscape.createdAt, updatedAt: landscape.createdAt, history: [] }] as never[]);
    mocks.mediaStoryboardRender.mockImplementationOnce(async () => {
      board.exportState.outputs = [portrait, landscape];
      board.exportState.variantAttempts.portrait.status = 'succeeded';
      return { ok: true, moviePath: portrait.moviePath, jobId: 'sbexport_portrait', variants: [{ ...portrait, ok: true, variantId: 'portrait' }] } as any;
    });
    render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />);
    const retry = await screen.findByRole('button', { name: 'Retry portrait' });
    await act(async () => { fireEvent.click(retry); });
    expect(mocks.mediaStoryboardRender).toHaveBeenCalledTimes(1);
    expect(mocks.mediaStoryboardRender).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'pyramid-builders', variantId: 'portrait', outputSpec: board.project.outputSpec }));
    expect(screen.getByLabelText('Exported storyboard video')).toHaveAttribute('src', 'file:///C:/proof/portrait.mp4');
    fireEvent.click(screen.getByRole('button', { name: 'View landscape' }));
    expect(screen.getByLabelText('Exported storyboard video')).toHaveAttribute('src', 'file:///C:/proof/landscape.mp4');
    expect(screen.getByRole('button', { name: /Review & Publish/ })).toBeEnabled();
    expect(mocks.mediaStoryboardGenerateFrame).not.toHaveBeenCalled();
  });

  test('saved and unsaved revisions, history, Open and Reveal all reach the selected file', async () => {
    const mocks = setup();
    const board = (await mocks.mediaStoryboardGet()).result;
    const output = { exportId: 'export-one', filename: 'one.mp4', moviePath: 'C:/proof/one.mp4', createdAt: '2026-09-12T00:00:00Z',
      sourceSavedAt: null, sourceRevision: 'a'.repeat(64), durationSeconds: 14, fileSizeBytes: 2048, burnSubtitles: true, outputSpec: createStudioOutputSpec() };
    const older = { ...output, exportId: 'export-old', filename: 'old.mp4', moviePath: 'C:/proof/old.mp4', sourceRevision: 'b'.repeat(64) };
    Object.assign(board, { renderedMoviePath: output.moviePath, exportState: { sourceRevision: output.sourceRevision, sourceSavedAt: null, outputs: [output, older] } });
    const openFile = jest.fn().mockResolvedValue({ success: true });
    const showInFolder = jest.fn().mockResolvedValue({ success: true });
    Object.assign((window as any).electron, { openFile, showInFolder });
    render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />);
    expect(await screen.findByText('Preview matches the saved revision')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Duration for shot_001'), { target: { value: '6' } });
    expect(screen.getByText('Preview out of date')).toBeVisible();
    expect(screen.getByText(/Unsaved edits/)).toBeVisible();
    (board as any).exportState.sourceRevision = 'c'.repeat(64);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save Board/ })); });
    expect(screen.queryByText(/Unsaved edits/)).not.toBeInTheDocument();
    expect(screen.getByText('Preview out of date')).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Export history' }), { target: { value: older.moviePath } });
    expect(screen.getByLabelText('Exported storyboard video')).toHaveAttribute('src', 'file:///C:/proof/old.mp4');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Open Video/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show in Folder' })); });
    expect(openFile).toHaveBeenCalledWith(older.moviePath);
    expect(showInFolder).toHaveBeenCalledWith(older.moviePath);
    expect(mocks.mediaStoryboardRender).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Review & Publish/ })).toBeDisabled();
  });

  test.each(['save', 'render'])('a late %s from A cannot replace B or clear its unsaved edits', async operation => {
    const mocks = setup();
    const board = (await mocks.mediaStoryboardGet()).result;
    mocks.mediaStoryboardGet.mockImplementation((id: string) => Promise.resolve({ ok: true,
      result: { ...board, project: { projectId: id, name: id }, renderedMoviePath: `C:/${id}/movie.mp4` } }));
    let finish!: (result: any) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    if (operation === 'save') mocks.mediaStoryboardSave.mockReturnValueOnce(pending);
    else mocks.mediaStoryboardRender.mockReturnValueOnce(pending);
    const { rerender } = render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />);
    await screen.findByLabelText('Duration for shot_001');
    fireEvent.click(screen.getByRole('button', { name: operation === 'save' ? /Save Board/ : /Render Movie/ }));
    if (operation === 'render') await waitFor(() => expect(mocks.mediaStoryboardRender).toHaveBeenCalled());
    else await waitFor(() => expect(mocks.mediaStoryboardSave).toHaveBeenCalled());
    await act(async () => { rerender(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'project-b' }} />); });
    fireEvent.change(screen.getByLabelText('Duration for shot_001'), { target: { value: '9' } });
    await act(async () => { finish({ ok: true, moviePath: 'C:/pyramid-builders/new.mp4', totalShots: 3, durationSec: 14 }); });
    expect(screen.getByLabelText('Exported storyboard video')).toHaveAttribute('src', 'file:///C:/project-b/movie.mp4');
    expect(screen.getByLabelText('Duration for shot_001')).toHaveValue(9);
    expect(screen.getByText(/Unsaved edits/)).toBeVisible();
    expect(screen.queryByText(/Successfully rendered/)).not.toBeInTheDocument();
  });

  test('an older file with unknown provenance never claims it matches the saved source', async () => {
    const mocks = setup();
    const board = (await mocks.mediaStoryboardGet()).result;
    Object.assign(board, { renderedMoviePath: 'C:/old/movie.mp4' });
    render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />);
    expect(await screen.findByText('Saved movie — source revision unknown')).toBeVisible();
    expect(screen.queryByText('Preview matches the saved revision')).not.toBeInTheDocument();
  });

  test('a removed scene with a JavaScript property name has unknown freshness, not an inherited revision', async () => {
    const mocks = setup();
    const board = (await mocks.mediaStoryboardGet()).result;
    const output = { exportId: 'removed-scene', filename: 'scene.mp4', moviePath: 'C:/proof/scene.mp4', createdAt: '2026-09-12T00:00:00Z',
      sourceSavedAt: null, sourceRevision: 'a'.repeat(64), sceneId: 'constructor', durationSeconds: 4, burnSubtitles: false, outputSpec: createStudioOutputSpec() };
    Object.assign(board, { renderedMoviePath: output.moviePath, exportState: { sourceRevision: 'b'.repeat(64), sceneRevisions: {}, outputs: [output] } });
    render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />);
    expect(await screen.findByText('Saved movie — current source cannot be verified')).toBeVisible();
  });

  test('storyboard shape, resolution and framing reach Save Board and Render Movie without changing shot timing', async () => {
    const api = setup();
    render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />);
    fireEvent.change(await screen.findByLabelText('Storyboard picture shape'), { target: { value: '9:16' } });
    fireEvent.change(screen.getByLabelText('Storyboard resolution'), { target: { value: '720p' } });
    fireEvent.change(screen.getByLabelText('Storyboard image framing'), { target: { value: 'fit' } });
    expect(screen.getByLabelText('Duration for shot_001')).toHaveValue(5);
    fireEvent.click(screen.getByRole('button', { name: /Render Movie/ }));
    await waitFor(() => expect(api.mediaStoryboardRender).toHaveBeenCalledTimes(1));
    const spec = api.mediaStoryboardSave.mock.calls[0][0].outputSpec;
    expect(spec).toMatchObject({ schemaVersion: 1, variants: [{ aspectRatio: '9:16', width: 720, height: 1280, framing: { mode: 'fit' } }] });
    expect(api.mediaStoryboardRender.mock.calls[0][0].outputSpec).toEqual(spec);
  });

  test('new video content length does not reset the selected picture shape', async () => {
    const mediaCreate = jest.fn(async () => ({ ok: true }));
    setup({ mediaCreate });
    render(<MediaStudioPanel />);
    fireEvent.change(await screen.findByLabelText('New video picture shape'), { target: { value: '9:16' } });
    fireEvent.change(screen.getByLabelText('Video format'), { target: { value: 'long' } });
    expect(screen.getByLabelText('New video picture shape')).toHaveValue('9:16');
    fireEvent.change(screen.getByLabelText('New video title'), { target: { value: 'Portrait feature' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add video' }));
    await waitFor(() => expect(mediaCreate).toHaveBeenCalledWith(expect.objectContaining({ format: 'long', outputSpec: expect.objectContaining({ durationIntent: 'long', variants: [expect.objectContaining({ aspectRatio: '9:16' })] }) })));
  });

  test('job format changes wait for persistence and approved jobs cannot be changed', async () => {
    const job: any = { id: 'draft', title: 'Format draft', format: 'short', state: 'idea', history: [] };
    const mediaRun = jest.fn(async (_id, _action, options) => { job.outputSpec = options.outputSpec; return { ok: true }; });
    setup({ mediaList: jest.fn(async () => [job, { ...job, id: 'approved', title: 'Reviewed master', state: 'approved' }]), mediaRun });
    render(<MediaStudioPanel />);
    const shape = await screen.findByLabelText('Format draft picture shape');
    expect(shape).toHaveValue('9:16'); // Legacy short geometry, not the new landscape default.
    fireEvent.change(shape, { target: { value: '16:9' } });
    await waitFor(() => expect(shape).toHaveValue('16:9'));
    expect(mediaRun).toHaveBeenCalledWith('draft', 'output', { outputSpec: expect.objectContaining({ durationIntent: 'short', variants: [expect.objectContaining({ width: 1920, height: 1080 })] }) });
    expect(screen.getByLabelText('Reviewed master picture shape')).toBeDisabled();
    expect(mediaRun).toHaveBeenCalledTimes(1);
  });

  test('explicit both selection keeps new-video length independent and reaches job creation', async () => {
    const mediaCreate = jest.fn(async () => ({ ok: true }));
    setup({ mediaCreate });
    render(<MediaStudioPanel />);
    fireEvent.change(await screen.findByLabelText('New video output selection'), { target: { value: 'both' } });
    fireEvent.change(screen.getByLabelText('Video format'), { target: { value: 'long' } });
    expect(screen.getByLabelText('New video output selection')).toHaveValue('both');
    expect(mediaCreate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('New video title'), { target: { value: 'Two explicit formats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add video' }));
    await waitFor(() => expect(mediaCreate).toHaveBeenCalledWith(expect.objectContaining({ format: 'long',
      outputSpec: expect.objectContaining({ durationIntent: 'long', variants: [
        expect.objectContaining({ aspectRatio: '16:9' }), expect.objectContaining({ aspectRatio: '9:16' }),
      ] }) })));
  });

  test('storyboard both choice saves independent portrait framing and reaches the existing render action', async () => {
    const api = setup();
    render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />);
    fireEvent.change(await screen.findByLabelText('Storyboard output selection'), { target: { value: 'both' } });
    fireEvent.change(screen.getByLabelText('Storyboard portrait image framing'), { target: { value: 'crop' } });
    fireEvent.change(screen.getByLabelText('Storyboard portrait crop horizontal position'), { target: { value: '0.25' } });
    expect(api.mediaStoryboardRender).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Render both formats/ }));
    await waitFor(() => expect(api.mediaStoryboardRender).toHaveBeenCalledTimes(1));
    const spec = api.mediaStoryboardSave.mock.calls[0][0].outputSpec;
    expect(spec.variants).toEqual([
      expect.objectContaining({ aspectRatio: '16:9', framing: expect.objectContaining({ x: 0.5 }) }),
      expect.objectContaining({ aspectRatio: '9:16', framing: expect.objectContaining({ mode: 'crop', x: 0.25 }) }),
    ]);
    expect(api.mediaStoryboardRender.mock.calls[0][0].outputSpec).toEqual(spec);
    expect(screen.getByLabelText('Duration for shot_001')).toHaveValue(5);
  });

  test('does not offer a caption switch that cannot change an external export', async () => {
    setup({ mediaList: jest.fn(async () => [{ id: 'external', title: 'External production', format: 'long',
      state: 'media_production', history: [{ note: 'Ancient Pathways pipeline runs its own stages internally' }] }]) });
    render(<MediaStudioPanel />);
    expect(await screen.findByText('Output settings for this export are controlled by Ancient Pathways.')).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: 'Burn captions into External production' })).not.toBeInTheDocument();
  });

  test('the ordinary job card saves its caption choice without starting a render', async () => {
    const job = { id: 'draft', title: 'Caption draft', format: 'long', state: 'idea', burnSubtitles: false, history: [] };
    const mediaRun = jest.fn(async () => { job.burnSubtitles = true; return { ok: true }; });
    setup({ mediaList: jest.fn(async () => [job]), mediaRun });
    render(<MediaStudioPanel />);
    const captions = await screen.findByRole('checkbox', { name: 'Burn captions into Caption draft' });
    expect(captions).not.toBeChecked();
    fireEvent.click(captions);
    await waitFor(() => expect(mediaRun).toHaveBeenCalledWith('draft', 'output', { burnSubtitles: true }));
    await waitFor(() => expect(captions).toBeChecked());
    expect(mediaRun).toHaveBeenCalledTimes(1);
  });

  test('caption choice is reachable, saved with the board, and reaches the full movie render', async () => {
    const api = setup();
    render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />);
    const captions = await screen.findByRole('checkbox', { name: 'Burn captions into storyboard video' });
    expect(captions).toBeChecked(); // legacy project retains its prior behavior
    fireEvent.click(captions);
    fireEvent.click(screen.getByRole('button', { name: /Render Movie/ }));
    await waitFor(() => expect(api.mediaStoryboardRender).toHaveBeenCalledWith(expect.objectContaining({ burnSubtitles: false })));
    expect(api.mediaStoryboardSave).toHaveBeenCalledWith(expect.objectContaining({ burnSubtitles: false }));
  });

  test('a late project response cannot replace the newly selected project or its movie', async () => {
    const mocks = setup();
    const board = (await mocks.mediaStoryboardGet()).result;
    let finishOldLoad!: (value: any) => void;
    mocks.mediaStoryboardGet.mockImplementation((id: string) => id === 'pyramid-builders'
      ? new Promise(resolve => { finishOldLoad = resolve; })
      : Promise.resolve({ ok: true, result: { ...board, project: { projectId: id, name: 'New project' }, renderedMoviePath: 'C:/new/movie.mp4' } }));
    const { rerender } = render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />);
    await act(async () => { rerender(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'new-project' }} />); });
    expect(screen.getByLabelText('Exported storyboard video')).toHaveAttribute('src', 'file:///C:/new/movie.mp4');
    await act(async () => { finishOldLoad({ ok: true, result: { ...board, renderedMoviePath: 'C:/old/movie.mp4' } }); });
    expect(screen.getByLabelText('Exported storyboard video')).toHaveAttribute('src', 'file:///C:/new/movie.mp4');
    expect(screen.getByRole('button', { name: /Review & Publish/i })).toBeDisabled();
  });

  test('edits the selected scene only and saves every scene before rendering the whole movie', async () => {
    const mocks = setup();
    const board = (await mocks.mediaStoryboardGet()).result;
    board.scenes.push({
      sceneId: 'scene_02', title: 'Ending',
      shots: [{ ...board.scenes[0].shots[0], narration: 'The ending.', durationSec: 8 }],
    });
    await act(async () => { render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />); });
    fireEvent.change(screen.getByLabelText('Select Storyboard Scene'), { target: { value: 'scene_02' } });
    fireEvent.change(screen.getByLabelText('Duration for shot_001'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Select Storyboard Scene'), { target: { value: 'scene_01' } });
    expect(screen.getByLabelText('Duration for shot_001')).toHaveValue(5);
    fireEvent.click(screen.getByRole('button', { name: /Render Movie/i }));
    await waitFor(() => expect(mocks.mediaStoryboardRender).toHaveBeenCalledTimes(1));
    expect(mocks.mediaStoryboardSave.mock.calls.map(([args]) => args.sceneId)).toEqual(['scene_01', 'scene_02']);
    expect(mocks.mediaStoryboardSave.mock.calls[1][0].shots[0].durationSec).toBe(9);
    expect(mocks.mediaStoryboardRender.mock.calls[0][0]).not.toHaveProperty('sceneId');
    expect(mocks.mediaStoryboardSave.mock.invocationCallOrder[1]).toBeLessThan(mocks.mediaStoryboardRender.mock.invocationCallOrder[0]);
  });

  test('does not render old disk content when saving the board fails', async () => {
    const mocks = setup();
    mocks.mediaStoryboardSave.mockResolvedValue({ ok: false, error: 'Disk is full' });
    await act(async () => { render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />); });
    fireEvent.click(screen.getByRole('button', { name: /Render Movie/i }));
    expect(await screen.findByText('Disk is full')).toBeInTheDocument();
    expect(mocks.mediaStoryboardRender).not.toHaveBeenCalled();
  });

  test('adding after a removal cannot reuse the ID of a remaining shot', async () => {
    const mocks = setup();
    const board = (await mocks.mediaStoryboardGet()).result;
    board.scenes[0].shots.splice(1, 1);
    await act(async () => { render(<MediaStudioPanel navContext={{ workspace: 'storyboard', projectId: 'pyramid-builders' }} />); });
    fireEvent.click(screen.getByRole('button', { name: /Add Shot to Storyboard/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save Board/i })); });
    const ids = mocks.mediaStoryboardSave.mock.calls[0][0].shots.map((s: any) => s.shotId);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain('shot_003');
  });

  test('renders Storyboard tab in ribbon and hub card in Director Console', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    // Ribbon Tab
    expect(screen.getByRole('tab', { name: /Storyboard/i })).toBeInTheDocument();
    // Hub Card
    expect(screen.getByText('Visual Storyboard Deck')).toBeInTheDocument();
  });

  test('switches to Storyboard Deck workspace on tab click and loads projects', async () => {
    const mocks = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const tab = screen.getByRole('tab', { name: /Storyboard/i });
    await act(async () => {
      fireEvent.click(tab);
    });

    expect(mocks.mediaStoryboardList).toHaveBeenCalled();
    expect(mocks.mediaStoryboardGet).toHaveBeenCalledWith('pyramid-builders');
    expect(screen.getByText('🎨 Visual Storyboard Deck')).toBeInTheDocument();
    expect(screen.getByText(/🎬 Pyramid Builders/)).toBeInTheDocument();
    expect(screen.getByText(/3 Shot\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/14s Total/)).toBeInTheDocument();
    expect(screen.getByText('Captions on')).toBeInTheDocument();
    expect(screen.queryByText(/✓ \$0\.00 Free Policy/)).not.toBeInTheDocument();
  });

  test('displays shot cards with camera framing pills and allows changing shot attributes', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const tab = screen.getByRole('tab', { name: /Storyboard/i });
    await act(async () => {
      fireEvent.click(tab);
    });

    // Check shot prompts
    expect(
      screen.getByDisplayValue(/Establishing wide shot of the limestone ramps/),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/Medium shot of mason carving hieroglyphic marker/),
    ).toBeInTheDocument();

    // Change framing on shot 1 from wide to close
    const shot1ClosePill = screen.getAllByRole('button', { name: /^close$/i })[0];
    await act(async () => {
      fireEvent.click(shot1ClosePill);
    });

    expect(shot1ClosePill).toHaveClass('active');
  });

  test('generates frame thumbnail via mediaStoryboardGenerateFrame', async () => {
    const mocks = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const tab = screen.getByRole('tab', { name: /Storyboard/i });
    await act(async () => {
      fireEvent.click(tab);
    });

    // Click generate button on shot_002 (which doesn't have an image rendered)
    const genButtons = screen.getAllByRole('button', { name: /⚡ Generate Frame/i });
    expect(genButtons.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(genButtons[0]);
    });

    expect(mocks.mediaStoryboardGenerateFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'pyramid-builders',
        shotId: 'shot_002',
      }),
    );
  });

  test('deep-linking via navContext loads storyboard workspace directly from Chat handoff', async () => {
    const mocks = setup();
    await act(async () => {
      render(
        <MediaStudioPanel
          navContext={{
            workspace: 'storyboard',
            projectId: 'pyramid-builders',
          }}
        />,
      );
    });

    expect(mocks.mediaStoryboardList).toHaveBeenCalled();
    expect(mocks.mediaStoryboardGet).toHaveBeenCalledWith('pyramid-builders');
    expect(screen.getByText('🎨 Visual Storyboard Deck')).toBeInTheDocument();
    expect(screen.getByText(/🎬 Pyramid Builders/)).toBeInTheDocument();
  });

  test('saves changes to storyboard via mediaStoryboardSave', async () => {
    const mocks = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const tab = screen.getByRole('tab', { name: /Storyboard/i });
    await act(async () => {
      fireEvent.click(tab);
    });

    const saveButton = screen.getByRole('button', { name: /💾 Save Board/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(mocks.mediaStoryboardSave).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'pyramid-builders',
        sceneId: 'scene_01',
      }),
    );
  });

  test('adds a new shot card to sequence', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const tab = screen.getByRole('tab', { name: /Storyboard/i });
    await act(async () => {
      fireEvent.click(tab);
    });

    const addCard = screen.getByRole('button', { name: /Add Shot to Storyboard/i });
    await act(async () => {
      fireEvent.click(addCard);
    });

    // Should now show 4 shots
    expect(screen.getByText(/4 Shot\(s\)/)).toBeInTheDocument();
  });

  test('opens Animatic Player modal and shows playback HUD and controls', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const tab = screen.getByRole('tab', { name: /Storyboard/i });
    await act(async () => {
      fireEvent.click(tab);
    });

    const playBtn = screen.getByRole('button', { name: /▶ Play Animatic/i });
    await act(async () => {
      fireEvent.click(playBtn);
    });

    // Modal dialog should open
    expect(screen.getByRole('dialog', { name: /Storyboard Animatic Player/i })).toBeInTheDocument();
    expect(screen.getByText(/Animatic Playback: Pyramid Builders/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /⏸ Pause/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close Animatic Player/i })).toBeInTheDocument();

    // Close animatic player
    const closeBtn = screen.getByRole('button', { name: /Close Animatic Player/i });
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    expect(screen.queryByRole('dialog', { name: /Storyboard Animatic Player/i })).not.toBeInTheDocument();
  });

  test('enhances shot prompt with composition and lens cues on button click', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const tab = screen.getByRole('tab', { name: /Storyboard/i });
    await act(async () => {
      fireEvent.click(tab);
    });

    const enhanceBtns = screen.getAllByRole('button', { name: /✨ Enhance Prompt/i });
    expect(enhanceBtns.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(enhanceBtns[0]);
    });

    // Prompt should now include cinematic enhancements
    const textarea = screen.getByDisplayValue(/cinematic/i);
    expect(textarea).toBeInTheDocument();
  });

  test('bridges storyboard to CapCut timeline with calculated edit cuts', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const tab = screen.getByRole('tab', { name: /Storyboard/i });
    await act(async () => {
      fireEvent.click(tab);
    });

    const timelineBtn = screen.getByRole('button', { name: /✂️ Open in CapCut/i });
    await act(async () => {
      fireEvent.click(timelineBtn);
    });

    // Should switch to timeline workspace and show confirmation
    expect(screen.getByText(/Loaded storyboard sequence into CapCut timeline with 2 edit cuts!/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /CapCut Timeline/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('renders 1080p broadcast movie on button click and displays completion banner', async () => {
    const mocks = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const tab = screen.getByRole('tab', { name: /Storyboard/i });
    await act(async () => {
      fireEvent.click(tab);
    });

    const renderBtn = screen.getByRole('button', { name: /🎬 Render Movie/i });
    expect(renderBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(renderBtn);
    });

    await waitFor(() => expect(mocks.mediaStoryboardRender).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'pyramid-builders',
        motion: true,
        burnSubtitles: true,
      }),
    ));

    // The saved export remains playable without claiming publication approval.
    expect(await screen.findByText('Saved movie')).toBeInTheDocument();
    expect(screen.getByLabelText('Exported storyboard video')).toHaveAttribute('src', 'file:///C:/fake/path/pyramid-builders-1080p.mp4');
    expect(screen.getByRole('button', { name: /▶ Open Video/i })).toBeInTheDocument();
  });

  test('opens Auto-Director drawer, selects a preset, and auto-directs a multi-shot storyboard', async () => {
    const mocks = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const tab = screen.getByRole('tab', { name: /Storyboard/i });
    await act(async () => {
      fireEvent.click(tab);
    });

    const directorBtn = screen.getByRole('button', { name: /🪄 Auto-Director/i });
    expect(directorBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(directorBtn);
    });

    // Drawer should appear
    expect(screen.getByText(/Script-to-Storyboard Director Engine/i)).toBeInTheDocument();

    // Click a preset chip (e.g. Cyberpunk)
    const presetBtn = screen.getByRole('button', { name: /🤖 Cyberpunk 2088/i });
    await act(async () => {
      fireEvent.click(presetBtn);
    });

    // Check textarea is filled
    const textarea = screen.getByLabelText(/Story script or scene prompt/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain('cybernetic detective');

    // Click Direct & Build Storyboard button
    const directActionBtn = screen.getByRole('button', { name: /🪄 Direct & Build Storyboard/i });
    await act(async () => {
      fireEvent.click(directActionBtn);
    });

    expect(mocks.mediaStoryboardBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({
        script: expect.stringContaining('cybernetic detective'),
        genre: 'cyberpunk_scifi',
        shotCount: 4,
      }),
    );
  });
});


