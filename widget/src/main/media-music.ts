/**
 * Background music, from a folder you control.
 *
 * No account, no API, no rate limit, no licence question: the tracks are yours
 * and they are already on the disk. Pixabay's API can be added later as an
 * optional search, but its terms say the API is "to let people search images —
 * and not for automated requests", which a pipeline that grabs a track per
 * render does not obviously satisfy. A folder sidesteps that entirely.
 *
 * Pure except for the directory read, so the selection rules are testable.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Containers ffmpeg will decode without extra work. */
export const MUSIC_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac'] as const;

export interface MusicChoice {
  /** Absolute path to the chosen track, or null when there is nothing to use. */
  path: string | null;
  /** Why there is no track, in words a non-technical reader can act on. */
  reason?: string;
  /** How many candidates the folder held, for the render note. */
  available: number;
}

export function isMusicFile(file: string): boolean {
  return (MUSIC_EXTENSIONS as readonly string[]).includes(path.extname(file).toLowerCase());
}

/**
 * Every usable track in a folder, sorted by name.
 *
 * Sorted rather than left in readdir order because the pick below is derived
 * from a seed, and a stable order is what makes the same video choose the same
 * track on a re-render. Directory order is not guaranteed to be stable across
 * machines or filesystems.
 *
 * Not recursive: a folder of music is a folder of music. Recursing would make
 * "why did it use that?" harder to answer, and sweep up anything the user
 * happened to store below it.
 */
export function listMusicTracks(dir: string): string[] {
  if (!dir || !fs.existsSync(dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];   // unreadable folder is the same outcome as an empty one
  }
  return entries
    .filter(e => e.isFile() && isMusicFile(e.name))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map(name => path.join(dir, name));
}

/**
 * Choose one track for a video.
 *
 * Deterministic in the seed, matching how scene images already work: the same
 * video re-rendered gets the same track, so a re-render is a re-render rather
 * than a different video. Different videos spread across the folder instead of
 * everything opening on whatever sorts first.
 */
export function pickTrack(tracks: string[], seed: number): string | null {
  if (tracks.length === 0) return null;
  const index = Math.abs(Math.trunc(seed)) % tracks.length;
  return tracks[index];
}

/**
 * The whole decision, with a reason when the answer is "no music".
 *
 * A silent video is a legitimate outcome and must never fail a render — the
 * point of the note is that the user can tell "I chose no music" apart from
 * "it tried and quietly gave up", which is the failure mode this codebase
 * keeps producing.
 */
export function chooseMusic(opts: {
  enabled: boolean;
  folder?: string | null;
  seed: number;
}): MusicChoice {
  if (!opts.enabled) return { path: null, available: 0 };

  const folder = (opts.folder || '').trim();
  if (!folder) {
    return { path: null, available: 0, reason: 'no music folder is set in Settings' };
  }
  if (!fs.existsSync(folder)) {
    return { path: null, available: 0, reason: `the music folder was not found: ${folder}` };
  }

  const tracks = listMusicTracks(folder);
  if (tracks.length === 0) {
    return {
      path: null,
      available: 0,
      reason: `no music files in ${folder} (looked for ${MUSIC_EXTENSIONS.join(', ')})`,
    };
  }

  return { path: pickTrack(tracks, opts.seed), available: tracks.length };
}
