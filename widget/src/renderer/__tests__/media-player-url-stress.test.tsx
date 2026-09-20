/** @jest-environment jsdom */
/**
 * Media player URL + panel wiring stress tests.
 *
 * `toMediaFileUrl` is the single chokepoint that turns a Windows filesystem path into
 * a Chromium-loadable file:/// URL. If it misbehaves, the player silently shows a
 * broken/blank video with no error, because the URL is well-formed enough to load and
 * wrong enough to point at nothing. So the interesting inputs are the hostile ones.
 */

import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MediaStudioPanel, toMediaFileUrl } from '../components/MediaStudioPanel';

describe('toMediaFileUrl — hostile path inputs', () => {
  test.each([
    ['plain Windows drive path', 'C:\\Users\\adenk\\clip.mp4', 'file:///C:/Users/adenk/clip.mp4'],
    ['spaces in a folder name', 'C:\\Users\\My Videos\\clip.mp4', 'file:///C:/Users/My%20Videos/clip.mp4'],
    ['hash would otherwise become a URL fragment', 'C:\\takes#1\\clip.mp4', 'file:///C:/takes%231/clip.mp4'],
    ['question mark would otherwise become a query', 'C:\\what?\\clip.mp4', 'file:///C:/what%3F/clip.mp4'],
    ['already-forward-slashes', 'C:/Users/adenk/clip.mp4', 'file:///C:/Users/adenk/clip.mp4'],
    ['leading slashes are collapsed, not tripled', '/home/adenk/clip.mp4', 'file:///home/adenk/clip.mp4'],
    ['unicode filename survives percent-encoding', 'C:\\видео\\ü clip.mp4', expect.stringContaining('%D0%B2%D0%B8%D0%B4%D0%B5%D0%BE')],
  ])('%s', (_label, input, expected) => {
    expect(toMediaFileUrl(input as string)).toEqual(expected);
  });

  test('an empty path yields an empty URL, never file:///', () => {
    expect(toMediaFileUrl('')).toBe('');
    expect(toMediaFileUrl(null)).toBe('');
    expect(toMediaFileUrl(undefined)).toBe('');
  });

  test('a data: URL passes through untouched', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    expect(toMediaFileUrl(data)).toBe(data);
  });

  test('round-trips back to a path a browser would resolve identically', () => {
    const path = 'C:\\Users\\adenk\\take #2 (final)\\clip.mp4';
    const url = toMediaFileUrl(path);
    expect(() => new URL(url)).not.toThrow();
    const decoded = decodeURIComponent(url.replace('file:///', ''));
    expect(decoded.replace(/\//g, '\\')).toBe(path);
  });
});

describe('Media Studio timeline media wiring', () => {
  beforeEach(() => {
    jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    delete (window as any).electron;
  });

  test('a rendered job assigns an escaped URL to the timeline preview', async () => {
    const nasty = 'C:\\Users\\adenk\\rendered\\take #1 (final)\\pyramids.mp4';
    (window as any).electron = {
      mediaList: jest.fn().mockResolvedValue([
        { id: 'job-1', title: 'Pyramids', state: 'rendered', format: 'short', durationSeconds: 30, renderPath: nasty },
      ]),
      mediaTrimClip: jest.fn().mockResolvedValue({ ok: true, result: { path: '/mock/trimmed.mp4' } }),
    };
    await act(async () => { render(<MediaStudioPanel />); });
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /CapCut Timeline/i })); });

    const video = screen.getByLabelText('Timeline video preview');
    const src = video.getAttribute('src') || '';
    expect(src).toContain('%23');
    expect(src).toContain('%20');
    expect(() => new URL(src)).not.toThrow();
  });
});
