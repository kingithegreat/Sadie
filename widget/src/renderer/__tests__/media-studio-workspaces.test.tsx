/** @jest-environment jsdom */
/**
 * media-studio-workspaces.test.tsx — Unit tests for Media Studio DCC workspace switcher,
 * Director Quick Launch Hub, Movie Router 5-tier view, and navigation.
 */

import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

function setup(overrides: Record<string, any> = {}) {
  const mediaList = jest.fn().mockResolvedValue([]);
  const mediaAncientPathwaysEpisodes = jest.fn().mockResolvedValue({
    ok: true,
    episodes: [
      {
        id: 'egypt',
        code: 'EP01',
        season: 1,
        title: 'Ancient Egypt: The Secret of the Pyramid Builders',
        era: '2500 BCE',
        mainCharacter: 'Master Architect Imhotep',
        sceneCount: 14,
      },
    ],
    available: true,
  });
  const mediaAncientPathwaysStatus = jest.fn().mockResolvedValue({
    ok: true,
    available: true,
    dir: '/mock/ap',
    lock: { locked: false },
  });
  const mediaMovieListProjects = jest.fn().mockResolvedValue({
    ok: true,
    projects: [
      { id: 'proj-01', name: 'Imhotep at Karnak', projectDir: '/mock/proj-01' },
    ],
  });
  const mediaMovieRun = jest.fn().mockResolvedValue({
    ok: true,
    report: { totalShots: 4, completedShots: 4, results: [] },
  });
  const mediaMovieListColabJobs = jest.fn().mockResolvedValue({ ok: true, jobs: [] });
  const mediaMovieCancelColabJob = jest.fn().mockResolvedValue({ ok: true });
  const mediaMovieRetryColabJob = jest.fn().mockResolvedValue({ ok: true });
  const getSettings = jest.fn().mockResolvedValue({ useCustomLLM: true });
  const getCapabilityReport = jest.fn().mockResolvedValue({
    success: true,
    capabilities: [{
      id: 'media-studio',
      label: 'Make videos',
      state: 'missing',
      detail: 'The video engine is not installed.',
      fix: 'Install an FFmpeg video engine.',
    }],
    summary: { ready: 0, total: 1, needsAttention: [] },
  });

  (window as any).electron = {
    mediaList,
    mediaAncientPathwaysEpisodes,
    mediaAncientPathwaysStatus,
    mediaMovieListProjects,
    mediaMovieRun,
    mediaMovieListColabJobs: overrides.mediaMovieListColabJobs ?? mediaMovieListColabJobs,
    mediaMovieCancelColabJob: overrides.mediaMovieCancelColabJob ?? mediaMovieCancelColabJob,
    mediaMovieRetryColabJob: overrides.mediaMovieRetryColabJob ?? mediaMovieRetryColabJob,
    getSettings,
    getCapabilityReport,
    onMediaAncientPathwaysProgress: jest.fn().mockReturnValue(() => {}),
    ...overrides,
  };

  return {
    mediaList,
    mediaAncientPathwaysEpisodes,
    mediaAncientPathwaysStatus,
    mediaMovieListProjects,
    mediaMovieRun,
    mediaMovieListColabJobs: (window as any).electron.mediaMovieListColabJobs,
    mediaMovieCancelColabJob: (window as any).electron.mediaMovieCancelColabJob,
    mediaMovieRetryColabJob: (window as any).electron.mediaMovieRetryColabJob,
    getSettings,
    getCapabilityReport,
  };
}

afterEach(() => {
  delete (window as any).electron;
});

