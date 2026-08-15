/** @jest-environment jsdom */
/**
 * media-studio-feed.test.tsx — the "From a podcast…" source in Media Studio.
 *
 * The contract under test is small but load-bearing: an episode becomes an
 * ORDINARY job through the ordinary create path, with the episode's own notes
 * travelling in the brief as clearly-marked source material. No new pipeline,
 * no way around the approval gate.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

const FEED = {
  showTitle: 'Deep Questions',
  showDescription: 'A show about thinking.',
  episodes: [
    { title: 'Why Attention Matters', summary: 'Guest Dr. Lee explains focus.', published: 'Mon, 11 Aug 2026', duration: '52:10' },
    { title: 'Digital Minimalism', summary: '', published: '', duration: '' },
  ],
};

function setup(overrides: Record<string, any> = {}) {
  const mediaParseFeed = jest.fn().mockResolvedValue({ ok: true, feed: FEED });
  const mediaCreate = jest.fn().mockResolvedValue({ ok: true, job: { id: 'j1' } });
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([]),
    mediaParseFeed,
    mediaCreate,
    ...overrides,
  };
  return { mediaParseFeed, mediaCreate };
}

afterEach(() => { delete (window as any).electron; });

async function openFeedSection() {
  await act(async () => { render(<MediaStudioPanel />); });
  fireEvent.click(screen.getByText('From a podcast…'));
}

describe('Media Studio — from a podcast feed', () => {
  test('is collapsed until asked for, so the ordinary create row stays simple', async () => {
    setup();
    await act(async () => { render(<MediaStudioPanel />); });
    expect(screen.getByText('From a podcast…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Podcast feed link')).toBeNull();
  });

  test('lists episodes after a feed loads', async () => {
    const { mediaParseFeed } = setup();
    await openFeedSection();
    fireEvent.change(screen.getByLabelText('Podcast feed link'), {
      target: { value: 'https://example.com/feed.xml' },
    });
    await act(async () => { fireEvent.click(screen.getByText('Show episodes')); });

    expect(mediaParseFeed).toHaveBeenCalledWith('https://example.com/feed.xml');
    expect(screen.getByText('Why Attention Matters')).toBeInTheDocument();
    expect(screen.getByText('Digital Minimalism')).toBeInTheDocument();
  });

  test('an episode becomes an ordinary short job whose brief carries the notes as source material', async () => {
    const { mediaCreate } = setup();
    await openFeedSection();
    fireEvent.change(screen.getByLabelText('Podcast feed link'), {
      target: { value: 'https://example.com/feed.xml' },
    });
    await act(async () => { fireEvent.click(screen.getByText('Show episodes')); });
    await act(async () => { fireEvent.click(screen.getAllByText('Make a recap')[0]); });

    expect(mediaCreate).toHaveBeenCalledTimes(1);
    const input = mediaCreate.mock.calls[0][0];
    expect(input.title).toBe('Recap: Why Attention Matters');
    // Recaps are the short format by definition — the 60-second premise of the
    // pipeline this was ported from.
    expect(input.format).toBe('short');
    // The safety contract with the script stage: the notes are the source, and
    // the stage is told not to invent beyond them.
    expect(input.brief).toContain('Guest Dr. Lee explains focus.');
    expect(input.brief).toMatch(/ONLY this as source material/);
    expect(input.brief).toContain('Deep Questions');
  });

  test('an episode with no notes constrains the recap instead of inviting recall', async () => {
    const { mediaCreate } = setup();
    await openFeedSection();
    fireEvent.change(screen.getByLabelText('Podcast feed link'), {
      target: { value: 'https://example.com/feed.xml' },
    });
    await act(async () => { fireEvent.click(screen.getByText('Show episodes')); });
    await act(async () => { fireEvent.click(screen.getAllByText('Make a recap')[1]); });

    expect(mediaCreate.mock.calls[0][0].brief).toMatch(/no notes.*title itself/i);
  });

  test('a bad link shows the plain-language reason and creates nothing', async () => {
    const { mediaCreate } = setup({
      mediaParseFeed: jest.fn().mockResolvedValue({
        ok: false,
        error: 'No episodes found at that address. It may be a normal web page rather than a podcast feed.',
      }),
    });
    await openFeedSection();
    fireEvent.change(screen.getByLabelText('Podcast feed link'), {
      target: { value: 'https://example.com/' },
    });
    await act(async () => { fireEvent.click(screen.getByText('Show episodes')); });

    expect(screen.getByText(/normal web page/)).toBeInTheDocument();
    expect(screen.queryByText('Make a recap')).toBeNull();
    expect(mediaCreate).not.toHaveBeenCalled();
  });

  test('closing the section clears it rather than leaving stale results behind', async () => {
    setup();
    await openFeedSection();
    fireEvent.change(screen.getByLabelText('Podcast feed link'), {
      target: { value: 'https://example.com/feed.xml' },
    });
    await act(async () => { fireEvent.click(screen.getByText('Show episodes')); });
    expect(screen.getByText('Why Attention Matters')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close podcast section'));
    expect(screen.queryByText('Why Attention Matters')).toBeNull();
    expect(screen.getByText('From a podcast…')).toBeInTheDocument();
  });
});
