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

  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([]),
    mediaAncientPathwaysEpisodes,
    mediaAncientPathwaysStatus,
    mediaAncientPathwaysRun,
    onMediaAncientPathwaysProgress: jest.fn().mockReturnValue(() => {}),
    ...overrides,
  };

  return {
    mediaAncientPathwaysEpisodes,
    mediaAncientPathwaysStatus,
    mediaAncientPathwaysRun,
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
});