describe('Media Studio Workspaces & DCC Navigation', () => {
  test('renders top DCC branding ribbon and status chips', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    expect(screen.getByText('🎬 Media Studio & Movie Engine')).toBeInTheDocument();
    expect(screen.getByText('Showrunner 2D')).toBeInTheDocument();
    expect(screen.getByText('Shot Router')).toBeInTheDocument();
    expect(screen.getByText('NLE CapCut')).toBeInTheDocument();
    expect(screen.getByText('Blender Stage')).toBeInTheDocument();
    expect(screen.getByText('ComfyUI Nodes')).toBeInTheDocument();
  });

  test('renders Director Quick Launch Hub with interactive cards in default view', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const hub = screen.getByLabelText('Studio Quick Launch');
    expect(hub).toBeInTheDocument();
    expect(within(hub).getByText('Movie Router')).toBeInTheDocument();
    // Google retired Imagen 3 (#334); the hub must not advertise it as an engine.
    expect(hub.textContent).not.toMatch(/Imagen/);
    expect(within(hub).getByText('Ancient Pathways 2D')).toBeInTheDocument();
    expect(within(hub).getByText('CapCut Timeline')).toBeInTheDocument();
    expect(within(hub).getByText('Stage Viewport')).toBeInTheDocument();
  });

  test('clicking Movie Router hub card switches to the Movie Router view and loads projects', async () => {
    const { mediaMovieListProjects } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      // The workspace tab has the same name; click the hub card this test is about.
      fireEvent.click(within(screen.getByLabelText('Studio Quick Launch')).getByText('Movie Router'));
    });

    // One card per provider that can actually generate a shot
    expect(screen.getByText('⚡ Autonomous Movie Generation Router')).toBeInTheDocument();
    expect(screen.getByText('Ancient Pathways 2D')).toBeInTheDocument();
    expect(screen.getByText('Colab SDXL IP-Adapter')).toBeInTheDocument();
    expect(screen.getByText('ComfyUI (Local Port 8188)')).toBeInTheDocument();
    expect(screen.getByText('Local Stable Diffusion 1.5')).toBeInTheDocument();
    expect(screen.getByText('Pollinations AI')).toBeInTheDocument();
    // Google retired Imagen 3 (#334): no card, and no "6-tier" count that counted it.
    expect(screen.queryByText(/Imagen/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/6-Tier|6-Engine|6 Engines/);

    // Projects should be loaded
    expect(mediaMovieListProjects).toHaveBeenCalled();
    expect(screen.getByText('Imhotep at Karnak')).toBeInTheDocument();

    // Clicking Back returns to Director Console
    await act(async () => {
      fireEvent.click(screen.getByText('← Back to Director'));
    });

    expect(screen.getByLabelText('Studio Quick Launch')).toBeInTheDocument();
  });

  test('manual Colab is opt-in and only a checked run enables deferred providers', async () => {
    const { mediaMovieRun } = setup();
    await act(async () => { render(<MediaStudioPanel />); });
    await act(async () => {
      fireEvent.click(within(screen.getByLabelText('Studio Quick Launch')).getByText('Movie Router'));
    });

    const route = await screen.findByRole('button', { name: /Route & Generate/i });
    await act(async () => { fireEvent.click(route); });
    expect(mediaMovieRun).toHaveBeenLastCalledWith({ projectDir: '/mock/proj-01' });

    fireEvent.click(screen.getByLabelText('Allow manual Colab worker'));
    await act(async () => { fireEvent.click(route); });
    expect(mediaMovieRun).toHaveBeenLastCalledWith({ projectDir: '/mock/proj-01', allowDeferred: true });
  });

  test('shows project Colab jobs and cancel/retry calls refresh with stale-attempt guards', async () => {
    const pending = {
      ticketId: 'colab_ticket_shot_001_aaaa', jobId: 'aaaa', sceneId: 'scene_01', shotId: 'shot_001',
      createdAt: '2026-09-20T00:00:00.000Z', attempts: 2, status: 'AWAITING_WORKER', error: undefined,
      outputReady: false, canCancel: true, canRetry: false,
    };
    const failed = {
      ticketId: 'colab_ticket_shot_002_bbbb', jobId: 'bbbb', sceneId: 'scene_01', shotId: 'shot_002',
      createdAt: '2026-09-20T00:00:01.000Z', attempts: 3, status: 'FAILED', error: 'CUDA ran out of memory',
      outputReady: true, canCancel: false, canRetry: true,
    };
    const controls = setup({
      mediaMovieListColabJobs: jest.fn().mockResolvedValue({ ok: true, jobs: [pending, failed] }),
    });
    await act(async () => { render(<MediaStudioPanel />); });
    await act(async () => {
      fireEvent.click(within(screen.getByLabelText('Studio Quick Launch')).getByText('Movie Router'));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Refresh Colab queue for Imhotep at Karnak' }));
    });

    expect(screen.getByLabelText('Colab queue for Imhotep at Karnak')).toHaveTextContent('shot_001');
    expect(screen.getByLabelText('Colab queue for Imhotep at Karnak')).toHaveTextContent('Attempt 3');
    expect(screen.getByText('CUDA ran out of memory')).toBeInTheDocument();
    expect(screen.getByText('Output ready')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel pending ticket' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/active Colab notebook may still finish/i);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel the pending ticket' })); });
    await waitFor(() => expect(controls.mediaMovieCancelColabJob).toHaveBeenCalledWith({
      projectDir: '/mock/proj-01', ticketId: pending.ticketId, expectedAttempts: 2,
    }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await waitFor(() => expect(controls.mediaMovieRetryColabJob).toHaveBeenCalledWith({
      projectDir: '/mock/proj-01', ticketId: failed.ticketId, expectedAttempts: 3,
    }));
    expect(controls.mediaMovieListColabJobs.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test('retry stays unavailable with Online off while pending-ticket cancel remains available', async () => {
    const jobs = [
      { ticketId: 'colab_ticket_pending', jobId: 'a', sceneId: 'scene_01', shotId: 'shot_001', createdAt: '', attempts: 1, status: 'AWAITING_WORKER', outputReady: false, canCancel: true, canRetry: false },
      { ticketId: 'colab_ticket_failed', jobId: 'b', sceneId: 'scene_01', shotId: 'shot_002', createdAt: '', attempts: 1, status: 'FAILED', outputReady: false, canCancel: false, canRetry: true },
    ];
    setup({
      getSettings: jest.fn().mockResolvedValue({ useCustomLLM: false }),
      mediaMovieListColabJobs: jest.fn().mockResolvedValue({ ok: true, jobs }),
    });
    await act(async () => { render(<MediaStudioPanel />); });
    await act(async () => { fireEvent.click(within(screen.getByLabelText('Studio Quick Launch')).getByText('Movie Router')); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Refresh Colab queue/i })); });

    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel pending ticket' })).toBeEnabled();
  });

  test('keeps cancel and retry mutation errors visible instead of clearing them with a refresh', async () => {
    const jobs = [
      { ticketId: 'colab_ticket_pending', jobId: 'a', sceneId: 'scene_01', shotId: 'shot_001', createdAt: '', attempts: 1, status: 'AWAITING_WORKER', outputReady: false, canCancel: true, canRetry: false },
      { ticketId: 'colab_ticket_failed', jobId: 'b', sceneId: 'scene_01', shotId: 'shot_002', createdAt: '', attempts: 2, status: 'FAILED', outputReady: false, canCancel: false, canRetry: true },
    ];
    const list = jest.fn().mockResolvedValue({ ok: true, jobs });
    const controls = setup({
      mediaMovieListColabJobs: list,
      mediaMovieCancelColabJob: jest.fn().mockResolvedValue({ ok: false, error: 'Cancel snapshot is stale.' }),
      mediaMovieRetryColabJob: jest.fn().mockResolvedValue({ ok: false, error: 'Retry needs Online access.' }),
    });
    await act(async () => { render(<MediaStudioPanel />); });
    await act(async () => { fireEvent.click(within(screen.getByLabelText('Studio Quick Launch')).getByText('Movie Router')); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Refresh Colab queue/i })); });
    const callsAfterRefresh = list.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Cancel pending ticket' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel the pending ticket' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancel snapshot is stale.');
    expect(controls.mediaMovieCancelColabJob).toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(callsAfterRefresh);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Retry needs Online access.');
    expect(controls.mediaMovieRetryColabJob).toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(callsAfterRefresh);
  });

  test('presents a cancelled ticket late output as unavailable, not ready to use', async () => {
    setup({
      mediaMovieListColabJobs: jest.fn().mockResolvedValue({
        ok: true,
        jobs: [{
          ticketId: 'colab_ticket_cancelled', jobId: 'c', sceneId: 'scene_01', shotId: 'shot_cancelled',
          createdAt: '', attempts: 1, status: 'CANCELLED', outputReady: false, canCancel: false, canRetry: true,
        }],
      }),
    });
    await act(async () => { render(<MediaStudioPanel />); });
    await act(async () => { fireEvent.click(within(screen.getByLabelText('Studio Quick Launch')).getByText('Movie Router')); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Refresh Colab queue/i })); });

    const queue = screen.getByLabelText('Colab queue for Imhotep at Karnak');
    expect(queue).toHaveTextContent('CANCELLED');
    expect(queue).toHaveTextContent('Output not ready');
    expect(within(queue).queryByText('Output ready')).not.toBeInTheDocument();
  });

  test('switching to CapCut Timeline displays NLE tools and Back button', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    // Click tab
    const timelineTab = screen.getByRole('tab', { name: /CapCut Timeline/i });
    await act(async () => {
      fireEvent.click(timelineTab);
    });

    expect(screen.getByText('✂️ Split')).toBeInTheDocument();
    expect(screen.getByText('🗑️ Ripple')).toBeInTheDocument();

    // Click Back to Director
    await act(async () => {
      fireEvent.click(screen.getByText('← Back to Director'));
    });

    expect(screen.getByLabelText('Studio Quick Launch')).toBeInTheDocument();
  });

  test('switching to Stage Viewport displays Blender camera controls and Back button', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const stageTab = screen.getByRole('tab', { name: /Stage Viewport/i });
    await act(async () => {
      fireEvent.click(stageTab);
    });

    expect(screen.getByLabelText('Camera Aspect Ratio')).toBeInTheDocument();
    expect(screen.getByText('16:9 Landscape (YouTube)')).toBeInTheDocument();
    // The export does no compositing, so the Stage must not imply its settings reach the video.
    expect(screen.getByRole('note', { name: 'Stage preview only' })).toHaveTextContent(/not your exported video/);
    expect(screen.queryByText(/Color Grade/)).toBeNull();

    // Click Back to Director
    await act(async () => {
      fireEvent.click(screen.getByText('← Back to Director'));
    });

    expect(screen.getByLabelText('Studio Quick Launch')).toBeInTheDocument();
  });

  test('switching to Ancient Pathways dedicated workspace renders showrunner and back button', async () => {
    const { mediaAncientPathwaysEpisodes } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const apTab = screen.getByRole('tab', { name: /Ancient Pathways/i });
    await act(async () => {
      fireEvent.click(apTab);
    });

    expect(mediaAncientPathwaysEpisodes).toHaveBeenCalled();
    expect(screen.getByText('🏛️ Ancient Pathways 2D Animation Showrunner')).toBeInTheDocument();
    expect(screen.getByLabelText('Showrunner prompt')).toBeInTheDocument();

    // Click Back to Director
    await act(async () => {
      fireEvent.click(screen.getByText('← Back to Director'));
    });

    expect(screen.getByLabelText('Studio Quick Launch')).toBeInTheDocument();
  });

  test('opening Diagnostics invokes the current capability API and shows its result', async () => {
    const { getCapabilityReport } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    expect(getCapabilityReport).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /Diagnostics/i }));
    });

    await waitFor(() => {
      expect(getCapabilityReport).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('cap-media-studio')).toHaveTextContent('The video engine is not installed.');
    });
  });
});
