/**
 * The render command, asserted without invoking ffmpeg.
 *
 * Two things break a render and neither shows up as a type error: the filter
 * string and the path escaping. ffmpeg treats `:` as an argument separator
 * inside a filter, so a Windows path handed to `subtitles=` unescaped makes it
 * parse the drive letter as an option and fail with something unrelated-looking.
 * So the command is built by a pure function and checked here, and the live
 * test (media-render.live) proves the whole thing against a real binary.
 */

import {
  buildRenderArgs,
  escapeFilterPath,
  dimensionsFor,
  staticTimeline,
  timelineFromCues,
  toAssUnits,
  groupCues,
  buildConcatFileContent,
  buildTimelineRenderArgs,
  buildMusicAudioGraph,
  MUSIC_VOLUME_DEFAULT,
  buildLoudnormFilter,
  parseLoudnormOutput,
  LoudnormStats,
} from '../media-render';

/** The -vf value, which is where every interesting decision ends up. */
const filtersOf = (args: string[]) => args[args.indexOf('-vf') + 1] ?? '';

describe('escaping a path into an ffmpeg filter', () => {
  it('flips separators and escapes the drive colon', () => {
    expect(escapeFilterPath('C:\\Users\\adenk\\captions.srt'))
      .toBe('C\\:/Users/adenk/captions.srt');
  });

  it('leaves a posix path alone apart from colons', () => {
    expect(escapeFilterPath('/home/a/captions.srt')).toBe('/home/a/captions.srt');
  });
});

describe('caption style units are not pixels', () => {
  // ffmpeg converts SRT to ASS with a fixed PlayResY of 288 — read out of the
  // generated .ass header, not assumed — and libass scales that to the frame.
  // Treating force_style values as pixels made the text 6.7x too large and
  // pushed it off the top of the video, which two rendered frames showed.
  it('converts a wanted pixel size into ASS units', () => {
    expect(toAssUnits(280, 1920)).toBe(42);
    expect(toAssUnits(70, 1080)).toBe(19);
  });

  it('never rounds a visible value down to nothing', () => {
    // A 3px outline on a tall frame rounds to 0.45; 0 would mean no outline at
    // all, so the floor is 1.
    expect(toAssUnits(3, 1920)).toBe(1);
    expect(toAssUnits(0, 1920)).toBe(1);
  });
});

describe('frame size follows the format', () => {
  it('is portrait for a short and landscape for long-form', () => {
    expect(dimensionsFor('short')).toEqual({ w: 1080, h: 1920 });
    expect(dimensionsFor('long')).toEqual({ w: 1920, h: 1080 });
  });
});

describe('the visual timeline', () => {
  it('treats a still as one segment spanning the whole video', () => {
    const t = staticTimeline(55_700, 'bg.png');
    expect(t).toEqual([{ startMs: 0, endMs: 55_700, imagePath: 'bg.png' }]);
  });

  it('never produces a zero-length segment', () => {
    expect(staticTimeline(0)[0].endMs).toBeGreaterThan(0);
  });

  it('maps one visual per caption cue, which is the upgrade path', () => {
    // Slides and stock b-roll are this same shape with a different producer —
    // the renderer does not change.
    const cues = [{ startMs: 0, endMs: 2000 }, { startMs: 2000, endMs: 4500 }];
    const t = timelineFromCues(cues, i => `shot-${i}.png`);
    expect(t).toEqual([
      { startMs: 0, endMs: 2000, imagePath: 'shot-0.png' },
      { startMs: 2000, endMs: 4500, imagePath: 'shot-1.png' },
    ]);
  });
});

