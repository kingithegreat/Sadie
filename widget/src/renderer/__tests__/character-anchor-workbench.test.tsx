/** @jest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CharacterAnchorWorkbench } from '../components/CharacterAnchorWorkbench';

const MOCK_CHARACTERS = [
  {
    slug: 'leila',
    name: 'Leila',
    totalPoses: 27,
    handPlacedMouthAnchors: 27,
    headBoxes: 27,
    suggestedMouthAnchors: 0,
    missingMouthAnchors: 0,
  },
  {
    slug: 'flappy',
    name: 'Flappy',
    totalPoses: 26,
    handPlacedMouthAnchors: 26,
    headBoxes: 26,
    suggestedMouthAnchors: 0,
    missingMouthAnchors: 0,
  },
];

const MOCK_LEILA_DETAIL = {
  slug: 'leila',
  name: 'Leila',
  manifest: {
    pose_a: {
      idle: 'pose_a/idle.png',
      walking: 'pose_a/walking.png',
    },
    mouth: {
      A: 'mouth/A.png',
      E: 'mouth/E.png',
    },
    _head_boxes: {
      pose_a: {
        idle: [7, 0, 70, 75],
      },
    },
    _mouth_anchors: {
      pose_a: {
        idle: [32, 55, 20, 14],
      },
    },
  },
  groups: ['pose_a'],
  mouthVisemes: {
    A: 'data:image/png;base64,mockA',
    E: 'data:image/png;base64,mockE',
  },
  stats: {
    totalPoses: 27,
    handPlacedMouthAnchors: 27,
    headBoxes: 27,
    suggestedMouthAnchors: 0,
    missingMouthAnchors: 0,
  },
};

function setup() {
  const mediaAncientPathwaysGetAnchors = jest.fn().mockResolvedValue({
    ok: true,
    characters: MOCK_CHARACTERS,
    selected: MOCK_LEILA_DETAIL,
  });
  const mediaAncientPathwaysGetSprite = jest.fn().mockResolvedValue({
    ok: true,
    dataUrl: 'data:image/png;base64,mockSprite',
  });
  const mediaAncientPathwaysSaveAnchor = jest.fn().mockResolvedValue({
    ok: true,
    message: 'Saved',
    box: [32, 55, 20, 14],
  });
  const mediaAncientPathwaysSuggestAnchors = jest.fn().mockResolvedValue({
    ok: true,
    message: 'Proposals ready',
  });

  (window as any).electron = {
    mediaAncientPathwaysGetAnchors,
    mediaAncientPathwaysGetSprite,
    mediaAncientPathwaysSaveAnchor,
    mediaAncientPathwaysSuggestAnchors,
  };

  return {
    mediaAncientPathwaysGetAnchors,
    mediaAncientPathwaysGetSprite,
    mediaAncientPathwaysSaveAnchor,
    mediaAncientPathwaysSuggestAnchors,
  };
}

describe('CharacterAnchorWorkbench', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders workbench title and loads characters', async () => {
    const { mediaAncientPathwaysGetAnchors } = setup();

    await act(async () => {
      render(<CharacterAnchorWorkbench />);
    });

    expect(screen.getByText(/Character Anchor & Viseme Calibration Workbench/i)).toBeTruthy();
    expect(mediaAncientPathwaysGetAnchors).toHaveBeenCalled();
    expect(screen.getByText('Leila')).toBeTruthy();
    expect(screen.getByText('Flappy')).toBeTruthy();
  });

  it('displays mouth anchor coordinates, saves them, and reloads calibration', async () => {
    const { mediaAncientPathwaysSaveAnchor, mediaAncientPathwaysGetAnchors } = setup();

    await act(async () => {
      render(<CharacterAnchorWorkbench />);
    });

    // Verify Mouth Anchor section is rendered
    expect(screen.getByText(/Mouth Anchor \[x, y, w, h\]/i)).toBeTruthy();

    const saveBtn = screen.getByText(/Save Mouth Anchor to Manifest/i);
    expect(saveBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(mediaAncientPathwaysSaveAnchor).toHaveBeenCalledWith({
      character: 'leila',
      group: 'pose_a',
      pose: 'idle',
      anchorType: 'mouth',
      box: [32, 55, 20, 14],
    });
    // A save reloads the manifest-backed detail so the visible calibration is current.
    expect(mediaAncientPathwaysGetAnchors).toHaveBeenCalledTimes(2);
  });

  it('allows activating phoneme viseme preview buttons', async () => {
    setup();

    await act(async () => {
      render(<CharacterAnchorWorkbench />);
    });

    const visemeA = screen.getByTitle('Phoneme / Viseme: A');
    expect(visemeA).toBeTruthy();

    await act(async () => {
      fireEvent.click(visemeA);
    });

    expect(visemeA.className).toContain('active');
  });

  it('allows zooming the canvas view', async () => {
    setup();

    await act(async () => {
      render(<CharacterAnchorWorkbench />);
    });

    const zoom400 = screen.getByText('400%');
    expect(zoom400).toBeTruthy();

    await act(async () => {
      fireEvent.click(zoom400);
    });

    expect(zoom400.className).toContain('ms-btn--primary');
  });
});
