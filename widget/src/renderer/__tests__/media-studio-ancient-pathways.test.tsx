/** @jest-environment jsdom */
/**
 * media-studio-ancient-pathways.test.tsx — "From Ancient Pathways…" in Media Studio.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

const MOCK_EPISODES = [
  {
    id: 'egypt',
    code: 'EP01',
    season: 1,
    title: 'Ancient Egypt: The Secret of the Pyramid Builders',
    era: '2500 BCE (Old Kingdom Egypt)',
    mainCharacter: 'Master Architect Imhotep',
    sceneCount: 14,
  },
  {
    id: 'babylon',
    code: 'EP06',
    season: 2,
    title: "Babylon: The Ishtar Gate & the World's Oldest Law",
    era: '575 BCE (Neo-Babylonian Empire)',
    mainCharacter: 'King Nebuchadnezzar II',
    sceneCount: 14,
  },
];

function setup(overrides: Record<string, any> = {}) {
   const mediaAncientPathwaysEpisodes = jest.fn().mockResolvedValue({
     ok: true,
     episodes: MOCK_EPISODES,
     available: true,
   });
   const mediaAncientPathwaysStatus = jest.fn().mockResolvedValue({
     ok: true,
     available: true,
     dir: '/mock/path/Ancient Pathways',
     lock: { locked: false },
   });
   const mediaAncientPathwaysRun = jest.fn().mockResolvedValue({
     ok: true,
     job: { id: 'j-ap1', title: 'Ancient Pathways: Babylon', state: 'render_qa' },
     renderPath: '/mock/path/Ancient_Pathways_Babylon_1080p.mp4',
   });
    const mediaAncientPathwaysDoctor = jest.fn().mockResolvedValue({
      ok: true,
      episodeId: 'babylon',
      checks: [
        { name: 'rigs resolve', ok: true, detail: 'all 8 rigs resolve' },
        { name: 'composition varies', ok: true, detail: 'stdev=0.12; centered=2/140' },
      ],
      failed: 0,
    });
    const mediaAncientPathwaysShowrunner = jest.fn().mockResolvedValue({
      ok: true,
      job: { id: 'j-sh1', title: 'Production: imhotep_master', state: 'render_qa' },
      renderPath: '/mock/workspace/productions/imhotep_master/scene_01/scene_master_1080p.mp4',
    });
    const mediaMovieRun = jest.fn().mockResolvedValue({
      ok: true,
      report: {
        projectId: 'imhotep-temple-01',
        totalShots: 4,
        completedShots: 4,
        deferredShots: 0,
        failedShots: 0,
        skippedShots: 0,
        results: [],
      },
    });
    const mediaMovieListProjects = jest.fn().mockResolvedValue({
      ok: true,
      projects: [{ id: 'imhotep-temple-01', name: 'Imhotep Approaches the Temple' }],
    });

    (window as any).electron = {
      mediaList: jest.fn().mockResolvedValue([]),
      mediaAncientPathwaysEpisodes,
      mediaAncientPathwaysStatus,
      mediaAncientPathwaysRun,
      mediaAncientPathwaysDoctor,
      mediaAncientPathwaysShowrunner,
      onMediaAncientPathwaysProgress: jest.fn().mockReturnValue(() => {}),
      mediaMovieRun,
      mediaMovieListProjects,
      ...overrides,
    };

    return {
      mediaAncientPathwaysEpisodes,
      mediaAncientPathwaysStatus,
      mediaAncientPathwaysRun,
      mediaAncientPathwaysDoctor,
      mediaAncientPathwaysShowrunner,
      mediaMovieRun,
      mediaMovieListProjects,
    };
 }

afterEach(() => {
  delete (window as any).electron;
});

describe('Media Studio — From Ancient Pathways', () => {
  test('is collapsed initially with button visible', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });
    expect(screen.getByText('From Ancient Pathways…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ancient Pathways episodes')).toBeNull();
  });

  test('loads and displays episode list when opened', async () => {
    const { mediaAncientPathwaysEpisodes } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    expect(mediaAncientPathwaysEpisodes).toHaveBeenCalled();
    expect(screen.getByText(/Ancient Egypt: The Secret of the Pyramid Builders/)).toBeInTheDocument();
    expect(screen.getByText(/Babylon: The Ishtar Gate/)).toBeInTheDocument();
  });

  test('clicking Produce Episode invokes mediaAncientPathwaysRun', async () => {
    const { mediaAncientPathwaysRun } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    const produceButtons = screen.getAllByText('Produce Episode');
    expect(produceButtons.length).toBe(2);

    await act(async () => {
      fireEvent.click(produceButtons[1]); // Babylon
    });

    expect(mediaAncientPathwaysRun).toHaveBeenCalledWith('babylon');
  });

  test('displays render lock warning when another render is active', async () => {
    setup({
      mediaAncientPathwaysStatus: jest.fn().mockResolvedValue({
        ok: true,
        available: true,
        dir: '/mock',
        lock: { locked: true, pid: 4444, message: 'Another render is active (PID 4444)' },
      }),
    });

    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    expect(screen.getByText('Another render is active (PID 4444)')).toBeInTheDocument();
  });

  test('filters episodes when season pills are clicked', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    expect(screen.getByText(/Ancient Egypt: The Secret of the Pyramid Builders/)).toBeInTheDocument();
    expect(screen.getByText(/Babylon: The Ishtar Gate/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText(/Season 1: Ancient Wonders/));
    });

    expect(screen.getByText(/Ancient Egypt: The Secret of the Pyramid Builders/)).toBeInTheDocument();
    expect(screen.queryByText(/Babylon: The Ishtar Gate/)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText(/Season 2: Empires & Builders/));
    });

    expect(screen.queryByText(/Ancient Egypt: The Secret of the Pyramid Builders/)).toBeNull();
    expect(screen.getByText(/Babylon: The Ishtar Gate/)).toBeInTheDocument();
  });

  test('filters episodes dynamically with search input', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    const searchInput = screen.getByLabelText('Search episodes');
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Egypt' } });
    });

    expect(screen.getByText(/Ancient Egypt: The Secret of the Pyramid Builders/)).toBeInTheDocument();
    expect(screen.queryByText(/Babylon: The Ishtar Gate/)).toBeNull();
  });

  test('displays Run Quality Check button for episodes', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    const doctorButtons = screen.getAllByText('Run Quality Check');
    expect(doctorButtons.length).toBeGreaterThan(0);
  });

  test('clicking Run Quality Check invokes mediaAncientPathwaysDoctor', async () => {
    const { mediaAncientPathwaysDoctor } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    const doctorButtons = screen.getAllByText('Run Quality Check');
    await act(async () => {
      fireEvent.click(doctorButtons[0]);
    });

    expect(mediaAncientPathwaysDoctor).toHaveBeenCalledTimes(1);
  });

  test('displays passed quality checks after running doctor', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    const doctorButtons = screen.getAllByText('Run Quality Check');
    await act(async () => {
      fireEvent.click(doctorButtons[0]);
    });

    await act(async () => {
      // Wait for the check to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(screen.getByText(/All quality checks passed/)).toBeInTheDocument();
  });

  test('showrunner panel appears within Ancient Pathways section', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    expect(screen.getByText('🎬 Showrunner — Generate a Scene')).toBeInTheDocument();
    expect(screen.getByLabelText('Showrunner prompt')).toBeInTheDocument();
    expect(screen.getByLabelText('Duration in seconds')).toBeInTheDocument();
    expect(screen.getByLabelText('Character names')).toBeInTheDocument();
    expect(screen.getByLabelText('Production name')).toBeInTheDocument();
    expect(screen.getByText('Generate Scene')).toBeInTheDocument();
  });

  test('clicking Generate Scene invokes mediaAncientPathwaysShowrunner with form values', async () => {
    const { mediaAncientPathwaysShowrunner } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Showrunner prompt'), {
        target: { value: 'Imhotep approaches and enters the great temple of Karnak at golden hour' },
      });
      fireEvent.change(screen.getByLabelText('Duration in seconds'), { target: { value: '60' } });
      fireEvent.change(screen.getByLabelText('Character names'), { target: { value: 'IMHOTEP,LEILA' } });
      fireEvent.change(screen.getByLabelText('Production name'), { target: { value: 'imhotep_master_60s' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Scene'));
    });

    expect(mediaAncientPathwaysShowrunner).toHaveBeenCalledWith({
      prompt: 'Imhotep approaches and enters the great temple of Karnak at golden hour',
      duration: 60,
      characters: 'IMHOTEP,LEILA',
      name: 'imhotep_master_60s',
    });
  });

  test('Generate Scene is disabled when prompt is empty', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    expect(screen.getByText('Generate Scene')).toBeDisabled();
  });

  test('Load Projects button invokes mediaMovieListProjects', async () => {
    const { mediaMovieListProjects } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Load Projects'));
    });

    expect(mediaMovieListProjects).toHaveBeenCalledTimes(1);
  });

  test('clicking a project invokes mediaMovieRun with project id', async () => {
    const { mediaMovieListProjects, mediaMovieRun } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Load Projects'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Imhotep Approaches the Temple'));
    });

    expect(mediaMovieRun).toHaveBeenCalledWith({ projectDir: 'imhotep-temple-01' });
  });

  test('movie router shows result on success', async () => {
    const { mediaMovieRun } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('From Ancient Pathways…'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Load Projects'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Imhotep Approaches the Temple'));
    });

    // Wait for the result to appear
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(screen.getByText(/4 shot\(s\) generated/)).toBeInTheDocument();
  });
});