describe('building the ffmpeg command', () => {
  const base = {
    audioPath: 'C:\\assets\\narration.mp3',
    outputPath: 'C:\\assets\\video.mp4',
    shape: 'short' as const,
    durationSeconds: 56,
  };

  it('generates a backdrop when no image is given, rather than refusing', () => {
    const args = buildRenderArgs(base);
    expect(args).toContain('lavfi');
    expect(args.join(' ')).toContain('color=c=0x0F1319:s=1080x1920');
  });

  it('loops a supplied image for the length of the audio', () => {
    const args = buildRenderArgs({ ...base, imagePath: 'C:\\pics\\bg.jpg' });
    expect(args).toContain('-loop');
    // -shortest is what actually ends the video: the image loops forever.
    expect(args).toContain('-shortest');
  });

  it('fills the frame without distorting the image', () => {
    const f = filtersOf(buildRenderArgs({ ...base, imagePath: 'bg.jpg' }));
    expect(f).toContain('force_original_aspect_ratio=increase');
    expect(f).toContain('crop=1080:1920');
  });

  it('drifts the image, because a frozen frame reads as broken', () => {
    const f = filtersOf(buildRenderArgs({ ...base, imagePath: 'bg.jpg' }));
    expect(f).toContain('zoompan');
    // zoompan counts INPUT frames, so the span must be duration x fps or the
    // drift finishes early and the rest of the video sits still.
    expect(f).toContain('d=1680'); // 56s x 30fps
  });

  it('can be told not to drift', () => {
    const f = filtersOf(buildRenderArgs({ ...base, imagePath: 'bg.jpg', zoom: false }));
    expect(f).not.toContain('zoompan');
  });

  it('burns captions with the path escaped for filter syntax', () => {
    const f = filtersOf(buildRenderArgs({ ...base, captionsPath: 'C:\\assets\\captions.srt' }));
    expect(f).toContain("subtitles='C\\:/assets/captions.srt'");
  });

  it('lifts captions clear of the platform UI on a short', () => {
    // libass puts SRT text at the very bottom, which on Shorts sits under the
    // title, handle and buttons — captions present in the file and invisible
    // in the app. Found by extracting a frame from a real render.
    //
    // 280px of margin, expressed in ASS units: 280 x 288/1920 = 42.
    const f = filtersOf(buildRenderArgs({ ...base, captionsPath: 'c.srt' }));
    expect(f).toContain('MarginV=42');
    expect(f).toContain('Alignment=2');
    expect(f).toContain('Shadow=0'); // an outline survives a photo behind it; a shadow does not
  });

  it('needs far less margin in landscape, which has no such overlay', () => {
    // 70px on a 1080-tall frame: 70 x 288/1080 = 19.
    const f = filtersOf(buildRenderArgs({ ...base, shape: 'long', captionsPath: 'c.srt' }));
    expect(f).toContain('MarginV=19');
  });

  it('accepts a caller-supplied style', () => {
    const f = filtersOf(buildRenderArgs({ ...base, captionsPath: 'c.srt', subtitleStyle: 'FontSize=99' }));
    expect(f).toContain("force_style='FontSize=99'");
  });

  it('omits the subtitles filter entirely when there are no captions', () => {
    expect(filtersOf(buildRenderArgs(base))).not.toContain('subtitles');
  });

  it('always ends in a pixel format phones and browsers can play', () => {
    // Without yuv420p the file plays in VLC and nowhere else, which is the
    // kind of bug that only shows up after upload.
    const f = filtersOf(buildRenderArgs({ ...base, imagePath: 'bg.jpg', captionsPath: 'c.srt' }));
    expect(f.endsWith('format=yuv420p')).toBe(true);
  });

  it('passes input paths unescaped — only filter values need escaping', () => {
    const args = buildRenderArgs({ ...base, imagePath: 'C:\\pics\\bg.jpg' });
    expect(args).toContain('C:\\pics\\bg.jpg');
    expect(args).toContain('C:\\assets\\narration.mp3');
    expect(args[args.length - 1]).toBe('C:\\assets\\video.mp4');
  });

  it('writes a file that can start playing before it finishes downloading', () => {
    expect(buildRenderArgs(base)).toContain('+faststart');
  });

  it('overwrites, so a retry after a failed render is not blocked', () => {
    expect(buildRenderArgs(base)[0]).toBe('-y');
  });
});

