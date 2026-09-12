/**
 * Checking that a render is actually watchable, before a person is asked to
 * approve it.
 *
 * `render_qa` existed as a state from the beginning and did nothing: the job
 * moved into it, moved out of it, and nothing was ever inspected. A stage named
 * QA that inspects nothing is worse than no stage — it reads, to anyone
 * scanning the pipeline, as though the output has been checked.
 *
 * Everything here runs through ffmpeg, which rendering already requires. It
 * deliberately does NOT use ffprobe: that is a second binary, it is not on this
 * machine's PATH, and a check that cannot run is indistinguishable from a check
 * that passed.
 *
 * The parsing and the verdict are pure and tested on captured ffmpeg output;
 * only `inspectRender` touches a process.
 */

import { execFile } from 'child_process';

export interface RenderFacts {
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  /** Mean loudness of the whole audio track, in dBFS. Silence reads about -91. */
  meanVolumeDb: number | null;
  /** Loudest sample, in dBFS. 0 means it hit the ceiling and may be clipping. */
  maxVolumeDb: number | null;
  /**
   * Spatial variation of a handful of sampled frames. Null when there is no
   * video to sample, or duration is too short to sample meaningfully.
   */
  frameSamples: FrameSample[] | null;
}

export interface FrameSample {
  atSeconds: number;
  /** Population standard deviation of the sampled frame's grayscale pixels. */
  stdDev: number;
}

export interface QaVerdict {
  ok: boolean;
  /** Reasons the video must not go to a person for approval. */
  failures: string[];
  /** Worth saying, but not worth blocking on. */
  warnings: string[];
}

/**
 * ffmpeg prints stream and duration lines to stderr, and volumedetect appends
 * its summary there too. One pass gets all of it.
 */
export function parseRenderFacts(stderr: string): RenderFacts {
  const text = stderr || '';

  const videoLine = /Stream #\d+:\d+.*?: Video: .*/.exec(text);
  const audioLine = /Stream #\d+:\d+.*?: Audio: .*/.exec(text);

  // Dimensions: the first NNNxNNN on the video stream line. Guarded to the
  // video line so a thumbnail or cover-art stream cannot supply them.
  let width: number | null = null;
  let height: number | null = null;
  if (videoLine) {
    const dims = /(\d{2,5})x(\d{2,5})/.exec(videoLine[0]);
    if (dims) { width = Number(dims[1]); height = Number(dims[2]); }
  }

  const dur = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  const durationSeconds = dur
    ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
    : null;

  const mean = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(text);
  const max = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(text);

  return {
    hasVideo: !!videoLine,
    hasAudio: !!audioLine,
    width,
    height,
    durationSeconds,
    meanVolumeDb: mean ? Number(mean[1]) : null,
    maxVolumeDb: max ? Number(max[1]) : null,
    // Sampling touches a real process (grabFrame/sampleFrameVariance) and is
    // never derivable from ffmpeg's stderr text alone, so a pure parse of
    // that text can never populate this — only inspectRender does.
    frameSamples: null,
  };
}

/**
 * Below this, the track is silence rather than quiet speech. A digitally
 * silent MP3 measures about -91 dBFS; narration at a sane level sits well
 * above -40, so -50 separates the two without flagging a quiet delivery.
 */
export const SILENCE_FLOOR_DB = -50;

/** How far the finished video may drift from the narration it was built from. */
export const DURATION_TOLERANCE_SECONDS = 2;

/**
 * Below this, a sampled frame's pixels read as a flat color plus compression
 * noise, not real scene art — a solid-color placeholder backdrop measures
 * close to 0. Calibrated against a solid-fill PNG versus a photo, both
 * through the same encoder path (see media-qa.test.ts).
 */
export const FLAT_FRAME_STDDEV = 3;

/**
 * Where to sample, as a fraction of the render's duration. The first and last
 * 5% are excluded so a deliberate fade-to-black at the very start or end is
 * not mistaken for a placeholder that never had real content.
 */
export const FRAME_SAMPLE_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

/** Side of the square a sampled frame is scaled down to before measuring. */
const FRAME_SAMPLE_SIZE = 64;

