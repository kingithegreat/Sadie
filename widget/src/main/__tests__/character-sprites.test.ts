/**
 * Tests for tools/character-sprites.ts — Autonomous character model sheet generation,
 * validation, slicing, and rigging.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('electron', () => ({
  app: { getAppPath: () => path.join(os.tmpdir(), 'fake-app-root', 'widget') },
}));

const mockGetSettings = jest.fn();
jest.mock('../config-manager', () => ({
  getSettings: (...a: any[]) => mockGetSettings(...a),
}));

let mockGoogleKey = '';
jest.mock('../../shared/cloud-llm', () => ({
  apiKeyForProvider: (_settings: any, provider: string) =>
    provider === 'google-ai-studio' ? mockGoogleKey : '',
}));

const mockResolveAncientPathwaysDir = jest.fn();
jest.mock('../ancient-pathways', () => ({
  resolveAncientPathwaysDir: () => mockResolveAncientPathwaysDir(),
}));

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: (...callArgs: any[]) => mockSpawn(...callArgs),
}));

const mockHttpsRequest = jest.fn();
const mockHttpsGet = jest.fn();
jest.mock('https', () => ({
  ...jest.requireActual('https'),
  request: (...args: any[]) => mockHttpsRequest(...args),
  get: (...args: any[]) => mockHttpsGet(...args),
}));

function createMockChildProcess(stdoutData: string, stderrData = '', exitCode = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  process.nextTick(() => {
    if (stdoutData) proc.stdout.emit('data', Buffer.from(stdoutData));
    if (stderrData) proc.stderr.emit('data', Buffer.from(stderrData));
    proc.emit('close', exitCode);
  });
  return proc;
}

// Import after mocks
import {
  buildCharacterSpritePrompt,
  mediaGenerateSpritesDef,
  mediaGenerateSpritesHandler,
  mediaMeasureMouthAnchorsDef,
  mediaMeasureMouthAnchorsHandler,
} from '../tools/character-sprites';

beforeEach(() => {
  mockGetSettings.mockReset();
  mockSpawn.mockReset();
  mockResolveAncientPathwaysDir.mockReset();
  mockHttpsRequest.mockReset();
  mockHttpsGet.mockReset();
  mockGoogleKey = '';
  mockGetSettings.mockReturnValue({
    cloudProviders: {},
  });
});

describe('buildCharacterSpritePrompt', () => {
  it('builds rigid 8-panel prompt containing all canonical panels and character details', () => {
    const prompt = buildCharacterSpritePrompt(
      'Queen Hatshepsut, 18th Dynasty pharaoh, golden nemes headcloth, white linen sheath dress, serene authority',
      'Storybook Egyptian 2D animation style'
    );

    // Checks character description
    expect(prompt).toContain('Queen Hatshepsut');
    expect(prompt).toContain('18th Dynasty pharaoh');
    expect(prompt).toContain('Storybook Egyptian 2D animation style');

    // Checks all 8 canonical panels
    expect(prompt).toContain('Panel "turnaround":');
    expect(prompt).toContain('Panel "pose_a":');
    expect(prompt).toContain('Panel "pose_b":');
    expect(prompt).toContain('Panel "expression_a":');
    expect(prompt).toContain('Panel "expression_b":');
    expect(prompt).toContain('Panel "head_turn":');
    expect(prompt).toContain('Panel "mouth":');
    expect(prompt).toContain('Panel "body_mechanics":');

    // Checks the 8 visemes contract (A E I O U M B L)
    expect(prompt).toContain('A E I O U M B L');
    expect(prompt).toContain('LOWER FACE ONLY');

    // Separation contract (crucial for auto-slicing without bleed). The ground
    // is magenta now, not white, so this asserts the separation AND the ground.
    expect(prompt).toContain('clear ${SHEET_GROUND_NAME} space'.replace('${SHEET_GROUND_NAME}', 'magenta'));
    expect(prompt).toContain('never touching or overlapping');
  });

  it('asks for a magenta ground and never a white one', () => {
    // Load-bearing, not cosmetic. On a white ground the cut cannot be made
    // clean because the characters CONTAIN white - eyes, teeth, Leila's scarf,
    // the glare on her glasses. Reaching the white sealed between two legs once
    // took Flappy's eye whites from 534px to 23. On magenta the slicer measures
    // 0 residual background with those whites intact.
    // See Ancient Pathways docs/RIG_PLAN.md (R1/R4).
    const prompt = buildCharacterSpritePrompt('A cheerful bird');
    expect(prompt).toContain('magenta');
    expect(prompt).toContain('#FF00FF');
    expect(prompt).not.toContain('plain white background');
    // The character must not wear the key, or it gets cut out with the ground.
    expect(prompt).toContain('Do not put any magenta or pink anywhere on the character');
  });

  it('locks one style for the whole cast', () => {
    // Leila shipped soft-painterly with no keyline while every guest shipped
    // bold flat cel with a thick outline; the clash has been on record since
    // 2026-08-30. The guests are the majority, so they set the standard.
    const prompt = buildCharacterSpritePrompt('A historical guest');
    expect(prompt).toContain('bold consistent outline');
    expect(prompt).not.toContain('no hard black keyline');
    // The 1,282 white specks that reached nine episodes came in through the art.
    expect(prompt).toContain('No speckles, dots or noise');
  });

  it('uses default style when styleOverride is not provided', () => {
    const prompt = buildCharacterSpritePrompt('Young Roman architect');
    expect(prompt).toContain('Clean 2D animation storybook style');
    expect(prompt).toContain('Young Roman architect');
  });
});

describe('mediaGenerateSpritesDef', () => {
  it('conforms to HomeBot ToolDefinition schema', () => {
    expect(mediaGenerateSpritesDef.name).toBe('media_generate_sprites');
    expect(mediaGenerateSpritesDef.category).toBe('media');
    expect(typeof mediaGenerateSpritesDef.description).toBe('string');
    expect(mediaGenerateSpritesDef.description.length).toBeGreaterThan(20);
    expect(mediaGenerateSpritesDef.parameters.required).toEqual(['name', 'description']);
  });
});

describe('mediaGenerateSpritesHandler', () => {
  const dummyContext: any = {
    sessionId: 'test-session',
    messageId: 'test-msg',
  };

  it('fails if name is missing or invalid', async () => {
    const res1 = await mediaGenerateSpritesHandler({ description: 'valid desc' }, dummyContext);
    expect(res1.success).toBe(false);
    expect(res1.error).toContain('character name');

    const res2 = await mediaGenerateSpritesHandler({ name: 'invalid/name!', description: 'valid' }, dummyContext);
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('alphanumeric');
  });

  it('fails if description is missing', async () => {
    const res = await mediaGenerateSpritesHandler({ name: 'alexander' }, dummyContext);
    expect(res.success).toBe(false);
    expect(res.error).toContain('description');
  });

  it('supports dryRun mode returning prompt and panel contract without generating images or spawning python', async () => {
    const res = await mediaGenerateSpritesHandler(
      {
        name: 'leila',
        description: 'Young archeologist in field gear',
        dryRun: true,
      },
      dummyContext
    );

    expect(res.success).toBe(true);
    expect(res.result?.dryRun).toBe(true);
    expect(res.result?.character).toBe('leila');
    expect(res.result?.prompt).toContain('Panel "turnaround"');
    expect(res.result?.panels).toHaveLength(8);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns sheetPath when Ancient Pathways is not installed locally', async () => {
    // Mock Pollinations fetch
    const fakeImage = Buffer.from('FAKE_PNG_BYTES');
    mockHttpsGet.mockImplementation((_url, _opts, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      setImmediate(() => {
        res.emit('data', fakeImage);
        res.emit('end');
      });
      callback(res);
      return { on: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
    });

    mockResolveAncientPathwaysDir.mockReturnValue(null);

    const res = await mediaGenerateSpritesHandler(
      {
        name: 'caesar',
        description: 'Roman statesman in crimson toga',
      },
      dummyContext
    );

    expect(res.success).toBe(true);
    expect(res.result?.sliced).toBe(false);
    expect(res.result?.character).toBe('caesar');
    expect(res.result?.message).toContain('Ancient Pathways repository was not found');
  });

  it('successfully slices and auto-rigs sprites when Ancient Pathways slicer succeeds', async () => {
    // Mock Imagen 3 response
    mockGoogleKey = 'fake-gemini-key';
    const fakeImageB64 = Buffer.from('IMAGEN_PNG').toString('base64');
    mockHttpsRequest.mockImplementation((_opts, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      setImmediate(() => {
        res.emit('data', Buffer.from(JSON.stringify({ predictions: [{ bytesBase64Encoded: fakeImageB64 }] })));
        res.emit('end');
      });
      callback(res);
      return { on: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
    });

    // Create temp fake AP dir with fake script
    const fakeApDir = path.join(os.tmpdir(), `fake-ap-${Date.now()}`);
    fs.mkdirSync(path.join(fakeApDir, 'scripts'), { recursive: true });
    const fakeScript = path.join(fakeApDir, 'scripts', 'slice_character_sprites.py');
    fs.writeFileSync(fakeScript, '#!/usr/bin/env python3');

    mockResolveAncientPathwaysDir.mockReturnValue(fakeApDir);

    const slicerJson = JSON.stringify({
      ok: true,
      character: 'cleopatra',
      spriteCount: 39,
      groups: ['turnaround', 'pose_a', 'pose_b', 'expression_a', 'expression_b', 'head_turn', 'mouth', 'body_mechanics'],
      charDir: path.join(fakeApDir, 'workspace', 'characters', 'cleopatra'),
      manifestPath: path.join(fakeApDir, 'workspace', 'characters', 'cleopatra', 'manifest.json'),
      warnings: [],
    });

    mockSpawn.mockImplementation(() => createMockChildProcess(slicerJson, '', 0));

    try {
      const res = await mediaGenerateSpritesHandler(
        {
          name: 'cleopatra',
          description: 'Ptolemaic queen with gold uraeus crown and royal linen mantle',
        },
        dummyContext
      );

      expect(res.success).toBe(true);
      expect(res.result?.spriteCount).toBe(39);
      expect(res.result?.character).toBe('cleopatra');
      expect(res.result?.source).toBe('imagen-3');
      expect(res.result?.message).toContain('Generated and auto-rigged 39 sprites');
      expect(mockSpawn).toHaveBeenCalled();
    } finally {
      fs.rmSync(fakeApDir, { recursive: true, force: true });
    }
  });

  it('handles slicer failure cleanly and returns error message', async () => {
    // Mock Pollinations fetch
    const fakeImage = Buffer.from('FAKE_PNG_BYTES');
    mockHttpsGet.mockImplementation((_url, _opts, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      setImmediate(() => {
        res.emit('data', fakeImage);
        res.emit('end');
      });
      callback(res);
      return { on: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
    });

    const fakeApDir = path.join(os.tmpdir(), `fake-ap-err-${Date.now()}`);
    fs.mkdirSync(path.join(fakeApDir, 'scripts'), { recursive: true });
    const fakeScript = path.join(fakeApDir, 'scripts', 'slice_character_sprites.py');
    fs.writeFileSync(fakeScript, '#!/usr/bin/env python3');

    mockResolveAncientPathwaysDir.mockReturnValue(fakeApDir);
    mockSpawn.mockImplementation(() =>
      createMockChildProcess('', 'Model sheet validation failed: missing mouth panel', 1)
    );

    try {
      const res = await mediaGenerateSpritesHandler(
        {
          name: 'alexander',
          description: 'Macedonian general in bronze linothorax',
        },
        dummyContext
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('Slicer script failed (exit code 1)');
      expect(res.error).toContain('Model sheet validation failed');
    } finally {
      fs.rmSync(fakeApDir, { recursive: true, force: true });
    }
  });

  it('handles image generation failure cleanly when network errors out', async () => {
    mockHttpsGet.mockImplementation((_url, _opts, _callback) => {
      const req = new EventEmitter() as any;
      req.write = jest.fn();
      req.end = jest.fn();
      req.destroy = jest.fn();
      setImmediate(() => {
        req.emit('error', new Error('Network offline'));
      });
      return req;
    });

    const res = await mediaGenerateSpritesHandler(
      {
        name: 'caesar',
        description: 'Roman imperator',
      },
      dummyContext
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('Failed to generate character model sheet');
    expect(res.error).toContain('Network offline');
  });
});

describe('mediaMeasureMouthAnchorsDef', () => {
  it('conforms to ToolDefinition schema', () => {
    expect(mediaMeasureMouthAnchorsDef.name).toBe('media_measure_mouth_anchors');
    expect(mediaMeasureMouthAnchorsDef.category).toBe('media');
    expect(typeof mediaMeasureMouthAnchorsDef.description).toBe('string');
    expect(mediaMeasureMouthAnchorsDef.parameters.required).toEqual([]);
  });
});

describe('mediaMeasureMouthAnchorsHandler', () => {
  const dummyContext: any = {
    sessionId: 'test-session',
    messageId: 'test-msg',
  };

  it('fails when Ancient Pathways is not installed', async () => {
    mockResolveAncientPathwaysDir.mockReturnValue(null);

    const res = await mediaMeasureMouthAnchorsHandler({}, dummyContext);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Ancient Pathways directory not found');
  });

  it('fails when learn_from_anchors.py is missing', async () => {
    const fakeApDir = path.join(os.tmpdir(), `fake-ap-missing-${Date.now()}`);
    fs.mkdirSync(path.join(fakeApDir, 'scripts'), { recursive: true });
    mockResolveAncientPathwaysDir.mockReturnValue(fakeApDir);

    try {
      const res = await mediaMeasureMouthAnchorsHandler({}, dummyContext);
      expect(res.success).toBe(false);
      expect(res.error).toContain('learn_from_anchors.py not found');
    } finally {
      fs.rmSync(fakeApDir, { recursive: true, force: true });
    }
  });

  it('successfully runs the measurement script and returns output', async () => {
    const fakeApDir = path.join(os.tmpdir(), `fake-ap-measure-${Date.now()}`);
    fs.mkdirSync(path.join(fakeApDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fakeApDir, 'scripts', 'learn_from_anchors.py'), '#!/usr/bin/env python3');
    mockResolveAncientPathwaysDir.mockReturnValue(fakeApDir);

    const scriptOutput = 'ground truth: 195 hand-placed anchors across 6 characters\n  leila 34 ...';
    mockSpawn.mockImplementation(() => createMockChildProcess(scriptOutput, '', 0));

    try {
      const res = await mediaMeasureMouthAnchorsHandler({}, dummyContext);
      expect(res.success).toBe(true);
      expect(res.result?.output).toContain('195 hand-placed anchors');
      expect(mockSpawn).toHaveBeenCalledWith('python', ['scripts/learn_from_anchors.py'], expect.objectContaining({ cwd: fakeApDir }));
    } finally {
      fs.rmSync(fakeApDir, { recursive: true, force: true });
    }
  });

  it('passes --measure flag when requested', async () => {
    const fakeApDir = path.join(os.tmpdir(), `fake-ap-measure2-${Date.now()}`);
    fs.mkdirSync(path.join(fakeApDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fakeApDir, 'scripts', 'learn_from_anchors.py'), '#!/usr/bin/env python3');
    mockResolveAncientPathwaysDir.mockReturnValue(fakeApDir);
    mockSpawn.mockImplementation(() => createMockChildProcess('output', '', 0));

    try {
      const res = await mediaMeasureMouthAnchorsHandler({ measure: true }, dummyContext);
      expect(res.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('python', ['scripts/learn_from_anchors.py', '--measure'], expect.anything());
    } finally {
      fs.rmSync(fakeApDir, { recursive: true, force: true });
    }
  });

  it('passes --suggest flag when requested', async () => {
    const fakeApDir = path.join(os.tmpdir(), `fake-ap-suggest-${Date.now()}`);
    fs.mkdirSync(path.join(fakeApDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fakeApDir, 'scripts', 'learn_from_anchors.py'), '#!/usr/bin/env python3');
    mockResolveAncientPathwaysDir.mockReturnValue(fakeApDir);
    mockSpawn.mockImplementation(() => createMockChildProcess('output', '', 0));

    try {
      const res = await mediaMeasureMouthAnchorsHandler({ suggest: true }, dummyContext);
      expect(res.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('python', ['scripts/learn_from_anchors.py', '--suggest'], expect.anything());
    } finally {
      fs.rmSync(fakeApDir, { recursive: true, force: true });
    }
  });
});

