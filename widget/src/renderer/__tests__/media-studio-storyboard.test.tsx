/** @jest-environment jsdom */
/**
 * media-studio-storyboard.test.tsx — Unit tests for Media Studio Visual Storyboard Deck,
 * shot cards, camera framing pills, AI frame generation, and Chat navContext handoff.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

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
    expect(screen.getByText(/✓ \$0\.00 Free Policy/)).toBeInTheDocument();
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

    expect(mocks.mediaStoryboardRender).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'pyramid-builders',
        motion: true,
        burnSubtitles: true,
      }),
    );

    // Should display completion banner
    expect(screen.getByText(/1080p Broadcast Movie Ready!/i)).toBeInTheDocument();
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


