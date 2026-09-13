import { createJob } from '../media-studio';
import { buildRenderArgs, buildTimelineRenderArgs, dimensionsFor } from '../media-render';

const specification = (ratio = '16:9', durationIntent = 'short') => ({
  schemaVersion: 1,
  durationIntent,
  variants: [{
    id: ratio === '16:9' ? 'landscape' : ratio === '9:16' ? 'portrait' : 'square',
    aspectRatio: ratio,
    width: ratio === '16:9' ? 1920 : 1080,
    height: ratio === '9:16' ? 1920 : 1080,
    fps: 30,
    framing: { mode: 'fit', x: 0.5, y: 0.5 },
  }],
});

describe('saved Studio output formats', () => {
  it.each(['short', 'long'])('defaults new %s jobs to landscape without changing duration intent', format => {
    const job = createJob({ title: 'Output contract', format } as any) as any;
    expect(job.format).toBe(format);
    expect(job.outputSpec).toEqual(specification('16:9', format));
  });

  it.each(['short', 'long'])('retains an explicit portrait specification for %s jobs', format => {
    const outputSpec = specification('9:16', format);
    const job = createJob({ title: 'Portrait', format, outputSpec } as any) as any;
    expect(job.outputSpec).toEqual(outputSpec);
    expect(job.outputSpec).not.toBe(outputSpec);
    expect(job.format).toBe(format);
  });

  it.each(['short', 'long'])('persists explicit landscape and portrait choices for %s jobs without making length imply both', format => {
    const outputSpec = { ...specification('16:9', format),
      variants: [specification('16:9', format).variants[0], specification('9:16', format).variants[0]] };
    outputSpec.variants[1].framing = { mode: 'crop', x: 0.25, y: 0.75 };
    const job = createJob({ title: 'Two explicit formats', format, outputSpec } as any) as any;
    expect(job.outputSpec).toEqual(outputSpec);
    expect(job.format).toBe(format);
    outputSpec.variants[1].framing.x = 1;
    expect(job.outputSpec.variants[1].framing.x).toBe(0.25);
    expect((createJob({ title: 'One by default', format } as any) as any).outputSpec.variants).toHaveLength(1);
  });

  it.each([
    ['version', (s: any) => { s.schemaVersion = 2; }],
    ['dimensions', (s: any) => { s.variants[0].width = 8192; }],
    ['ratio', (s: any) => { s.variants[0].aspectRatio = '9:16'; }],
    ['frame rate', (s: any) => { s.variants[0].fps = 120; }],
    ['framing', (s: any) => { s.variants[0].framing.mode = 'stretch'; }],
    ['crop position', (s: any) => { s.variants[0].framing.x = -1; }],
    ['duration intent', (s: any) => { s.durationIntent = 'tiny'; }],
    ['variant identity', (s: any) => { s.variants[0].id = '../another-project'; }],
  ])('rejects unsupported %s before creating a job', (_name, mutate) => {
    const outputSpec = specification();
    (mutate as (s: any) => void)(outputSpec);
    expect(() => createJob({ title: 'Invalid output', outputSpec } as any)).toThrow();
  });

  it('does not silently accept conflicting duration requests', () => {
    expect(() => createJob({ title: 'Conflict', format: 'long', outputSpec: specification() } as any)).toThrow();
  });

  it('keeps the legacy short/long geometry mapping available', () => {
    expect(dimensionsFor('short')).toEqual({ w: 1080, h: 1920 });
    expect(dimensionsFor('long')).toEqual({ w: 1920, h: 1080 });
  });

  it.each([
    ['16:9', 1920, 1080], ['9:16', 1080, 1920], ['1:1', 1080, 1080],
  ])('resolves explicit %s geometry independently of length', (ratio, w, h) => {
    expect(dimensionsFor(ratio as any)).toEqual({ w, h });
  });

  it('carries the saved fit policy and landscape size into the single-image encoder', () => {
    const outputVariant = specification().variants[0];
    const args = buildRenderArgs({
      audioPath: 'speech.wav', imagePath: 'approved.png', outputPath: 'movie.mp4',
      shape: 'short', durationSeconds: 45, zoom: false, outputVariant,
    } as any);
    const filters = args[args.indexOf('-vf') + 1];
    expect(filters).toContain('scale=1920:1080:force_original_aspect_ratio=decrease');
    expect(filters).toContain('pad=1920:1080');
    expect(filters).toContain('setsar=1');
    expect(filters).not.toContain('crop=');
    expect(Number(args[args.indexOf('-t') + 1])).toBeCloseTo(45 + 1 / 30);
  });

  it('carries an explicit portrait crop anchor into the timeline encoder', () => {
    const outputVariant = specification('9:16', 'long').variants[0];
    outputVariant.framing = { mode: 'crop', x: 0.25, y: 0.75 };
    const args = buildTimelineRenderArgs({
      audioPath: 'speech.wav', concatPath: 'scenes.txt', outputPath: 'movie.mp4',
      shape: 'long', outputVariant, durationSeconds: 66.49,
    } as any);
    const filters = args[args.indexOf('-vf') + 1];
    expect(filters).toContain('scale=1080:1920:force_original_aspect_ratio=increase');
    expect(filters).toContain('crop=1080:1920:(iw-ow)*0.25:(ih-oh)*0.75');
    expect(filters).toContain('setsar=1');
    expect(Number(args[args.indexOf('-t') + 1])).toBeCloseTo(66.49 + 1 / 30);
  });
});