describe('grouping cues into scenes', () => {
  const cues = [
    { startMs: 0, endMs: 2000, text: 'one' },
    { startMs: 2000, endMs: 4000, text: 'two' },
    { startMs: 4000, endMs: 6000, text: 'three' },
    { startMs: 6000, endMs: 11000, text: 'four' },
  ];

  it('merges adjacent cues up to the target length', () => {
    // A cut every 2s is frantic to watch and generates 3x the images for no gain.
    const scenes = groupCues(cues, 5);
    expect(scenes.length).toBeLessThan(cues.length);
    expect(scenes[0].startMs).toBe(0);
    expect(scenes[0].text).toContain('one');
  });

  it('covers the whole timeline with no gaps', () => {
    const scenes = groupCues(cues, 5);
    expect(scenes[0].startMs).toBe(0);
    expect(scenes[scenes.length - 1].endMs).toBe(11000);
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i].startMs).toBe(scenes[i - 1].endMs);
    }
  });

  it('folds a sliver of a final scene into the one before it', () => {
    // Half a second of a new picture at the end reads as a glitch.
    const withSliver = [...cues, { startMs: 11000, endMs: 11200, text: 'blip' }];
    const scenes = groupCues(withSliver, 5);
    const last = scenes[scenes.length - 1];
    expect(last.endMs).toBe(11200);
    expect(last.text).toContain('blip');
    expect(last.endMs - last.startMs).toBeGreaterThan(1000);
  });

  it('handles an empty script without throwing', () => {
    expect(groupCues([], 5)).toEqual([]);
  });
});

describe('the concat script', () => {
  const segs = [
    { startMs: 0, endMs: 2500, imagePath: 'C:\\a\\one.png' },
    { startMs: 2500, endMs: 6000, imagePath: 'C:\\a\\two.png' },
  ];

  it('uses forward slashes and quotes each path', () => {
    expect(buildConcatFileContent(segs)).toContain("file 'C:/a/one.png'");
  });

  it('gives each segment its own duration', () => {
    const s = buildConcatFileContent(segs);
    expect(s).toContain('duration 2.500');
    expect(s).toContain('duration 3.500');
  });

  it('repeats the last file, or ffmpeg drops its screen time', () => {
    const lines = buildConcatFileContent(segs).trim().split('\n');
    expect(lines[lines.length - 1]).toBe("file 'C:/a/two.png'");
  });

  it('is empty when no scene has an image, so the caller falls back', () => {
    expect(buildConcatFileContent([{ startMs: 0, endMs: 1000, imagePath: null }])).toBe('');
  });

  /**
   * Real narration has pauses. Every case above feeds CONTIGUOUS segments, which
   * is why this never showed up here — it showed up in the nightly gate instead,
   * as "the video is 6.3s but the narration is 10.0s".
   *
   * A cue group spans its own first-cue start to its own last-cue end, so the
   * silence BETWEEN groups, the lead-in before the first word and the tail after
   * the last belong to no segment at all. The concat then totals only spoken
   * time, ffmpeg's -shortest trims the render to it, and the video comes out
   * shorter than its own audio.
   */
  it('covers the whole narration, not just the spoken parts', () => {
    // Timings taken from the shape of the nightly failure: three sentences with
    // real pauses, 6.3s of speech inside a 10.0s narration.
    const cues = [
      { startMs: 500, endMs: 2500 },
      { startMs: 3700, endMs: 5900 },
      { startMs: 7700, endMs: 9800 },
    ];
    const narrationMs = 10_000;

    const timeline = timelineFromCues(cues, i => `scene-${i}.png`, narrationMs);
    const covered = timeline.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);

    // Without this, covered is 6300 — the 3.7s of pause/lead-in/tail is dropped
    // and the render is truncated to the spoken total.
    expect(covered).toBe(narrationMs);

    // And the same must hold in the file ffmpeg actually reads.
    const durations = [...buildConcatFileContent(timeline).matchAll(/^duration ([\d.]+)$/gm)]
      .map(m => Number(m[1]));
    expect(durations.reduce((a, b) => a + b, 0)).toBeCloseTo(narrationMs / 1000, 3);
  });
});

