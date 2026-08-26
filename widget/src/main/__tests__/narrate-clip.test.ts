/**
 * Tests for tools/narrate-clip.ts — the bring-your-own clip narration tool.
 *
 * Pure helpers are tested directly. Handler tests exercise every failure that
 * must fail closed (bad path, bad extension, missing Gemini key) plus one full
 * success run with execFile, the TTS seam and ffmpeg all mocked.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('electron', () => ({
  app: { getAppPath: () => path.join(os.tmpdir(), 'fake-app-root', 'widget') },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { narrateClipHandler, buildAnalyzerArgs, buildMuxArgs, parseAnalyzerOutput } = require('../tools/narrate-clip');

const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: (...callArgs: any[]) => mockExecFile(...callArgs),
}));

const mockGetSettings = jest.fn();
jest.mock('../config-manager', () => ({
  getSettings: (...a: any[]) => mockGetSettings(...a),
}));

const mockRenderNarrationToFile = jest.fn();
jest.mock('../tools/voice', () => ({
  renderNarrationToFile: (...a: any[]) => mockRenderNarrationToFile(...a),
}));

jest.mock('../../shared/cloud-llm', () => ({
  apiKeyForProvider: (_settings: any, provider: string) =>
    provider === 'google-ai-studio' ? mockKey : '',
}));
let mockKey = '';

jest.mock('../media-render', () => ({
  findFfmpeg: async () => '/fake/ffmpeg',
  FFMPEG_MISSING_MESSAGE: 'ffmpeg is missing',
}));
jest.mock('../ffmpeg-setup', () => ({
  findManagedFfmpeg: () => undefined,
}));

function tmpUnderHome(): string {
  // os.tmpdir() lives under the user profile on Windows and CI Linux runners;
  // fall back to a folder inside homedir elsewhere.
  const t = os.tmpdir();
  return t.toLowerCase().startsWith(os.homedir().toLowerCase()) ? t : path.join(os.homedir(), '.homebot-test-tmp');
}

beforeEach(() => {
  mockExecFile.mockReset();
  mockRenderNarrationToFile.mockReset();
  mockKey = '';
});

describe('buildAnalyzerArgs / buildMuxArgs / parseAnalyzerOutput', () => {
  it('passes video then -o out', () => {
    expect(buildAnalyzerArgs('C:\\v\\a.mp4', 'C:\\t\\o.json')).toEqual(['C:\\v\\a.mp4', '-o', 'C:\\t\\o.json']);
  });

  it('mux args copy video, encode aac, map streams, shortest', () => {
    expect(buildMuxArgs('v.mp4', 'a.mp3', 'o.mp4')).toEqual([
      '-y', '-i', 'v.mp4', '-i', 'a.mp3',
      '-c:v', 'copy', '-c:a', 'aac',
      '-map', '0:v:0', '-map', '1:a:0',
      '-shortest', 'o.mp4',
    ]);
  });

  it('parses valid analyzer output', () => {
    const f = path.join(tmpUnderHome(), `an-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify({ duration_sec: 12, script: 'He scores!', timestamps: [] }));
    const parsed = parseAnalyzerOutput(f);
    expect(parsed.script).toBe('He scores!');
    expect(parsed.durationSec).toBe(12);
    fs.unlinkSync(f);
  });

  it('throws when the script field is missing or empty', () => {
    const f = path.join(tmpUnderHome(), `an-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify({ duration_sec: 3 }));
    expect(() => parseAnalyzerOutput(f)).toThrow(/no script/i);
    fs.writeFileSync(f, JSON.stringify({ script: '   ' }));
    expect(() => parseAnalyzerOutput(f)).toThrow(/no script/i);
    fs.unlinkSync(f);
  });

  it('throws on unreadable JSON', () => {
    const f = path.join(tmpUnderHome(), `an-${Date.now()}.json`);
    fs.writeFileSync(f, '<html>not json</html>');
    expect(() => parseAnalyzerOutput(f)).toThrow(/readable JSON/i);
    fs.unlinkSync(f);
  });
});

describe('media_narrate_clip handler — failing closed', () => {
  it('rejects unsupported extensions before touching anything', async () => {
    const res = await narrateClipHandler({ videoPath: path.join(os.homedir(), 'clip.avi') });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/\.(mp4|mov|webm)/i);
  });

  it('rejects paths escaping home', async () => {
    const res = await narrateClipHandler({ videoPath: process.platform === 'win32' ? 'D:\\x\\c.mp4' : '/x/c.mp4' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/inside your user folder/i);
  });

  it('fails closed with setup guidance when no Gemini key exists', async () => {
    mockGetSettings.mockReturnValue({});
    const dir = tmpUnderHome();
    fs.mkdirSync(dir, { recursive: true });
    const clip = path.join(dir, 'real.mp4');
    fs.writeFileSync(clip, 'x');
    const res = await narrateClipHandler({ videoPath: clip });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/API Keys/i);
    fs.unlinkSync(clip);
  });
});

describe('media_narrate_clip handler — happy path (all I/O mocked)', () => {
  it('analyzes, narrates, muxes and reports the final path', async () => {
    mockKey = 'test-key';
    mockGetSettings.mockReturnValue({});
    const dir = tmpUnderHome();
    fs.mkdirSync(dir, { recursive: true });
    const clip = path.join(dir, 'game.mp4');
    fs.writeFileSync(clip, 'x');

    mockExecFile.mockImplementation((_cmd: string, cmdArgs: string[], _opts: any, cb: any) => {
      const oIdx = cmdArgs.indexOf('-o');
      if (oIdx !== -1) {
        // The analyzer: write its JSON where -o points.
        fs.writeFileSync(cmdArgs[oIdx + 1], JSON.stringify({ duration_sec: 30, script: 'What a play!' }));
        cb(null, 'ok', '');
        return;
      }
      // The muxer: create the output file it was told to write.
      const outIdx = cmdArgs.lastIndexOf('-shortest') + 1;
      fs.writeFileSync(cmdArgs[outIdx], 'mp4-bytes');
      cb(null, '', '');
    });

    mockRenderNarrationToFile.mockResolvedValue({ path: path.join(dir, 'audio.mp3'), bytes: 1024, engine: 'edge' });

    const res = await narrateClipHandler({ videoPath: clip });
    expect(res.success).toBe(true);
    expect(String(res.result)).toContain('-narrated-');
    expect(String(res.result)).toMatch(/What a play!/);

    // The analyzer got the key through the environment, never argv.
    const analyzeCall = mockExecFile.mock.calls.find((c: any[]) => c[1].includes('-o'));
    expect((analyzeCall[2] as any).env.GEMINI_API_KEY).toBe('test-key');

    // Mux args copied video verbatim.
    const muxCall = mockExecFile.mock.calls.find((c: any[]) => !c[1].includes('-o'));
    expect(muxCall[0]).toBe('/fake/ffmpeg');
    expect(muxCall[1]).toContain('-c:v');
    expect(muxCall[1][muxCall[1].indexOf('-c:v') + 1]).toBe('copy');
    fs.unlinkSync(clip);
  });
});
