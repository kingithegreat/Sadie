/** @jest-environment jsdom */
/**
 * media-studio-workspaces.test.tsx — Unit tests for Media Studio DCC workspace switcher,
 * Director Quick Launch Hub, Movie Router 5-tier view, and navigation.
 */

import { render, screen, fireEvent, act, within } from '@testing-library/react';
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

  (window as any).electron = {
    mediaList,
    mediaAncientPathwaysEpisodes,
    mediaAncientPathwaysStatus,
    mediaMovieListProjects,
    mediaMovieRun,
    onMediaAncientPathwaysProgress: jest.fn().mockReturnValue(() => {}),
    ...overrides,
  };

  return {
    mediaList,
    mediaAncientPathwaysEpisodes,
    mediaAncientPathwaysStatus,
    mediaMovieListProjects,
    mediaMovieRun,
  };
}

afterEach(() => {
  delete (window as any).electron;
});

describe('Media Studio Workspaces & DCC Navigation', () => {
  test('renders top DCC branding ribbon and 4 status chips', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    expect(screen.getByText('🎬 Media Studio & Movie Engine')).toBeInTheDocument();
    expect(screen.getByText('Showrunner 2D')).toBeInTheDocument();
    expect(screen.getByText('5-Tier Router')).toBeInTheDocument();
    expect(screen.getByText('NLE CapCut')).toBeInTheDocument();
    expect(screen.getByText('Blender Stage')).toBeInTheDocument();
  });

  test('renders Director Quick Launch Hub with 4 interactive cards in default view', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const hub = screen.getByLabelText('Studio Quick Launch');
    expect(hub).toBeInTheDocument();
    expect(within(hub).getByText('5-Engine Movie Router')).toBeInTheDocument();
    expect(within(hub).getByText('Ancient Pathways 2D')).toBeInTheDocument();
    expect(within(hub).getByText('CapCut Timeline')).toBeInTheDocument();
    expect(within(hub).getByText('Stage Viewport')).toBeInTheDocument();
  });

  test('clicking Movie Router hub card switches to 5-tier Movie Router view and loads projects', async () => {
    const { mediaMovieListProjects } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('5-Engine Movie Router'));
    });

    // 5 Tier provider cards should be visible
    expect(screen.getByText('⚡ 5-Tier Autonomous Movie Generation Router')).toBeInTheDocument();
    expect(screen.getByText('Colab SDXL IP-Adapter')).toBeInTheDocument();
    expect(screen.getByText('Local Stable Diffusion 1.5')).toBeInTheDocument();
    expect(screen.getByText('Pollinations AI')).toBeInTheDocument();
    expect(screen.getByText('Google Imagen 3')).toBeInTheDocument();

    // Projects should be loaded
    expect(mediaMovieListProjects).toHaveBeenCalled();
    expect(screen.getByText('Imhotep at Karnak')).toBeInTheDocument();

    // Clicking Back returns to Director Console
    await act(async () => {
      fireEvent.click(screen.getByText('← Back to Director'));
    });

    expect(screen.getByLabelText('Studio Quick Launch')).toBeInTheDocument();
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
});
