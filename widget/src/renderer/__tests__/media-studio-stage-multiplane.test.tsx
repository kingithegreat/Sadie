/** @jest-environment jsdom */
/**
 * media-studio-stage-multiplane.test.tsx — Unit tests for Media Studio Stage Viewport
 * MultiPlaneStage integration, Series Settings plates, CPU RMBG, and live CSS color grading.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaStudioPanel, getLutCssFilter } from '../components/MediaStudioPanel';

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
        projectDir: 'C:/mock/pyramid-builders',
      },
    ],
  });

  const mediaStoryboardGet = jest.fn().mockResolvedValue({
    ok: true,
    result: {
      project: {
        projectId: 'pyramid-builders',
        name: 'Pyramid Builders',
      },
      scenes: [
        {
          sceneId: 'scene_01',
          shots: [
            { shotId: 'shot_1', order: 1, prompt: 'Hero in the desert', framing: 'WIDE' },
          ],
        },
      ],
    },
  });

  const mediaSeriesSettingsList = jest.fn().mockResolvedValue({
    ok: true,
    seriesId: 'ancient-pathways',
    settings: [
      {
        id: 'throne_room',
        seriesId: 'ancient-pathways',
        name: 'Throne Room of Imhotep',
        hasForeground: true,
        lighting: { preset: 'torchlight' },
      },
      {
        id: 'desert_dunes',
        seriesId: 'ancient-pathways',
        name: 'Giza Desert Dunes',
        hasForeground: false,
        lighting: { preset: 'daylight' },
      },
    ],
  });

  const mediaSeriesSettingsGet = jest.fn().mockImplementation(async (_seriesId: string, settingId: string) => {
    if (settingId === 'throne_room') {
      return {
        ok: true,
        bundle: {
          manifest: {
            id: 'throne_room',
            name: 'Throne Room of Imhotep',
            hasForeground: true,
            lighting: { preset: 'torchlight' },
          },
          bgPath: '/mock/series/ancient-pathways/settings/throne_room/bg.png',
          fgPath: '/mock/series/ancient-pathways/settings/throne_room/fg.png',
        },
      };
    }
    return {
      ok: true,
      bundle: {
        manifest: {
          id: 'desert_dunes',
          name: 'Giza Desert Dunes',
          hasForeground: false,
          lighting: { preset: 'daylight' },
        },
        bgPath: '/mock/series/ancient-pathways/settings/desert_dunes/bg.png',
      },
    };
  });

  const mediaSeriesSettingsSegment = jest.fn().mockResolvedValue({
    ok: true,
    fgBase64: 'mock-fg-base64',
    engineUsed: 'cpu-rmbg-v1.4',
  });

  (window as any).electron = {
    mediaList,
    mediaStoryboardList,
    mediaStoryboardGet,
    mediaSeriesSettingsList,
    mediaSeriesSettingsGet,
    mediaSeriesSettingsSegment,
    ...overrides,
  };

  return {
    mediaList,
    mediaStoryboardList,
    mediaStoryboardGet,
    mediaSeriesSettingsList,
    mediaSeriesSettingsGet,
    mediaSeriesSettingsSegment,
  };
}

beforeEach(() => {
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (window as any).electron;
});

describe('Media Studio Stage MultiPlane & Series Settings Integration', () => {
  test('getLutCssFilter generates valid real-time CSS filter strings', () => {
    expect(getLutCssFilter('rec709')).toBe('none');
    expect(getLutCssFilter('warm_nile')).toContain('sepia');
    expect(getLutCssFilter('teal_orange')).toContain('hue-rotate(-10deg)');
    expect(getLutCssFilter('nocturne')).toContain('hue-rotate(180deg)');
  });

  test('switches to Stage Viewport, mounts MultiPlaneStage, and lists settings', async () => {
    const mocks = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    const stageTab = screen.getByRole('tab', { name: /Stage Viewport/i });
    await act(async () => {
      fireEvent.click(stageTab);
    });

    // MultiPlaneStage should mount in viewport
    expect(screen.getByTestId('multi-plane-stage')).toBeInTheDocument();
    expect(screen.getByTestId('stage-background-layer')).toBeInTheDocument();
    expect(screen.getByTestId('stage-character-layer')).toBeInTheDocument();

    // Series settings should be fetched
    expect(mocks.mediaSeriesSettingsList).toHaveBeenCalledWith('ancient-pathways');
  });

  test('selecting a setting plate updates active setting and optical staging telemetry', async () => {
    const mocks = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /Stage Viewport/i }));
    });

    // Select custom setting
    const select = screen.getByLabelText('Active Setting Plate');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'throne_room' } });
    });

    expect(mocks.mediaSeriesSettingsGet).toHaveBeenCalledWith('ancient-pathways', 'throne_room');
    expect(screen.getByText('Optical Staging & Depth Telemetry:')).toBeInTheDocument();
    expect(screen.getByText('Throne Room of Imhotep')).toBeInTheDocument();
    expect(screen.getByText('4 Tiers (BG, Shadow, Sprite, FG Occlusion)')).toBeInTheDocument();
  });

  test('camera motion, framing, and lighting buttons update staging controls', async () => {
    setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /Stage Viewport/i }));
    });

    // Click Slow Pan motion
    const panBtn = screen.getByRole('button', { name: /Slow Pan/i });
    await act(async () => {
      fireEvent.click(panBtn);
    });
    expect(panBtn).toHaveClass('active');

    // Click Ken Burns Zoom
    const zoomBtn = screen.getByRole('button', { name: /Ken Burns Zoom/i });
    await act(async () => {
      fireEvent.click(zoomBtn);
    });
    expect(zoomBtn).toHaveClass('active');

    // Click Torchlit Sanctum lighting
    const torchBtn = screen.getByRole('button', { name: /Torchlit Sanctum/i });
    await act(async () => {
      fireEvent.click(torchBtn);
    });
    expect(torchBtn).toHaveClass('active');
  });

  test('extract foreground via CPU RMBG button calls mediaSeriesSettingsSegment', async () => {
    const mocks = setup();
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /Stage Viewport/i }));
    });

    // Select setting first
    const select = screen.getByLabelText('Active Setting Plate');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'throne_room' } });
    });

    const rmbgBtn = screen.getByRole('button', { name: /CPU RMBG/i });
    await act(async () => {
      fireEvent.click(rmbgBtn);
    });

    expect(mocks.mediaSeriesSettingsSegment).toHaveBeenCalledWith({
      imageBase64: '',
      preferCpu: true,
    });
  });

  test('timeline video applies live CSS color grade filter', async () => {
    setup({
      mediaList: jest.fn().mockResolvedValue([
        {
          id: 'job-1',
          title: 'Secrets of the Pyramids',
          state: 'rendered',
          format: 'short',
          durationSeconds: 30,
          renderPath: '/mock/export/pyramids.mp4',
        },
      ]),
    });
    await act(async () => {
      render(<MediaStudioPanel />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /CapCut Timeline/i }));
    });

    // Switch to transitions tab
    const transTab = screen.getByRole('tab', { name: /Transitions & FX/i });
    await act(async () => {
      fireEvent.click(transTab);
    });

    // Click Warm Nile LUT
    const warmNileBtn = screen.getByRole('button', { name: /Warm Nile/i });
    await act(async () => {
      fireEvent.click(warmNileBtn);
    });

    const video = screen.getByLabelText('Timeline video preview');
    expect(video).toHaveStyle(`filter: ${getLutCssFilter('warm_nile')}`);
  });

  test('rendered storyboard movie banner Review & Publish button navigates to Director console', async () => {
    const mocks = setup();
    const board = (await mocks.mediaStoryboardGet()).result;
    mocks.mediaStoryboardGet.mockResolvedValue({ ok: true, result: {
      ...board, renderedMoviePath: '/mock/exports/pyramid-builders.mp4',
    } });
    (window as any).electron.mediaList.mockResolvedValue([{
      id: 'sb_pyramid-builders', title: 'Pyramid Builders', state: 'awaiting_approval',
      format: 'short', renderPath: '/mock/exports/pyramid-builders.mp4', history: [],
    }]);
    await act(async () => {
      render(
        <MediaStudioPanel
          navContext={{
            workspace: 'storyboard',
            storyboardId: 'pyramid-builders',
            renderedMoviePath: '/mock/exports/pyramid-builders.mp4',
          }}
        />
      );
    });

    // Banner should be visible
    expect(screen.getByText('Saved movie')).toBeInTheDocument();
    const reviewBtn = screen.getByRole('button', { name: /Review & Publish →/i });
    expect(reviewBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(reviewBtn);
    });

    // Should switch to Director workspace
    expect(screen.getByLabelText('Studio Quick Launch')).toBeInTheDocument();
  });
});