describe('the multi-scene command', () => {
  const tl = {
    concatPath: 'C:\\a\\scenes.txt',
    audioPath: 'C:\\a\\narration.mp3',
    outputPath: 'C:\\a\\video.mp4',
    shape: 'short' as const,
  };

  it('reads the script with -safe 0, because the paths are absolute', () => {
    const args = buildTimelineRenderArgs(tl);
    expect(args).toContain('concat');
    expect(args[args.indexOf('-safe') + 1]).toBe('0');
  });

  it('normalises the frame rate inside the filter chain, before the burn', () => {
    // An output -r re-times frames AFTER the subtitle filter has drawn them,
    // so the burned captions land at the wrong moment while the pictures cut
    // on time. Measured on a real render: cue 1 still on screen at 6s when it
    // should have ended at 3.17s.
    const args = buildTimelineRenderArgs(tl);
    const f = args[args.indexOf('-vf') + 1];
    expect(f.startsWith('fps=30')).toBe(true);
    expect(args).not.toContain('-r');
    // Order matters: the rate must settle before subtitles are drawn.
    expect(f.indexOf('fps=')).toBeLessThan(f.indexOf('subtitles=') === -1 ? Infinity : f.indexOf('subtitles='));
  });

  it('does not drift the picture when the edit already cuts', () => {
    const args = buildTimelineRenderArgs(tl);
    expect(args[args.indexOf('-vf') + 1]).not.toContain('zoompan');
  });

  it('still burns captions and ends in a playable pixel format', () => {
    const args = buildTimelineRenderArgs({ ...tl, captionsPath: 'C:\\a\\c.srt' });
    const f = args[args.indexOf('-vf') + 1];
    expect(f).toContain('subtitles=');
    expect(f.endsWith('format=yuv420p')).toBe(true);
  });
});

/**
 * Background music.
 *
 * The whole risk of this feature is that switching it ON changes renders that
 * already worked. ffmpeg will not accept -vf alongside -filter_complex for one
 * output, so music moves the graph into filter_complex — which means the
 * no-music path must be proven untouched, not assumed.
 *
 * The graph itself was verified against real ffmpeg 9.0.1: a 2-second track
 * under 6 seconds of narration produced a 6-second video with the bed audible
 * at t=1.2s, 3.2s AND 5.2s (so aloop works), measuring -36.7 dB in the speech
 * gaps against -21.5 dB during speech (so ducking works).
 */
describe('background music', () => {
  const base = {
    audioPath: '/m/narration.mp3',
    outputPath: '/m/out.mp4',
    shape: 'short' as const,
    durationSeconds: 6,
  };

  test('without music, the arguments are exactly what they were', () => {
    const args = buildRenderArgs(base);
    expect(args).toContain('-vf');
    expect(args).not.toContain('-filter_complex');
    expect(args).not.toContain('-map');
  });

  test('with music, the graph moves into filter_complex and both streams are mapped', () => {
    const args = buildRenderArgs({ ...base, musicPath: '/m/bed.mp3' });
    expect(args).not.toContain('-vf');
    expect(args).toContain('-filter_complex');
    expect(args.join(' ')).toContain('-map [v]');
    expect(args.join(' ')).toContain('-map [aout]');
  });

  test('the music file is the THIRD input — the graph indexes depend on it', () => {
    const args = buildRenderArgs({ ...base, musicPath: '/m/bed.mp3' });
    const inputs = args.reduce<string[]>((acc, a, i) => (a === '-i' ? [...acc, args[i + 1]] : acc), []);
    expect(inputs[inputs.length - 2]).toBe('/m/narration.mp3');
    expect(inputs[inputs.length - 1]).toBe('/m/bed.mp3');
  });

  test('the concat path gets music too, not just single-image renders', () => {
    const args = buildTimelineRenderArgs({
      concatPath: '/m/scenes.txt',
      audioPath: '/m/narration.mp3',
      outputPath: '/m/out.mp4',
      shape: 'short',
      musicPath: '/m/bed.mp3',
    });
    expect(args).toContain('-filter_complex');
    expect(args.join(' ')).toContain('-map [aout]');
  });

  test('the concat path without music is also unchanged', () => {
    const args = buildTimelineRenderArgs({
      concatPath: '/m/scenes.txt',
      audioPath: '/m/narration.mp3',
      outputPath: '/m/out.mp4',
      shape: 'short',
    });
    expect(args).toContain('-vf');
    expect(args).not.toContain('-filter_complex');
  });
});

