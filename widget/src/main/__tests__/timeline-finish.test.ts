import {
  atempoChain, buildTimelineFinishGraph, finishChangesAnything, MAX_SPEED, MIN_SPEED,
} from '../movie/timeline-finish';
import { buildColorGradeFilter } from '../media-render';

describe('what the Timeline inspector asks for', () => {
  it('an untouched inspector asks for nothing, so the splice stays a stream copy', () => {
    expect(finishChangesAnything(null)).toBe(false);
    expect(finishChangesAnything({})).toBe(false);
    expect(finishChangesAnything({ colorGrade: 'rec709', volume: 1, speed: 1, mute: false, transition: 'cut' })).toBe(false);
    // A transition with no segment lengths cannot be placed, so it is not a change.
    expect(finishChangesAnything({ transition: 'crossfade' })).toBe(false);
  });

  it('each control on its own counts as a change', () => {
    expect(finishChangesAnything({ colorGrade: 'warm_nile' })).toBe(true);
    expect(finishChangesAnything({ volume: 0.5 })).toBe(true);
    expect(finishChangesAnything({ mute: true })).toBe(true);
    expect(finishChangesAnything({ speed: 2 })).toBe(true);
    expect(finishChangesAnything({ transition: 'crossfade', clipDurations: [3, 3] })).toBe(true);
  });
});

describe('the finishing graph', () => {
  it('joins segments and applies the grade, ending in one video label', () => {
    const graph = buildTimelineFinishGraph(3, { colorGrade: 'warm_nile' });
    expect(graph.filter).toContain('[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[vjoined][ajoined]');
    // The same grade the storyboard render uses, not a second copy of it.
    expect(graph.filter).toContain(`[vjoined]${buildColorGradeFilter('warm_nile')}`);
    expect(graph.videoLabel).toBe('[vout]');
    expect(graph.audioLabel).toBe('[aout]');
  });

  it('mute drops the audio track rather than turning it down', () => {
    const graph = buildTimelineFinishGraph(2, { mute: true, volume: 0.5 });
    expect(graph.audioLabel).toBeNull();
    expect(graph.filter).not.toContain('volume=');
  });

  it('volume and speed reach both streams, and the length changes with the speed', () => {
    const graph = buildTimelineFinishGraph(2, { volume: 0.4, speed: 2, clipDurations: [4, 6] });
    expect(graph.filter).toContain('setpts=0.5*PTS');
    expect(graph.filter).toContain('volume=0.4');
    expect(graph.filter).toContain('atempo=2');
    expect(graph.durationSec).toBe(5); // ten seconds at double speed
  });

  it('atempo is chained, because one instance only spans 0.5 to 2', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(2)).toEqual(['atempo=2']);
    expect(atempoChain(4)).toEqual(['atempo=2.0', 'atempo=2']);
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(atempoChain(3)).toEqual(['atempo=2.0', 'atempo=1.5']);
    // Out-of-range speeds are clamped, never passed through as nonsense.
    expect(atempoChain(99)).toEqual(atempoChain(MAX_SPEED));
    expect(atempoChain(0.01)).toEqual(atempoChain(MIN_SPEED));
  });

  it('a crossfade dissolves the segments and shortens the result', () => {
    const graph = buildTimelineFinishGraph(2, { transition: 'crossfade', transitionSec: 0.5, clipDurations: [3, 3] });
    expect(graph.filter).toContain('xfade=transition=fade:duration=0.5:offset=2.5');
    expect(graph.durationSec).toBe(5.5);
    expect(graph.filter).toContain('adelay=2500:all=1');

    const black = buildTimelineFinishGraph(2, { transition: 'fade_black', transitionSec: 1, clipDurations: [4, 4] });
    expect(black.filter).toContain('xfade=transition=fadeblack:duration=1:offset=3');
  });

  it('a transition without matching segment lengths falls back to joining them', () => {
    const graph = buildTimelineFinishGraph(3, { transition: 'crossfade', clipDurations: [3, 3] });
    expect(graph.filter).toContain('concat=n=3');
    expect(graph.filter).not.toContain('xfade');
  });

  it('one clip still produces a usable graph, and zero clips is refused', () => {
    const graph = buildTimelineFinishGraph(1, { colorGrade: 'nocturne' });
    expect(graph.filter).toContain('[0:v]null[vjoined]');
    expect(graph.audioLabel).toBe('[aout]');
    expect(() => buildTimelineFinishGraph(0, { mute: true })).toThrow(/at least one clip/);
  });
});
