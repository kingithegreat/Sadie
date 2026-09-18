/**
 * MS-2 — transitions between shots, and the timeline they produce.
 *
 * A transition OVERLAPS two shots: a 0.5s crossfade between a 4s and a 3s shot
 * makes 6.5 seconds of movie, not 7. Everything timed against the movie has to
 * be computed from that shortened timeline — narration placement, caption cues
 * and title cards — or the words drift away from the pictures shot by shot.
 *
 * The maths lives here, apart from ffmpeg, because it decides four things at
 * once and each of them has to agree with the others.
 */

export const SHOT_TRANSITIONS = ['cut', 'crossfade', 'fade_black'] as const;
export type ShotTransition = (typeof SHOT_TRANSITIONS)[number];

/** Long enough to read as a transition, short enough not to eat a short shot. */
export const DEFAULT_TRANSITION_SEC = 0.5;
export const MIN_TRANSITION_SEC = 0.1;
export const MAX_TRANSITION_SEC = 3;

export interface TransitionInput {
  durationSec?: number;
  /** How this shot moves INTO the next one. The last shot's choice is unused. */
  transition?: string | null;
  transitionSec?: number | null;
}

export interface PlacedShot {
  index: number;
  /** Where this shot starts in the finished movie. */
  startSec: number;
  /** Where it ends, including the part overlapped by the next transition. */
  endSec: number;
  /** The shot's own length, before any overlap. */
  durationSec: number;
  transition: ShotTransition;
  /** Overlap with the NEXT shot; 0 for a cut or the last shot. */
  transitionSec: number;
}

export interface Timeline {
  shots: PlacedShot[];
  totalSec: number;
  hasTransition: boolean;
}

export function isShotTransition(value: unknown): value is ShotTransition {
  return typeof value === 'string' && (SHOT_TRANSITIONS as readonly string[]).includes(value);
}

/**
 * A transition cannot be longer than half of either shot it joins, or the two
 * would still be dissolving when the next one starts and shot timing would be
 * impossible to reason about.
 */
export function clampTransitionSec(requested: number | null | undefined, thisShotSec: number, nextShotSec: number): number {
  const wanted = typeof requested === 'number' && Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_TRANSITION_SEC;
  const room = Math.min(thisShotSec, nextShotSec) / 2;
  const capped = Math.min(Math.max(wanted, MIN_TRANSITION_SEC), MAX_TRANSITION_SEC, room);
  return capped < MIN_TRANSITION_SEC ? 0 : Math.round(capped * 1000) / 1000;
}

/** Where every shot sits once its transitions have overlapped it with the next. */
export function planTimeline(shots: TransitionInput[]): Timeline {
  const durations = shots.map(shot =>
    typeof shot.durationSec === 'number' && Number.isFinite(shot.durationSec) && shot.durationSec > 0 ? shot.durationSec : 5);
  const placed: PlacedShot[] = [];
  let at = 0;
  for (let index = 0; index < shots.length; index++) {
    const durationSec = durations[index]!;
    const last = index === shots.length - 1;
    const requested = isShotTransition(shots[index]!.transition) ? shots[index]!.transition as ShotTransition : 'cut';
    const transition: ShotTransition = last ? 'cut' : requested;
    const transitionSec = transition === 'cut' ? 0
      : clampTransitionSec(shots[index]!.transitionSec, durationSec, durations[index + 1]!);
    // A transition that cannot fit is a cut, not a silent half-transition.
    const effective: ShotTransition = transitionSec === 0 ? 'cut' : transition;
    placed.push({ index, startSec: round(at), endSec: round(at + durationSec), durationSec, transition: effective, transitionSec });
    at += durationSec - transitionSec;
  }
  const totalSec = placed.length ? round(placed[placed.length - 1]!.endSec) : 0;
  return { shots: placed, totalSec, hasTransition: placed.some(shot => shot.transition !== 'cut') };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * ffmpeg's xfade name for a transition, and the offset it starts at within the
 * running chain. `cut` has none: those clips are concatenated.
 */
export const XFADE_NAMES: Record<Exclude<ShotTransition, 'cut'>, string> = {
  crossfade: 'fade',
  fade_black: 'fadeblack',
};