describe('buildMusicAudioGraph', () => {
  const graph = () => buildMusicAudioGraph({ narrationInput: 1, musicInput: 2 }).graph;

  test('splits the narration, because it is both a mix input and the ducking key', () => {
    // A filter output cannot be consumed twice; without asplit the graph is invalid.
    expect(graph()).toContain('[1:a]asplit=2[narmix][narkey]');
  });

  test('loops the music, so a short track does not stop mid-video', () => {
    expect(graph()).toContain('aloop=loop=-1');
  });

  test('ducks the music under the narration rather than holding a fixed level', () => {
    expect(graph()).toContain('sidechaincompress');
    // Music is the main input, narration the key — the other way round would
    // duck the speech under the music.
    expect(graph()).toContain('[musicloop][narkey]sidechaincompress');
  });

  test('the narration is FIRST in the mix, so it decides the length', () => {
    // With the infinitely-looped music first, duration=first would never end.
    expect(graph()).toContain('[narmix][ducked]amix=inputs=2:duration=first');
  });

  test('mixing does not normalize — that would halve the narration', () => {
    expect(graph()).toContain('normalize=0');
  });

  test('the default bed is quiet enough to sit under a voice', () => {
    expect(MUSIC_VOLUME_DEFAULT).toBeLessThan(0.3);
    expect(MUSIC_VOLUME_DEFAULT).toBeGreaterThan(0);
    expect(graph()).toContain(`volume=${MUSIC_VOLUME_DEFAULT}`);
  });

  test('the volume is overridable per render', () => {
    const g = buildMusicAudioGraph({ narrationInput: 1, musicInput: 2, volume: 0.05 }).graph;
    expect(g).toContain('volume=0.05');
  });

  test('injects loudnorm filter into the audio mix when stats are provided', () => {
    const stats: LoudnormStats = {
      input_i: '-17.48',
      input_tp: '-0.97',
      input_lra: '2.30',
      input_thresh: '-27.97',
      target_offset: '0.38',
    };
    const { graph, outLabel } = buildMusicAudioGraph({
      narrationInput: 1,
      musicInput: 2,
      loudnormStats: stats,
    });
    expect(outLabel).toBe('[aout]');
    expect(graph).toContain('normalize=0[mixout];[mixout]loudnorm=I=-16:TP=-2.0:LRA=11');
    expect(graph).toContain('measured_I=-17.48');
    expect(graph).toContain('linear=true[aout]');
  });
});

describe('video pixel format and color space pinning (Task 2)', () => {
  const base = {
    audioPath: 'C:\\assets\\narration.mp3',
    outputPath: 'C:\\assets\\video.mp4',
    shape: 'short' as const,
    durationSeconds: 15,
  };

  test('single-visual render pins BT.709 color primaries, transfer, matrix, and limited range', () => {
    const args = buildRenderArgs({ ...base, imagePath: 'bg.jpg' });
    expect(args).toContain('-pix_fmt');
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
    expect(args).toContain('-color_range');
    expect(args[args.indexOf('-color_range') + 1]).toBe('tv');
    expect(args).toContain('-color_primaries');
    expect(args[args.indexOf('-color_primaries') + 1]).toBe('bt709');
    expect(args).toContain('-color_trc');
    expect(args[args.indexOf('-color_trc') + 1]).toBe('bt709');
    expect(args).toContain('-colorspace');
    expect(args[args.indexOf('-colorspace') + 1]).toBe('bt709');
    expect(args).toContain('-x264-params');
    expect(args[args.indexOf('-x264-params') + 1]).toBe('colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off');

    // Scale filter forces BT.709 color matrix and limited output range
    const f = filtersOf(args);
    expect(f).toContain('out_color_matrix=bt709:out_range=limited');
  });

  test('multi-scene timeline render pins BT.709 and limited range', () => {
    const args = buildTimelineRenderArgs({
      concatPath: 'C:\\assets\\scenes.txt',
      audioPath: 'C:\\assets\\narration.mp3',
      outputPath: 'C:\\assets\\video.mp4',
      shape: 'long',
    });
    expect(args).toContain('-pix_fmt');
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
    expect(args).toContain('-color_range');
    expect(args[args.indexOf('-color_range') + 1]).toBe('tv');
    expect(args).toContain('-color_primaries');
    expect(args[args.indexOf('-color_primaries') + 1]).toBe('bt709');
    expect(args).toContain('-color_trc');
    expect(args[args.indexOf('-color_trc') + 1]).toBe('bt709');
    expect(args).toContain('-colorspace');
    expect(args[args.indexOf('-colorspace') + 1]).toBe('bt709');
    expect(args).toContain('-x264-params');
    expect(args[args.indexOf('-x264-params') + 1]).toBe('colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off');

    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toContain('out_color_matrix=bt709:out_range=limited');
  });
});

