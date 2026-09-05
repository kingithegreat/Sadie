import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  mediaProduceMovieDef,
  mediaProduceMovieHandler,
} from '../tools/media-movie';
import { MovieProjectRunner } from '../movie/project-runner';

describe('media_produce_movie Tool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'movie-tool-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('defines the tool specification correctly', () => {
    expect(mediaProduceMovieDef.name).toBe('media_produce_movie');
    expect(mediaProduceMovieDef.category).toBe('media');
    expect(mediaProduceMovieDef.parameters.required).toContain('projectDir');
  });

  it('rejects missing or empty projectDir', async () => {
    const res1 = await mediaProduceMovieHandler({});
    expect(res1.success).toBe(false);
    expect(res1.error).toContain('projectDir must be a non-empty string path');

    const res2 = await mediaProduceMovieHandler({ projectDir: '' });
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('projectDir must be a non-empty string path');
  });

  it('rejects non-existent directory', async () => {
    const fakeDir = path.join(tmpDir, 'nonexistent');
    const res = await mediaProduceMovieHandler({ projectDir: fakeDir });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Project directory does not exist');
  });

  it('rejects directory without project.json', async () => {
    const res = await mediaProduceMovieHandler({ projectDir: tmpDir });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No project.json found');
  });

  it('successfully invokes MovieProjectRunner.runProject and formats output', async () => {
    const projectJsonPath = path.join(tmpDir, 'project.json');
    fs.writeFileSync(
      projectJsonPath,
      JSON.stringify({ projectId: 'imhotep-temple-01', name: 'Imhotep Approaches the Temple' }),
      'utf-8',
    );

    const mockRun = jest.spyOn(MovieProjectRunner, 'runProject').mockResolvedValueOnce({
      projectId: 'imhotep-temple-01',
      totalShots: 4,
      completedShots: 4,
      deferredShots: 0,
      failedShots: 0,
      skippedShots: 0,
      results: [
        {
          shotId: 'shot_001',
          sceneId: 'scene_01',
          status: 'video_generated',
          provider: 'ancient-pathways',
          files: ['shot_001.mp4'],
        },
      ],
    });

    const res = await mediaProduceMovieHandler({ projectDir: tmpDir, freeOnly: true });
    expect(mockRun).toHaveBeenCalledWith(tmpDir, {
      freeOnly: true,
      allowDeferred: false,
      allowWatermark: false,
    });
    expect(res.success).toBe(true);
    expect(res.result).toBeDefined();
    expect(res.result.summary).toContain('Movie Project "imhotep-temple-01" Generation Report:');
    expect(res.result.summary).toContain('Total shots: 4');
    expect(res.result.summary).toContain('shot_001 via ancient-pathways');

    mockRun.mockRestore();
  });
});
