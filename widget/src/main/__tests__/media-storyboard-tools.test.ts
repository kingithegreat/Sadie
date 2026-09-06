import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  mediaCreateStoryboardDef,
  mediaCreateStoryboardHandler,
  mediaListStoryboardsDef,
  mediaListStoryboardsHandler,
  mediaGetStoryboardDef,
  mediaGetStoryboardHandler,
  mediaGenerateStoryboardFrameHandler,
  mediaRenderStoryboardDef,
  mediaRenderStoryboardHandler,
  getStoryboardsRootDir,
} from '../tools/media-storyboard';


describe('Media Storyboard Native Tools', () => {
  let tmpRoot: string;
  const originalEnv = process.env.HOMEBOT_MOVIE_PROJECTS_DIR;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-storyboard-test-'));
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

  it('verifies tool definitions schema and permissions category', () => {
    expect(mediaCreateStoryboardDef.name).toBe('media_create_storyboard');
    expect(mediaCreateStoryboardDef.category).toBe('media');
    expect(mediaCreateStoryboardDef.parameters.required).toContain('projectId');
    expect(mediaCreateStoryboardDef.parameters.required).toContain('title');

    expect(mediaListStoryboardsDef.name).toBe('media_list_storyboards');
    expect(mediaListStoryboardsDef.category).toBe('media');

    expect(mediaGetStoryboardDef.name).toBe('media_get_storyboard');
    expect(mediaGetStoryboardDef.category).toBe('media');
    expect(mediaGetStoryboardDef.parameters.required).toContain('projectId');
  });

  it('creates a new storyboard project with shots, scripts and deep-linking handoff', async () => {
    const res = await mediaCreateStoryboardHandler(
      {
        projectId: 'dawn-over-giza',
        title: 'Dawn Over Giza',
        notes: 'Ancient historical sequence at sunrise',
        shots: [
          {
            shotId: 'shot_001',
            prompt: 'Wide cinematic establishing shot of the pyramids at dawn, warm amber light',
            framing: 'wide',
            lens: '24mm',
            movement: 'slow push in',
            durationSec: 6,
            narration: 'The sun rises over the valley of the kings.',
          },
          {
            shotId: 'shot_002',
            prompt: 'Medium shot of architect studying papyrus blueprints, focused expression',
            framing: 'medium',
            lens: '35mm',
            movement: 'static',
            durationSec: 4,
            narration: 'Decades of calculations etched into papyrus.',
          },
        ],
      },
      { executionId: 'test-exec-1' },
    );

    expect(res.success).toBe(true);
    expect(res.result.projectId).toBe('dawn-over-giza');
    expect(res.result.shotCount).toBe(2);
    expect(res.result.totalDurationSec).toBe(10);
    expect(res.result.handoff).toEqual({
      mode: 'media',
      payload: {
        workspace: 'storyboard',
        projectId: 'dawn-over-giza',
      },
    });

    const projectDir = path.join(tmpRoot, 'dawn-over-giza');
    expect(fs.existsSync(path.join(projectDir, 'project.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'scenes', 'scene_01', 'scene.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'scenes', 'scene_01', 'shot_001', 'prompt.json'))).toBe(true);

    const script1 = fs.readFileSync(
      path.join(projectDir, 'scenes', 'scene_01', 'shot_001', 'script.txt'),
      'utf-8',
    );
    expect(script1).toBe('The sun rises over the valley of the kings.');
  });

  it('rejects creation when projectId is missing or invalid', async () => {
    const res = await mediaCreateStoryboardHandler(
      { projectId: '', title: 'Untitled' },
      { executionId: 'test-exec-2' },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/projectId is required/);
  });

  it('lists existing storyboard projects with shot counts', async () => {
    // Create 2 projects
    await mediaCreateStoryboardHandler(
      {
        projectId: 'project-alpha',
        title: 'Project Alpha',
        shots: [{ prompt: 'Action 1' }, { prompt: 'Action 2' }],
      },
      { executionId: 'test-exec-3' },
    );

    await mediaCreateStoryboardHandler(
      {
        projectId: 'project-beta',
        title: 'Project Beta',
        shots: [{ prompt: 'Action 3' }],
      },
      { executionId: 'test-exec-4' },
    );

    const listRes = await mediaListStoryboardsHandler({}, { executionId: 'test-exec-5' });
    expect(listRes.success).toBe(true);
    expect(listRes.result.count).toBe(2);
    const ids = listRes.result.storyboards.map((b: any) => b.projectId);
    expect(ids).toContain('project-alpha');
    expect(ids).toContain('project-beta');

    const alpha = listRes.result.storyboards.find((b: any) => b.projectId === 'project-alpha');
    expect(alpha.totalShots).toBe(2);
  });

  it('retrieves detailed shot breakdown from a storyboard', async () => {
    await mediaCreateStoryboardHandler(
      {
        projectId: 'retrieval-test',
        title: 'Retrieval Test',
        shots: [
          {
            shotId: 'shot_001',
            prompt: 'Hero approaches glowing obelisk',
            framing: 'close',
            lens: '50mm',
            durationSec: 4,
            narration: 'Here lies the key.',
          },
        ],
      },
      { executionId: 'test-exec-6' },
    );

    const getRes = await mediaGetStoryboardHandler(
      { projectId: 'retrieval-test' },
      { executionId: 'test-exec-7' },
    );

    expect(getRes.success).toBe(true);
    expect(getRes.result.project.name).toBe('Retrieval Test');
    expect(getRes.result.scenes.length).toBe(1);
    const shot = getRes.result.scenes[0].shots[0];
    expect(shot.shotId).toBe('shot_001');
    expect(shot.framing).toBe('close');
    expect(shot.lens).toBe('50mm');
    expect(shot.narration).toBe('Here lies the key.');
  });

  it('correctly resolves storyboards root directory from env', () => {
    const resolved = getStoryboardsRootDir();
    expect(resolved).toBe(tmpRoot);
  });

  it('fails gracefully when generating frame for non-existent project', async () => {
    const genRes = await mediaGenerateStoryboardFrameHandler(
      {
        projectId: 'ghost-project',
        shotId: 'shot_999',
      },
      { executionId: 'test-exec-8' },
    );
    expect(genRes.success).toBe(false);
    expect(genRes.error).toContain('not found');
  });

  it('validates media_render_storyboard tool definition and handles validation failure', async () => {
    expect(mediaRenderStoryboardDef.name).toBe('media_render_storyboard');
    expect(mediaRenderStoryboardDef.parameters.required).toContain('projectId');

    // Missing projectId
    const res = await mediaRenderStoryboardHandler({}, { executionId: 'test-exec-9' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('projectId is required');
  });

  it('auto-directs a raw script into a multi-shot visual storyboard via media_breakdown_script', async () => {
    const { mediaBreakdownScriptDef, mediaBreakdownScriptHandler } = await import('../tools/media-storyboard');
    expect(mediaBreakdownScriptDef.name).toBe('media_breakdown_script');
    expect(mediaBreakdownScriptDef.parameters.required).toContain('script');

    // Fails on empty script
    const errRes = await mediaBreakdownScriptHandler({ script: '' }, { executionId: 'test-exec-10' });
    expect(errRes.success).toBe(false);
    expect(errRes.error).toContain('script text is required');

    // Directs multi-shot scene
    const script = `An ancient architect enters the Great Hall of Karnak at dusk.
He unrolls the papyrus blueprint covered in star charts.
The stone workers hoist the massive granite pillar into alignment.
The golden pyramid capstone catches the last ray of sunlight.`;

    const res = await mediaBreakdownScriptHandler(
      {
        script,
        title: 'Karnak Construction',
        genre: 'historical_epic',
        shotCount: 4,
      },
      { executionId: 'test-exec-11' },
    );

    expect(res.success).toBe(true);
    expect(res.result.title).toBe('Karnak Construction');
    expect(res.result.genre).toBe('historical_epic');
    expect(res.result.totalShots).toBe(4);
    expect(res.result.shots.length).toBe(4);
    expect(res.result.handoff.mode).toBe('media');
    expect(res.result.handoff.payload.workspace).toBe('storyboard');

    // Verify shot #1 has framing, lens, prompt, and narration
    const s1 = res.result.shots[0];
    expect(s1.framing).toBe('wide');
    expect(s1.lens).toBe('24mm');
    expect(s1.prompt).toContain('Panavision');
    expect(s1.narration.length).toBeGreaterThan(5);
  });
});