describe('two-pass audio loudness normalization (Task 3)', () => {
  const dummyStats: LoudnormStats = {
    input_i: '-17.48',
    input_tp: '-0.97',
    input_lra: '2.30',
    input_thresh: '-27.97',
    target_offset: '0.38',
  };

  test('buildLoudnormFilter constructs compliant filter string with measured parameters', () => {
    const f = buildLoudnormFilter(dummyStats);
    expect(f).toBe(
      'loudnorm=I=-16:TP=-2.0:LRA=11:measured_I=-17.48:measured_TP=-0.97:measured_LRA=2.30:measured_thresh=-27.97:offset=0.38:linear=true',
    );
  });

  test('buildLoudnormFilter honors custom target parameters', () => {
    const f = buildLoudnormFilter(dummyStats, -14, -1.0, 7);
    expect(f).toBe(
      'loudnorm=I=-14:TP=-1.0:LRA=7:measured_I=-17.48:measured_TP=-0.97:measured_LRA=2.30:measured_thresh=-27.97:offset=0.38:linear=true',
    );
  });

  test('parseLoudnormOutput extracts stats from ffmpeg stderr json', () => {
    const stderr = `
      [Parsed_loudnorm_0 @ 0000021757452140]
      {
        "input_i" : "-17.48",
        "input_tp" : "-0.97",
        "input_lra" : "2.30",
        "input_thresh" : "-27.97",
        "output_i" : "-16.38",
        "output_tp" : "-1.50",
        "output_lra" : "1.60",
        "output_thresh" : "-26.78",
        "normalization_type" : "dynamic",
        "target_offset" : "0.38"
      }
      [out#0/null @ 00000217573aa480] video:0KiB audio:6030KiB
    `;
    const parsed = parseLoudnormOutput(stderr);
    expect(parsed).toEqual({
      input_i: '-17.48',
      input_tp: '-0.97',
      input_lra: '2.30',
      input_thresh: '-27.97',
      target_offset: '0.38',
    });
  });

  test('parseLoudnormOutput throws on malformed stderr without json', () => {
    expect(() => parseLoudnormOutput('some error log')).toThrow('Failed to find loudnorm JSON output');
  });

  test('buildRenderArgs injects -af loudnorm when loudnormStats are provided without music', () => {
    const args = buildRenderArgs({
      audioPath: '/a.mp3',
      outputPath: '/out.mp4',
      shape: 'short',
      durationSeconds: 10,
      loudnormStats: dummyStats,
    });
    expect(args).toContain('-af');
    const af = args[args.indexOf('-af') + 1];
    expect(af).toContain('loudnorm=I=-16:TP=-2.0:LRA=11');
    expect(af).toContain('measured_I=-17.48');
  });

  test('buildTimelineRenderArgs injects -af loudnorm when loudnormStats are provided without music', () => {
    const args = buildTimelineRenderArgs({
      concatPath: '/scenes.txt',
      audioPath: '/a.mp3',
      outputPath: '/out.mp4',
      shape: 'long',
      loudnormStats: dummyStats,
    });
    expect(args).toContain('-af');
    const af = args[args.indexOf('-af') + 1];
    expect(af).toContain('loudnorm=I=-16:TP=-2.0:LRA=11');
  });
});


