import {
  clampTransitionSec, DEFAULT_TRANSITION_SEC, isShotTransition, MAX_TRANSITION_SEC,
  planTimeline, SHOT_TRANSITIONS,
} from '../../shared/transitions';
import { buildTransitionAudioGraph, buildTransitionVideoGraph, shotWindows } from '../movie/transition-graph';

describe('the timeline a transition produces', () => {
  it('a crossfade overlaps two shots, so the movie is shorter by exactly that much', () => {
    const timeline = planTimeline([
      { durationSec: 4, transition: 'crossfade', transitionSec: 0.5 },
      { durationSec: 3, transition: 'crossfade', transitionSec: 0.5 },
      { durationSec: 3 },
    ]);
    expect(timeline.totalSec).toBe(9); // 10 seconds of shots, one second of overlap
    expect(timeline.shots.map(s => s.startSec)).toEqual([0, 3.5, 6]);
    expect(timeline.shots.map(s => s.endSec)).toEqual([4, 6.5, 9]);
    expect(timeline.hasTransition).toBe(true);
  });

  it('cuts only add up, and a board of cuts is the timeline we already had', () => {
    const timeline = planTimeline([{ durationSec: 5 }, { durationSec: 4, transition: 'cut' }, { durationSec: 6 }]);
    expect(timeline.totalSec).toBe(15);
    expect(timeline.shots.map(s => s.startSec)).toEqual([0, 5, 9]);
    expect(timeline.hasTransition).toBe(false);
  });

  it('the last shot cannot transition into anything, and unknown values are cuts', () => {
    const timeline = planTimeline([{ durationSec: 3, transition: 'crossfade' }, { durationSec: 3, transition: 'crossfade' }]);
    expect(timeline.shots[1]!.transition).toBe('cut');
    expect(timeline.shots[1]!.transitionSec).toBe(0);
    expect(planTimeline([{ durationSec: 3, transition: 'wipe' as any }, { durationSec: 3 }]).hasTransition).toBe(false);
    expect(isShotTransition('fade_black')).toBe(true);
    expect(isShotTransition('star_wipe')).toBe(false);
    expect(SHOT_TRANSITIONS).toEqual(['cut', 'crossfade', 'fade_black']);
  });

  it('a transition is capped at half the shorter shot, and a hopeless one becomes a cut', () => {
    expect(clampTransitionSec(0.5, 4, 3)).toBe(0.5);
    expect(clampTransitionSec(2, 4, 2)).toBe(1); // half of the 2s shot
    expect(clampTransitionSec(10, 60, 60)).toBe(MAX_TRANSITION_SEC);
    expect(clampTransitionSec(undefined, 4, 4)).toBe(DEFAULT_TRANSITION_SEC);
    expect(clampTransitionSec(0.5, 0.15, 5)).toBe(0);
    // A 0.1s shot beside a 5s one: no room, so it plays as a cut.
    const timeline = planTimeline([{ durationSec: 0.1, transition: 'crossfade' }, { durationSec: 5 }]);
    expect(timeline.shots[0]!.transition).toBe('cut');
    expect(timeline.totalSec).toBe(5.1);
  });

  it('missing or nonsense durations fall back rather than producing NaN', () => {
    const timeline = planTimeline([{}, { durationSec: -3 }, { durationSec: Number.NaN }]);
    expect(timeline.totalSec).toBe(15);
    expect(timeline.shots.every(shot => Number.isFinite(shot.startSec))).toBe(true);
  });
});

describe('the ffmpeg graph', () => {
  const three = planTimeline([
    { durationSec: 4, transition: 'crossfade', transitionSec: 0.5 },
    { durationSec: 3, transition: 'fade_black', transitionSec: 0.5 },
    { durationSec: 3 },
  ]);

  it('dissolves at the place in the chain where the next shot starts', () => {
    const graph = buildTransitionVideoGraph(three, 30);
    expect(graph.filter).toContain('[0:v]fps=30,format=pix_fmts=yuv420p,setpts=PTS-STARTPTS[c0]');
    expect(graph.filter).toContain('[c0][c1]xfade=transition=fade:duration=0.5:offset=3.5[m1]');
    expect(graph.filter).toContain('[m1][c2]xfade=transition=fadeblack:duration=0.5:offset=6[vout]');
    expect(graph.outLabel).toBe('[vout]');
  });

  it('a cut between two shots concatenates instead of dissolving', () => {
    const graph = buildTransitionVideoGraph(planTimeline([
      { durationSec: 4, transition: 'cut' }, { durationSec: 3, transition: 'crossfade', transitionSec: 1 }, { durationSec: 3 },
    ]), 24);
    expect(graph.filter).toContain('[c0][c1]concat=n=2:v=1:a=0[m1]');
    expect(graph.filter).toContain('[m1][c2]xfade=transition=fade:duration=1:offset=6[vout]');
  });

  it('one shot still produces a usable stream', () => {
    const graph = buildTransitionVideoGraph(planTimeline([{ durationSec: 5 }]), 30);
    expect(graph.filter).toContain('[c0]null[vout]');
    expect(graph.outLabel).toBe('[vout]');
    expect(() => buildTransitionVideoGraph(planTimeline([]), 30)).toThrow(/at least one shot/);
  });

  it('every voice starts where its own shot starts, at full level', () => {
    const graph = buildTransitionAudioGraph(three, 3);
    expect(graph.filter).toContain('[3:a]anull[a0]');
    expect(graph.filter).toContain('[4:a]adelay=3500:all=1[a1]');
    expect(graph.filter).toContain('[5:a]adelay=6000:all=1[a2]');
    // normalize=0: three shots must not make one voice a third as loud.
    expect(graph.filter).toContain('[a0][a1][a2]amix=inputs=3:normalize=0:dropout_transition=0[aout]');
    expect(graph.outLabel).toBe('[aout]');
    expect(buildTransitionAudioGraph(planTimeline([{ durationSec: 4 }]), 1).outLabel).toBe('[a0]');
  });

  it('captions and cards use the same windows as the pictures', () => {
    expect(shotWindows(three)).toEqual([
      { startSec: 0, endSec: 4 },
      { startSec: 3.5, endSec: 6.5 },
      { startSec: 6, endSec: 9 },
    ]);
    // Without transitions the windows are the plain shot boundaries.
    expect(shotWindows(planTimeline([{ durationSec: 2 }, { durationSec: 3 }]))).toEqual([
      { startSec: 0, endSec: 2 },
      { startSec: 2, endSec: 5 },
    ]);
  });
});
