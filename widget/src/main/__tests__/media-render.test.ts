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
