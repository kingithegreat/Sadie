/**
 * Background music from a folder the user controls.
 *
 * A folder rather than an API: no account, no rate limit, no licence question,
 * and it works offline. Pixabay's terms say the API is "to let people search
 * images — and not for automated requests", which a pipeline grabbing a track
 * per render does not obviously satisfy; a folder sidesteps that entirely.
 *
 * The selection has to be DETERMINISTIC in the seed, matching how scene images
 * already work: re-rendering the same video must produce the same video, not a
 * different one with different music.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listMusicTracks, pickTrack, chooseMusic, isMusicFile, MUSIC_EXTENSIONS } from '../media-music';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-music-'));
});
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

const write = (name: string) => fs.writeFileSync(path.join(dir, name), 'x');

describe('isMusicFile', () => {
  test.each([...MUSIC_EXTENSIONS])('accepts %s', (ext) => {
    expect(isMusicFile(`track${ext}`)).toBe(true);
  });

  test('is case-insensitive — Windows hands back .MP3', () => {
    expect(isMusicFile('TRACK.MP3')).toBe(true);
  });

  test('rejects things that are not audio', () => {
    for (const f of ['cover.jpg', 'notes.txt', 'video.mp4', 'noext']) {
      expect(isMusicFile(f)).toBe(false);
    }
  });
});

describe('listMusicTracks', () => {
  test('returns only audio files, sorted by name', () => {
    write('b.mp3'); write('a.wav'); write('cover.jpg'); write('readme.txt');
    const tracks = listMusicTracks(dir).map(p => path.basename(p));
    expect(tracks).toEqual(['a.wav', 'b.mp3']);
  });

  test('sorted order is what makes the seeded pick reproducible', () => {
    write('z.mp3'); write('a.mp3'); write('m.mp3');
    // readdir order is not guaranteed stable across machines; sorting is.
    expect(listMusicTracks(dir).map(p => path.basename(p))).toEqual(['a.mp3', 'm.mp3', 'z.mp3']);
  });

  test('a missing folder is empty, not an exception', () => {
    expect(listMusicTracks(path.join(dir, 'nope'))).toEqual([]);
  });

  test('an empty path is empty', () => {
    expect(listMusicTracks('')).toEqual([]);
  });

  test('does not recurse — a folder of music is a folder of music', () => {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'deep.mp3'), 'x');
    write('top.mp3');
    expect(listMusicTracks(dir).map(p => path.basename(p))).toEqual(['top.mp3']);
  });
});

describe('pickTrack', () => {
  const tracks = ['/m/a.mp3', '/m/b.mp3', '/m/c.mp3'];

  test('the same seed always picks the same track', () => {
    expect(pickTrack(tracks, 42)).toBe(pickTrack(tracks, 42));
  });

  test('different seeds spread across the folder', () => {
    const picked = new Set([0, 1, 2, 3, 4, 5].map(s => pickTrack(tracks, s)));
    expect(picked.size).toBe(3);
  });

  test('a negative seed still lands inside the list', () => {
    expect(tracks).toContain(pickTrack(tracks, -7));
  });

  test('an empty folder picks nothing rather than throwing', () => {
    expect(pickTrack([], 1)).toBeNull();
  });
});

describe('chooseMusic', () => {
  test('switched off means no music and no complaint', () => {
    const c = chooseMusic({ enabled: false, folder: dir, seed: 1 });
    expect(c.path).toBeNull();
    expect(c.reason).toBeUndefined();
  });

  test('on, with tracks, returns one and says how many were available', () => {
    write('a.mp3'); write('b.mp3');
    const c = chooseMusic({ enabled: true, folder: dir, seed: 0 });
    expect(c.path).toBe(path.join(dir, 'a.mp3'));
    expect(c.available).toBe(2);
  });

  // Each of these is a reason a user would otherwise get a silent video with no
  // explanation — the failure mode this codebase keeps producing.
  test('on, with no folder set, says so', () => {
    const c = chooseMusic({ enabled: true, folder: '', seed: 1 });
    expect(c.path).toBeNull();
    expect(c.reason).toMatch(/no music folder is set/);
  });

  test('on, with a folder that does not exist, names the folder', () => {
    const missing = path.join(dir, 'gone');
    const c = chooseMusic({ enabled: true, folder: missing, seed: 1 });
    expect(c.reason).toContain(missing);
  });

  test('on, with an empty folder, says what it looked for', () => {
    const c = chooseMusic({ enabled: true, folder: dir, seed: 1 });
    expect(c.reason).toContain(dir);
    expect(c.reason).toContain('.mp3');
  });

  test('a folder of non-audio files reads as empty, not as a track', () => {
    write('cover.jpg'); write('notes.txt');
    const c = chooseMusic({ enabled: true, folder: dir, seed: 1 });
    expect(c.path).toBeNull();
    expect(c.reason).toMatch(/no music files/);
  });
});