/**
 * Population standard deviation of raw 8-bit grayscale pixel bytes. A frame
 * of one flat color (plus tiny compression noise) reads near 0; any frame
 * with real picture content — edges, gradients, shapes — reads well above
 * `FLAT_FRAME_STDDEV`.
 */
export function frameStdDev(pixels: Buffer): number {
  if (!pixels.length) return 0;
  let sum = 0;
  for (let i = 0; i < pixels.length; i++) sum += pixels[i];
  const mean = sum / pixels.length;
  let variance = 0;
  for (let i = 0; i < pixels.length; i++) {
    const d = pixels[i] - mean;
    variance += d * d;
  }
  return Math.sqrt(variance / pixels.length);
}

/**
 * Grab one frame at `atSeconds`, scaled to a small grayscale square, as raw
 * 8-bit pixel bytes (`size * size` bytes, no header). Small on purpose: this
 * runs several times per render and only needs to answer "is there a real
 * picture here," not preserve detail.
 */
export function grabFrame(
  ffmpeg: string,
  filePath: string,
  atSeconds: number,
  size = FRAME_SAMPLE_SIZE,
  timeoutMs = 15_000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error',
        '-ss', String(Math.max(0, atSeconds)),
        '-i', filePath,
        '-frames:v', '1',
        '-vf', `scale=${size}:${size}:flags=fast_bilinear,format=gray`,
        '-f', 'rawvideo',
        '-',
      ],
      { timeout: timeoutMs, maxBuffer: size * size * 4, encoding: 'buffer' },
      (err, stdout) => {
        const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '');
        if (buf.length < size * size) {
          reject(err || new Error(`ffmpeg produced no frame at ${atSeconds}s in ${filePath}`));
          return;
        }
        resolve(buf.subarray(0, size * size));
      },
    );
  });
}

/** Sample frames across the render and measure each one's pixel variance. */
export async function sampleFrameVariance(
  ffmpeg: string,
  filePath: string,
  durationSeconds: number,
  size = FRAME_SAMPLE_SIZE,
): Promise<FrameSample[]> {
  const samples: FrameSample[] = [];
  for (const fraction of FRAME_SAMPLE_FRACTIONS) {
    const atSeconds = durationSeconds * fraction;
    const pixels = await grabFrame(ffmpeg, filePath, atSeconds, size);
    samples.push({ atSeconds, stdDev: frameStdDev(pixels) });
  }
  return samples;
}

export interface QaExpectations {
  /** What the shape asked for — a short is 1080x1920. */
  width: number;
  height: number;
  /** Measured from the narration audio, not estimated. Optional: older jobs lack it. */
  narrationSeconds?: number | null;
  /** Whether a music track was mixed in, which changes what a loud mix means. */
  hasMusic?: boolean;
  /**
   * Caption cues the render was expected to burn in. `undefined` means the
   * caller did not check captions — skip the gate entirely, matching every
   * caller that predates this field. `null` (or a zero count) means captions
   * were expected and are missing — a real failure.
   */
  captionCues?: { count: number; lastCueEndSeconds: number } | null;
}

/**
 * Turn measurements into a verdict.
 *
 * Failures are things that make the video not worth a person's time to watch.
 * Warnings are things worth saying while still handing it over — the gate
 * should not refuse to show someone a video over a judgement call.
 */
