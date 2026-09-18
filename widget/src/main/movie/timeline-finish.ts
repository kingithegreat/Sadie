/**
 * The Timeline inspector, as ffmpeg arguments (MS-6).
 *
 * Colour grade, master volume, mute, clip speed and the transition between
 * segments were preview-only: they changed the player in the panel and nothing
 * in the exported file. This turns each of them into part of the re-render, so
 * a control that looks like it changes the video does change the video.
 *
 * Splicing without any of them stays a stream copy, which is fast and lossless;
 * asking for any of them re-encodes, because there is no way to grade or
 * re-time copied packets.
 */

import { buildColorGradeFilter } from '../media-render';
import { planTimeline, type ShotTransition } from '../../shared/transitions';
import { buildTransitionAudioGraph, buildTransitionVideoGraph } from './transition-graph';

export interface TimelineFinish {
  /** warm_nile | teal_orange | nocturne; anything else is no grade. */
  colorGrade?: string | null;
  /** Master volume as a multiplier: 1 leaves it alone. */
  volume?: number | null;
  /** Silence the export entirely. */
  mute?: boolean;
  /** Playback rate: 2 is twice as fast, 0.5 half. */
  speed?: number | null;
  /** How each segment moves into the next. */
  transition?: ShotTransition | null;
  transitionSec?: number | null;
  /** Segment lengths in order — a transition cannot be placed without them. */
  clipDurations?: number[] | null;
}

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

/** True when the finish actually asks for something. */
export function finishChangesAnything(finish: TimelineFinish | null | undefined): boolean {
  if (!finish) return false;
  const speed = normaliseSpeed(finish.speed);
  return Boolean(
    buildColorGradeFilter(finish.colorGrade ?? null)
    || finish.mute
    || (typeof finish.volume === 'number' && Number.isFinite(finish.volume) && Math.abs(finish.volume - 1) > 0.001)
    || Math.abs(speed - 1) > 0.001
    || (finish.transition && finish.transition !== 'cut' && (finish.clipDurations?.length ?? 0) > 1),
  );
}

function normaliseSpeed(speed: number | null | undefined): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

/**
 * ffmpeg's `atempo` only accepts 0.5–2.0 per instance, so anything outside
 * that is chained: 4x is atempo=2.0,atempo=2.0.
 */
export function atempoChain(speed: number): string[] {
  let remaining = normaliseSpeed(speed);
  const stages: string[] = [];
  while (remaining > 2.0001) { stages.push('atempo=2.0'); remaining /= 2; }
  while (remaining < 0.4999) { stages.push('atempo=0.5'); remaining *= 2; }
  if (Math.abs(remaining - 1) > 0.001) stages.push(`atempo=${round(remaining)}`);
  return stages;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export interface FinishGraph {
  /** The whole -filter_complex value. */
  filter: string;
  videoLabel: string;
  audioLabel: string | null;
  /** Total length of the finished video, for a caller that bounds the output. */
  durationSec: number | null;
}

/**
 * Join `clipCount` inputs and apply the finish. Segments either cut (concat) or
 * dissolve (xfade), and a transition shortens the result, so the duration comes
 * back with the graph rather than being guessed by the caller.
 */
export function buildTimelineFinishGraph(clipCount: number, finish: TimelineFinish): FinishGraph {
  if (clipCount < 1) throw new Error('A finished timeline needs at least one clip.');
  const durations = Array.isArray(finish.clipDurations) ? finish.clipDurations.filter(d => typeof d === 'number' && d > 0) : [];
  const transition = finish.transition && finish.transition !== 'cut' ? finish.transition : 'cut';
  const useTransition = transition !== 'cut' && durations.length === clipCount && clipCount > 1;

  const parts: string[] = [];
  let videoLabel: string;
  let audioLabel: string | null;
  let durationSec: number | null = durations.length === clipCount ? durations.reduce((sum, d) => sum + d, 0) : null;

  // Muting builds no audio branch at all. ffmpeg refuses a filter_complex
  // whose output nothing maps, so producing [ajoined] and then dropping it
  // failed the whole render (caught by the live test, not by reading).
  const wantAudio = !finish.mute;

  if (useTransition) {
    const timeline = planTimeline(durations.map((durationSec, index) => ({
      durationSec,
      transition: index < durations.length - 1 ? transition : 'cut',
      transitionSec: finish.transitionSec ?? undefined,
    })));
    const video = buildTransitionVideoGraph(timeline, 30);
    parts.push(video.filter);
    videoLabel = video.outLabel;
    audioLabel = null;
    if (wantAudio) {
      const audio = buildTransitionAudioGraph(timeline, 0);
      parts.push(audio.filter);
      audioLabel = audio.outLabel;
    }
    durationSec = timeline.totalSec;
  } else if (clipCount === 1) {
    parts.push('[0:v]null[vjoined]');
    videoLabel = '[vjoined]';
    audioLabel = null;
    if (wantAudio) { parts.push('[0:a]anull[ajoined]'); audioLabel = '[ajoined]'; }
  } else {
    const inputs = Array.from({ length: clipCount }, (_, index) => (wantAudio ? `[${index}:v][${index}:a]` : `[${index}:v]`)).join('');
    parts.push(`${inputs}concat=n=${clipCount}:v=1:a=${wantAudio ? 1 : 0}${wantAudio ? '[vjoined][ajoined]' : '[vjoined]'}`);
    videoLabel = '[vjoined]';
    audioLabel = wantAudio ? '[ajoined]' : null;
  }

  const speed = normaliseSpeed(finish.speed);
  const videoChain: string[] = [];
  const grade = buildColorGradeFilter(finish.colorGrade ?? null);
  if (grade) videoChain.push(grade);
  if (Math.abs(speed - 1) > 0.001) videoChain.push(`setpts=${round(1 / speed)}*PTS`);
  videoChain.push('format=yuv420p');
  parts.push(`${videoLabel}${videoChain.join(',')}[vout]`);

  if (!wantAudio || !audioLabel) {
    audioLabel = null;
  } else {
    const audioChain: string[] = [];
    const volume = typeof finish.volume === 'number' && Number.isFinite(finish.volume) ? Math.min(4, Math.max(0, finish.volume)) : 1;
    if (Math.abs(volume - 1) > 0.001) audioChain.push(`volume=${round(volume)}`);
    audioChain.push(...atempoChain(speed));
    // A chain that would do nothing still needs a filter to carry the label.
    if (!audioChain.length) audioChain.push('anull');
    parts.push(`${audioLabel}${audioChain.join(',')}[aout]`);
    audioLabel = '[aout]';
  }

  if (durationSec !== null && Math.abs(speed - 1) > 0.001) durationSec = round(durationSec / speed);
  return { filter: parts.filter(Boolean).join(';'), videoLabel: '[vout]', audioLabel, durationSec };
}
