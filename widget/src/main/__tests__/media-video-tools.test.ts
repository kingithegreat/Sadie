/**
 * Tests for FFmpeg-based video editing tools.
 *
 * Tests the tool definitions and handlers for trim and splice video operations.
 * Note: The actual FFmpeg execution is mocked in tests; the tools use real FFmpeg
 * in production.
 */

jest.mock('../mcp-client', () => ({
  seedMcpDefaults: jest.fn(),
  initializeMcpServers: jest.fn(() => Promise.resolve()),
  discoverExternalMcpServers: jest.fn(),
}));
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => require('os').tmpdir()),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
}));

// Need to initialize tools for the registry to be populated
beforeAll(() => {
  const { initializeTools } = require('../tools/index');
  initializeTools();
});

describe('media_trim_clip tool', () => {
  const { videoToolHandlers, videoToolDefs } = require('../tools/media-video');

  it('is exported with the correct name', () => {
    expect(videoToolHandlers.media_trim_clip).toBeDefined();
    expect(typeof videoToolHandlers.media_trim_clip).toBe('function');
  });

  it('is registered as a media tool', () => {
    const { getAllToolDefinitions } = require('../tools/index');
    const tools = getAllToolDefinitions();
    const trimTool = tools.find((t: any) => t.name === 'media_trim_clip');
    expect(trimTool).toBeDefined();
    expect(trimTool.category).toBe('media');
  });

  it('requires videoPath, startSec, and durationSec', () => {
    const def = videoToolDefs.find((d: any) => d.name === 'media_trim_clip');
    expect(def.parameters.required).toContain('videoPath');
    expect(def.parameters.required).toContain('startSec');
    expect(def.parameters.required).toContain('durationSec');
  });
});

describe('media_splice_video tool', () => {
  const { videoToolHandlers, videoToolDefs } = require('../tools/media-video');

  it('is exported with the correct name', () => {
    expect(videoToolHandlers.media_splice_video).toBeDefined();
    expect(typeof videoToolHandlers.media_splice_video).toBe('function');
  });

  it('is registered as a media tool', () => {
    const { getAllToolDefinitions } = require('../tools/index');
    const tools = getAllToolDefinitions();
    const spliceTool = tools.find((t: any) => t.name === 'media_splice_video');
    expect(spliceTool).toBeDefined();
    expect(spliceTool.category).toBe('media');
  });

  it('requires clips and outputPath', () => {
    const def = videoToolDefs.find((d: any) => d.name === 'media_splice_video');
    expect(def.parameters.required).toContain('clips');
    expect(def.parameters.required).toContain('outputPath');
  });

  it('requires at least 2 clips', async () => {
    const result = await videoToolHandlers.media_splice_video(
      { clips: ['clip1.mp4'], outputPath: '/tmp/out.mp4' },
      { executionId: 'test' } as any
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least 2 clips/i);
  });
});

describe('video tool validation', () => {
  const { videoToolHandlers } = require('../tools/media-video');

  it('refuses paths outside the user folder', async () => {
    const result = await videoToolHandlers.media_trim_clip(
      { videoPath: '/etc/passwd', startSec: 0, durationSec: 5 },
      { executionId: 'test' } as any
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inside your user folder/i);
  });

  it('requires video to exist', async () => {
    const result = await videoToolHandlers.media_trim_clip(
      { videoPath: 'nonexistent.mp4', startSec: 0, durationSec: 5 },
      { executionId: 'test' } as any
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not work|not found/i);
  });
});

describe('video tool parameter validation', () => {
  const { videoToolHandlers } = require('../tools/media-video');
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  // Create a temp video file for testing
  const tempDir = path.join(os.tmpdir(), 'homebot-test-video');
  let testVideoPath: string;

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    // Create a small dummy file (not a real video, but exists)
    testVideoPath = path.join(tempDir, 'test.mp4');
    fs.writeFileSync(testVideoPath, 'dUMMY_CONTENT_FOR_TESTING');
  });

  afterAll(() => {
    try { fs.unlinkSync(testVideoPath); } catch { /* cleanup */ }
    try { fs.rmdirSync(tempDir); } catch { /* cleanup */ }
  });

  it('validates startSec is non-negative', async () => {
    const result = await videoToolHandlers.media_trim_clip(
      { videoPath: testVideoPath, startSec: -1, durationSec: 5 },
      { executionId: 'test' } as any
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-negative/i);
  });

  it('validates durationSec is positive', async () => {
    const result = await videoToolHandlers.media_trim_clip(
      { videoPath: testVideoPath, startSec: 0, durationSec: 0 },
      { executionId: 'test' } as any
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/positive/i);
  });
});