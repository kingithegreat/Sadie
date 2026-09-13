import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../config-manager', () => ({
  getSettings: () => ({ useCustomLLM: true }),
}));

import {
  mediaCreateStoryboardHandler,
  mediaGenerateStoryboardFrameHandler,
  mediaGenerateStoryboardFrameDef,
} from '../tools/media-storyboard';

describe('Media Storyboard Offload & Provider Routing', () => {
  let tmpRoot: string;
  const originalEnv = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-offload-test-'));
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = tmpRoot;
  });

  afterEach(() => {
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = originalEnv;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('exposes offload and provider options in tool definition', () => {
    expect(mediaGenerateStoryboardFrameDef.parameters.properties.provider).toBeDefined();
    expect(mediaGenerateStoryboardFrameDef.parameters.properties.allowDeferred).toBeDefined();
    expect(mediaGenerateStoryboardFrameDef.parameters.properties.freeOnly).toBeDefined();
    expect(mediaGenerateStoryboardFrameDef.parameters.properties.allowWatermark).toBeDefined();
  });

  it('successfully offloads frame generation to Colab T4 deferred worker ticket', async () => {
    await mediaCreateStoryboardHandler(
      {
        projectId: 'colab-offload-project',
        title: 'Colab Offload Project',
        shots: [{ shotId: 'shot_001', prompt: 'Cinematic panorama of ancient Giza' }],
      },
      { executionId: 'test-exec-1' },
    );

    const res = await mediaGenerateStoryboardFrameHandler(
      {
        projectId: 'colab-offload-project',
        shotId: 'shot_001',
        provider: 'colab-worker',
        allowDeferred: true,
      },
      { executionId: 'test-exec-2' },
    );

    expect(res.success).toBe(true);
    expect(res.result.deferred).toBe(true);
    expect(res.result.provider).toBe('colab-worker');
    expect(res.result.ticket).toBeDefined();
    expect(res.result.where).toBeDefined();
    expect(res.result.message).toContain('Offloaded to Colab T4 worker ticket');

    // Verify status.json in shot folder
    const statusFile = path.join(tmpRoot, 'colab-offload-project', 'scenes', 'scene_01', 'shot_001', 'status.json');
    expect(fs.existsSync(statusFile)).toBe(true);
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    expect(status.status).toBe('AWAITING_WORKER');
    expect(status.provider).toBe('colab-worker');
    expect(status.ticket).toBe(res.result.ticket);
  });
});
