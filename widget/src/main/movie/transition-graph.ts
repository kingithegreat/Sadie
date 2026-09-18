/**
 * The ffmpeg graphs a transition needs (MS-2).
 *
 * Video: `xfade` dissolves the tail of one clip into the head of the next, so
 * the chain is built one boundary at a time and each xfade's `offset` is the
 * place in the RUNNING chain where the next shot starts — not an offset inside
 * its own clip. Get that wrong and every transition after the first drifts.
 *
 * Audio: shot narration cannot simply be concatenated any more, because the
 * pictures now overlap. Each shot's audio is delayed to the same start time its
 * picture has on the finished timeline and the lot is mixed, so a voice still
 * begins exactly when its shot appears.
 *
 * Strings only: every number here is checked by a test rather than by staring
 * at an ffmpeg command line.
 */

import { XFADE_NAMES, type Timeline } from '../../shared/transitions';

export interface VideoGraph {
  /** filter_complex fragments, already joined with ';'. */
  filter: string;
  /** The label carrying the finished video. */
  outLabel: string;
}

/**
 * Chain the shot clips into one stream. Cuts concatenate; crossfades and fades
 * through black dissolve. Inputs are ffmpeg input indexes, in shot order.
 */
export function buildTransitionVideoGraph(timeline: Timeline, fps: number): VideoGraph {
  const shots = timeline.shots;
  if (!shots.length) throw new Error('A movie needs at least one shot.');
  const parts: string[] = [];
  // Every clip is normalised the same way before it meets another clip: xfade
  // refuses inputs whose format, size or frame rate differ.
  shots.forEach((_, index) => parts.push(`[${index}:v]fps=${fps},format=pix_fmts=yuv420p,setpts=PTS-STARTPTS[c${index}]`));

  let current = 'c0';
  for (let index = 1; index < shots.length; index++) {
    const previous = shots[index - 1]!;
    const label = index === shots.length - 1 ? 'vout' : `m${index}`;
    if (previous.transition === 'cut') {
      parts.push(`[${current}][c${index}]concat=n=2:v=1:a=0[${label}]`);
    } else {
      const name = XFADE_NAMES[previous.transition];
      // Where the next shot starts on the finished timeline.
      parts.push(`[${current}][c${index}]xfade=transition=${name}:duration=${previous.transitionSec}:offset=${shots[index]!.startSec}[${label}]`);
    }
    current = label;
  }
  if (shots.length === 1) {
    parts.push('[c0]null[vout]');
    current = 'vout';
  }
  return { filter: parts.join(';'), outLabel: `[${current}]` };
}

export interface AudioGraph {
  filter: string;
  outLabel: string;
}

/**
 * Place each shot's audio where its picture is and mix. `normalize=0` keeps a
 * lone voice at full level — amix otherwise divides by the number of inputs,
 * which would make narration quieter the more shots a movie has.
 */
export function buildTransitionAudioGraph(timeline: Timeline, firstInputIndex: number): AudioGraph {
  const shots = timeline.shots;
  if (!shots.length) throw new Error('A movie needs at least one shot.');
  const parts: string[] = [];
  shots.forEach((shot, index) => {
    const delayMs = Math.round(shot.startSec * 1000);
    const input = firstInputIndex + index;
    parts.push(delayMs > 0
      ? `[${input}:a]adelay=${delayMs}:all=1[a${index}]`
      : `[${input}:a]anull[a${index}]`);
  });
  if (shots.length === 1) return { filter: parts.join(';'), outLabel: '[a0]' };
  const inputs = shots.map((_, index) => `[a${index}]`).join('');
  parts.push(`${inputs}amix=inputs=${shots.length}:normalize=0:dropout_transition=0[aout]`);
  return { filter: parts.join(';'), outLabel: '[aout]' };
}

/** Caption and title-card timing, taken from the same timeline the pictures use. */
export function shotWindows(timeline: Timeline): Array<{ startSec: number; endSec: number }> {
  return timeline.shots.map((shot, index) => ({
    startSec: shot.startSec,
    // A shot's text should be gone by the time its picture has fully dissolved.
    endSec: index === timeline.shots.length - 1 ? shot.endSec : timeline.shots[index + 1]!.startSec + shot.transitionSec,
  }));
}
