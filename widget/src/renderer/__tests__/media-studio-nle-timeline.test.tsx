/** @jest-environment jsdom */
/**
 * media-studio-nle-timeline.test.tsx — Unit tests for professional NLE timeline editing controls,
 * track lock/mute/visibility, In/Out range marking, multi-tab inspector, and hotkeys.
 */

import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

function setup(overrides: Record<string, any> = {}) {
  const mediaList = jest.fn().mockResolvedValue([
    {
      id: 'job-1',
      title: 'Secrets of the Pyramids',
      state: 'rendered',
      format: 'short',
      durationSeconds: 30,
      renderPath: '/mock/export/pyramids.mp4',
      scenePaths: ['/mock/scenes/s1.jpg', '/mock/scenes/s2.jpg'],
      script: 'Deep in the sands of Egypt, the grand pyramid awaits.',
    },
  ]);
  const mediaTrimClip = jest.fn().mockResolvedValue({
    ok: true,
    result: { path: '/mock/export/trimmed_pyramids.mp4' },
  });

  (window as any).electron = {
    mediaList,
    mediaTrimClip,
    ...overrides,
  };

  return {
    mediaList,
    mediaTrimClip,
  };
}

afterEach(() => {
  delete (window as any).electron;
});

describe('Media Studio Pro NLE Timeline Workspace', () => {
  test('renders timeline workspace with pro track controls, In/Out tools, and hotkey bar', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    // Switch to CapCut Timeline
    const timelineTab = screen.getByRole('tab', { name: /CapCut Timeline/i });
    await act(async () => {
      fireEvent.click(timelineTab);
    });

    // Verify NLE tools
    expect(screen.getByText('✂️ Split')).toBeInTheDocument();
    expect(screen.getByText('🗑️ Ripple')).toBeInTheDocument();
    expect(screen.getByText('[I] In')).toBeInTheDocument();
    expect(screen.getByText('[O] Out')).toBeInTheDocument();
    expect(screen.getByText('⚡ Export Range')).toBeInTheDocument();

    // Verify Track Controls for V1, A1, A2, A3, T1
    expect(screen.getByLabelText('Track V1 controls')).toBeInTheDocument();
    expect(screen.getByLabelText('Track A1 controls')).toBeInTheDocument();
    expect(screen.getByLabelText('Track A2 controls')).toBeInTheDocument();
    expect(screen.getByLabelText('Track A3 controls')).toBeInTheDocument();
    expect(screen.getByLabelText('Track T1 controls')).toBeInTheDocument();

    // Verify 4 Inspector tabs
    expect(screen.getByRole('tab', { name: /📋 Properties/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /🎨 Transitions & FX/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /🎙️ Audio & Ducking/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /⚡ Export Master/i })).toBeInTheDocument();

    // Verify hotkey footer
    expect(screen.getByText('Split Razor')).toBeInTheDocument();
    expect(screen.getByText('Mark In')).toBeInTheDocument();
    expect(screen.getByText('Mark Out')).toBeInTheDocument();
    expect(screen.getByText('SMPTE 30fps NLE')).toBeInTheDocument();
  });

  test('locking track V1 prevents split and displays error message', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    // Switch to Timeline
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /CapCut Timeline/i }));
    });

    // Lock Track V1
    const v1Controls = screen.getByLabelText('Track V1 controls');
    const lockBtn = within(v1Controls).getByTitle(/Lock track V1/i);
    await act(async () => {
      fireEvent.click(lockBtn);
    });

    // Now attempt to split
    await act(async () => {
      fireEvent.click(screen.getByText('✂️ Split'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Track V1 is locked. Unlock to split.');

    // Unlock Track V1
    const unlockBtn = within(v1Controls).getByTitle(/Unlock track V1/i);
    await act(async () => {
      fireEvent.click(unlockBtn);
    });

    // Splitting now succeeds
    await act(async () => {
      fireEvent.click(screen.getByText('✂️ Split'));
    });
    expect(screen.queryByText('Track V1 is locked. Unlock to split.')).not.toBeInTheDocument();
  });

  test('setting In and Out points renders shading and enables range clearing and export', async () => {
    const { mediaTrimClip } = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    // Switch to Timeline
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /CapCut Timeline/i }));
    });

    // Mark In point
    await act(async () => {
      fireEvent.click(screen.getByText('[I] In'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(/In-point marked at/i);

    // Step forward and Mark Out point
    await act(async () => {
      fireEvent.click(screen.getByTitle('Step frame forward 1s (▶|)'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('[O] Out'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Out-point marked at/i);

    // Verify clear range button appears and clicking it clears range
    const clearBtn = screen.getByText('✕ Range');
    expect(clearBtn).toBeInTheDocument();

    // Export Range calls mediaTrimClip
    await act(async () => {
      fireEvent.click(screen.getByText('⚡ Export Range'));
    });
    expect(mediaTrimClip).toHaveBeenCalled();

    // Clear range
    await act(async () => {
      fireEvent.click(clearBtn);
    });
    expect(screen.queryByText('✕ Range')).not.toBeInTheDocument();
  });

  test('switching Inspector tabs displays transitions, color grade LUTs, audio ducking, and master export', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    // Switch to Timeline
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /CapCut Timeline/i }));
    });

    // Switch to Transitions & FX tab
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /🎨 Transitions & FX/i }));
    });
    expect(screen.getByText('Cross Dissolve')).toBeInTheDocument();
    expect(screen.getByText('Warm Nile')).toBeInTheDocument();
    expect(screen.getByText('Teal & Orange')).toBeInTheDocument();

    // Switch to Audio & Ducking tab
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /🎙️ Audio & Ducking/i }));
    });
    expect(screen.getByText(/Voice Gain:/i)).toBeInTheDocument();
    expect(screen.getByText(/BGM Ducking:/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-attenuates BGM bed volume by/i)).toBeInTheDocument();

    // Switch to Export Master tab
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /⚡ Export Master/i }));
    });
    expect(screen.getByText(/1080p FHD/i)).toBeInTheDocument();
    expect(screen.getByText(/30.00 SMPTE/i)).toBeInTheDocument();
  });

  test('keyboard hotkeys toggle playhead, mark In/Out, and split', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    // Switch to Timeline
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /CapCut Timeline/i }));
    });

    // Space key toggles playback
    const playBtn = screen.getByTitle(/Play \(Space\)/i);
    expect(playBtn).toHaveTextContent('▶');

    await act(async () => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    expect(screen.getByTitle(/Pause \(Space\)/i)).toHaveTextContent('⏸');

    await act(async () => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    expect(screen.getByTitle(/Play \(Space\)/i)).toHaveTextContent('▶');

    // 'i' key marks in-point
    await act(async () => {
      fireEvent.keyDown(window, { key: 'i' });
    });
    expect(screen.getByRole('status')).toHaveTextContent(/In-point marked at/i);

    // 'o' key marks out-point
    await act(async () => {
      fireEvent.keyDown(window, { key: 'o' });
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Out-point marked at/i);

    // 's' key triggers split cut
    await act(async () => {
      fireEvent.keyDown(window, { key: 's' });
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Split cut marker added at/i);
  });
});
