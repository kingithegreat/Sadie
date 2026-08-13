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
