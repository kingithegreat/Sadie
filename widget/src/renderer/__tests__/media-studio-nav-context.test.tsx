/** @jest-environment jsdom */
/**
 * media-studio-nav-context.test.tsx
 * Verifies that MediaStudioPanel accepts and consumes navContext payloads,
 * completing Track I (Chat as the front door to everything).
 */

import { render, screen, act } from '@testing-library/react';
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
    emoji: '🏺',
    summary: 'Pharaoh Khufu commissions the Great Pyramid.',
  },
  {
    id: 'babylon',
    code: 'EP06',
    season: 2,
    title: "Babylon: The Ishtar Gate & the World's Oldest Law",
    era: '575 BCE (Neo-Babylonian Empire)',
    mainCharacter: 'King Nebuchadnezzar II',
    sceneCount: 14,
    emoji: '🦁',
    summary: 'The great city of Babylon rises.',
  },
];

const MOCK_JOBS = [
  {
    id: 'j-target',
    title: 'Target Video Job',
    format: 'short',
    state: 'idea',
  },
  {
    id: 'j-other',
    title: 'Other Video Job',
    format: 'long',
    state: 'idea',
  },
];

function setupElectron(overrides: Record<string, any> = {}) {
  const mediaList = jest.fn().mockResolvedValue(MOCK_JOBS);
  const mediaFfmpegStatus = jest.fn().mockResolvedValue({ ready: true, supported: true });
  const mediaAncientPathwaysEpisodes = jest.fn().mockResolvedValue({
    ok: true,
    episodes: MOCK_EPISODES,
    available: true,
  });
  const mediaAncientPathwaysStatus = jest.fn().mockResolvedValue({
    ok: true,
    available: true,
    dir: '/mock/path/Ancient Pathways',
  });
  const mediaParseFeed = jest.fn().mockResolvedValue({
    ok: true,
    feed: {
      showTitle: 'History Daily',
      showDescription: 'Daily history stories',
      episodes: [
        { title: 'The Fall of Rome', publishedAt: '2026-01-01', description: 'Rome falls.' },
      ],
    },
  });
  const loadConversations = jest.fn().mockResolvedValue({
    success: true,
    data: {
      conversations: [
        {
          id: 'c1',
          messages: [
            { id: 'm1', role: 'user', content: 'Tell me about the Roman Empire and Julius Caesar' },
          ],
        },
      ],
    },
  });

  (window as any).electron = {
    mediaList,
    mediaFfmpegStatus,
    mediaAncientPathwaysEpisodes,
    mediaAncientPathwaysStatus,
    mediaParseFeed,
    loadConversations,
    onMediaFfmpegProgress: jest.fn().mockReturnValue(() => {}),
    onMediaAncientPathwaysProgress: jest.fn().mockReturnValue(() => {}),
    getSettings: jest.fn().mockResolvedValue({}),
    ...overrides,
  };

  return {
    mediaList,
    mediaAncientPathwaysEpisodes,
    mediaParseFeed,
    loadConversations,
  };
}

afterEach(() => {
  delete (window as any).electron;
});

describe('MediaStudioPanel — navContext payload handoff', () => {
  test('pre-populates title and format when navigated from chat topic', async () => {
    setupElectron();

    await act(async () => {
      render(
        <MediaStudioPanel
          navContext={{
            title: 'The Great Fire of London',
            format: 'long',
          }}
        />
      );
    });

    const titleInput = screen.getByLabelText(/new video title/i) as HTMLInputElement;
    expect(titleInput.value).toBe('The Great Fire of London');

    const select = screen.getByLabelText(/video format/i) as HTMLSelectElement;
    expect(select.value).toBe('long');
  });

  test('opens Ancient Pathways drawer and filters by episodeId on handoff', async () => {
    const { mediaAncientPathwaysEpisodes } = setupElectron();

    await act(async () => {
      render(
        <MediaStudioPanel
          navContext={{
            source: 'ancient-pathways',
            episodeId: 'EP06',
          }}
        />
      );
    });

    expect(mediaAncientPathwaysEpisodes).toHaveBeenCalled();
    // EP06 Babylon should be in the document
    expect(screen.getByText(/Babylon: The Ishtar Gate/i)).toBeInTheDocument();
    // Egypt (EP01) should be filtered out by the search filter
    expect(screen.queryByText(/Ancient Egypt: The Secret of the Pyramid Builders/i)).toBeNull();
  });

  test('opens podcast drawer and triggers feed parse when feedUrl is provided', async () => {
    const { mediaParseFeed } = setupElectron();

    await act(async () => {
      render(
        <MediaStudioPanel
          navContext={{
            source: 'podcast',
            feedUrl: 'https://example.com/podcast.rss',
          }}
        />
      );
    });

    expect(mediaParseFeed).toHaveBeenCalledWith('https://example.com/podcast.rss');
    expect(screen.getByLabelText(/Episodes of History Daily/i)).toBeInTheDocument();
    expect(screen.getByText('The Fall of Rome')).toBeInTheDocument();
  });

  test('opens chat ideas drawer when source is chat', async () => {
    const { loadConversations } = setupElectron();

    await act(async () => {
      render(
        <MediaStudioPanel
          navContext={{
            source: 'chat',
          }}
        />
      );
    });

    expect(loadConversations).toHaveBeenCalled();
    expect(screen.getAllByText(/Tell me about the Roman Empire/i)[0]).toBeInTheDocument();
  });

  test('highlights target job when jobId is provided in navContext', async () => {
    setupElectron();
    const scrollMock = jest.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollMock;

    await act(async () => {
      render(
        <MediaStudioPanel
          navContext={{
            jobId: 'j-target',
          }}
        />
      );
    });

    const targetLi = document.querySelector('[data-job-id="j-target"]');
    expect(targetLi).not.toBeNull();
    expect(targetLi?.classList.contains('ms-job--highlighted')).toBe(true);
    expect(scrollMock).toHaveBeenCalled();
  });
});
