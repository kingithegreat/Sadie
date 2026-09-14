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

    // Verify Head Box overlay is rendered with correct calibrated dimensions (zoom = 2, [7, 0, 70, 75])
    const headBoxEl = document.querySelector('.caw-box-head') as HTMLElement;
    expect(headBoxEl).toBeTruthy();
    expect(headBoxEl.style.left).toBe('14px');
    expect(headBoxEl.style.top).toBe('0px');
    expect(headBoxEl.style.width).toBe('140px');
    expect(headBoxEl.style.height).toBe('150px');

    // Verify Mouth Anchor overlay is rendered with correct calibrated dimensions (zoom = 2, [32, 55, 20, 14])
    const mouthBoxEl = document.querySelector('.caw-box-mouth') as HTMLElement;
    expect(mouthBoxEl).toBeTruthy();
    expect(mouthBoxEl.style.left).toBe('64px');
    expect(mouthBoxEl.style.top).toBe('110px');
    expect(mouthBoxEl.style.width).toBe('40px');
    expect(mouthBoxEl.style.height).toBe('28px');

    // Verify Mouth Anchor section is rendered in drawer
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

  it('asks before replacing a hand-placed anchor, and only a confirmed replace saves it', async () => {
    const { mediaAncientPathwaysSaveAnchor } = setup();
    mediaAncientPathwaysSaveAnchor
      .mockResolvedValueOnce({ ok: false, code: 'CONFIRM_OVERWRITE', existingBox: [30, 50, 18, 12], error: 'A hand-placed mouth anchor already exists.' })
      .mockResolvedValueOnce({ ok: false, code: 'CONFIRM_OVERWRITE', existingBox: [30, 50, 18, 12], error: 'A hand-placed mouth anchor already exists.' })
      .mockResolvedValueOnce({ ok: true, message: 'Replaced mouth anchor for leila [pose_a/idle].', box: [32, 55, 20, 14] });
    await act(async () => { render(<CharacterAnchorWorkbench />); });

    await act(async () => { fireEvent.click(screen.getByText(/Save Mouth Anchor to Manifest/i)); });
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('placed by hand at x 30, y 50, 18×12');
    expect(dialog).toHaveTextContent('Saving puts it at x 32, y 55, 20×14');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Keep the hand-placed one' })); });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mediaAncientPathwaysSaveAnchor).toHaveBeenCalledTimes(1);
    expect(mediaAncientPathwaysSaveAnchor.mock.calls[0][0]).not.toHaveProperty('confirmOverwrite');

    await act(async () => { fireEvent.click(screen.getByText(/Save Mouth Anchor to Manifest/i)); });
    dialog = await screen.findByRole('alertdialog');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Replace the mouth anchor' })); });
    expect(mediaAncientPathwaysSaveAnchor).toHaveBeenCalledTimes(3);
    expect(mediaAncientPathwaysSaveAnchor.mock.calls[2][0]).toMatchObject({ anchorType: 'mouth', box: [32, 55, 20, 14], confirmOverwrite: true });
  });

  it('allows activating phoneme viseme preview and positions it matching rendered placement', async () => {
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

    // Check that live viseme preview tile is rendered and centered over the mouth anchor:
    // (x + w/2) * zoom = (32 + 10) * 2 = 84px, (y + h/2) * zoom = (55 + 7) * 2 = 124px
    const visemeImg = document.querySelector('.caw-viseme-preview') as HTMLElement;
    expect(visemeImg).toBeTruthy();
    expect(visemeImg.style.left).toBe('84px');
    expect(visemeImg.style.top).toBe('124px');
    expect(visemeImg.style.width).toBe('40px');
    expect(visemeImg.style.height).toBe('28px');
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