export function evaluateRenderQa(facts: RenderFacts, expected: QaExpectations): QaVerdict {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!facts.hasVideo) failures.push('the file has no video track');
  if (!facts.hasAudio) failures.push('the file has no audio track — the narration is missing');

  if (facts.hasVideo && facts.width && facts.height) {
    if (facts.width !== expected.width || facts.height !== expected.height) {
      failures.push(
        `the video is ${facts.width}x${facts.height}, but this format needs ${expected.width}x${expected.height}`,
      );
    }
  }

  // Silence is the failure this whole stage exists to catch: a render can
  // succeed, produce a correct-looking file, and contain no sound at all.
  if (facts.hasAudio && facts.meanVolumeDb !== null && facts.meanVolumeDb < SILENCE_FLOOR_DB) {
    failures.push(
      `there is no audible sound (measured ${facts.meanVolumeDb} dB) — the video would play silent`,
    );
  }

  if (facts.durationSeconds !== null && facts.durationSeconds < 1) {
    failures.push(`the video is only ${facts.durationSeconds}s long`);
  }

  if (
    facts.durationSeconds !== null &&
    typeof expected.narrationSeconds === 'number' &&
    expected.narrationSeconds > 0
  ) {
    const drift = Math.abs(facts.durationSeconds - expected.narrationSeconds);
    if (drift > DURATION_TOLERANCE_SECONDS) {
      failures.push(
        `the video is ${facts.durationSeconds.toFixed(1)}s but the narration is ` +
        `${expected.narrationSeconds.toFixed(1)}s — ${drift.toFixed(1)}s of it has no speech`,
      );
    }
  }

  // Clipping: only ever a warning. It is audible but the video is watchable,
  // and refusing to show someone their video over a peak reading would be the
  // gate overreaching.
  if (facts.maxVolumeDb !== null && facts.maxVolumeDb >= 0) {
    warnings.push(
      expected.hasMusic
        ? 'the mix peaks at full scale and may distort — try a quieter music track'
        : 'the narration peaks at full scale and may distort',
    );
  }

  // A render can pass every check above and still be a solid-color
  // placeholder with narration playing over it. Fail only when EVERY sample
  // is flat — one legitimately simple frame among several must not trip this.
  if (facts.hasVideo && facts.frameSamples && facts.frameSamples.length > 0) {
    const maxStdDev = Math.max(...facts.frameSamples.map(s => s.stdDev));
    if (maxStdDev < FLAT_FRAME_STDDEV) {
      failures.push(
        `every sampled frame is a flat color (max variation ${maxStdDev.toFixed(1)}) — ` +
        'this looks like a placeholder backdrop, not real scene art',
      );
    }
  }

  if (expected.captionCues !== undefined) {
    if (!expected.captionCues || expected.captionCues.count === 0) {
      failures.push('there are no captions — the on-screen text is missing');
    } else if (facts.durationSeconds !== null) {
      const drift = Math.abs(facts.durationSeconds - expected.captionCues.lastCueEndSeconds);
      if (drift > DURATION_TOLERANCE_SECONDS) {
        failures.push(
          `captions end at ${expected.captionCues.lastCueEndSeconds.toFixed(1)}s but the video is ` +
          `${facts.durationSeconds.toFixed(1)}s — the captions do not cover the video`,
        );
      }
    }
  }

  return { ok: failures.length === 0, failures, warnings };
}

/** Human-readable one-liner for the render reply and the job history. */
export function describeQa(verdict: QaVerdict): string {
  if (verdict.ok) {
    return verdict.warnings.length
      ? `checks passed, with a note: ${verdict.warnings.join('; ')}`
      : 'checks passed';
  }
  return `checks failed: ${verdict.failures.join('; ')}`;
}

/**
 * Measure a rendered file. Decoding for volumedetect means reading the whole
 * audio track, so this costs real time on a long video — it runs once, after a
 * render that already took minutes.
 */
export async function inspectRender(ffmpeg: string, filePath: string, timeoutMs = 120_000): Promise<RenderFacts> {
  const facts = await new Promise<RenderFacts>((resolve, reject) => {
    execFile(
      ffmpeg,
      ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        const text = String(stderr || '');
        // ffmpeg exits non-zero for "-f null -" on some builds while still
        // having printed everything needed. Trust the output over the code,
        // and only fail when nothing was parseable.
        const parsed = parseRenderFacts(text);
        if (!parsed.hasVideo && !parsed.hasAudio) {
          reject(new Error(err ? `ffmpeg could not read the file: ${text.slice(-400)}` : `nothing readable in ${filePath}`));
          return;
        }
        resolve(parsed);
      },
    );
  });

  // Frame sampling needs a real duration to pick offsets from, and is not
  // meaningful on a clip too short to have a middle. Let a sampling failure
  // propagate rather than swallowing it — the caller's existing fail-closed
  // handling around inspectRender already covers this the same as any other
  // inspection failure.
  if (facts.hasVideo && facts.durationSeconds !== null && facts.durationSeconds > 0.5) {
    facts.frameSamples = await sampleFrameVariance(ffmpeg, filePath, facts.durationSeconds);
  }

  return facts;
}
