/**
 * Generate episode script (Media Studio). Every provider call here is a local
 * mock — a stubbed fetch or a 127.0.0.1 HTTP server. No real network, no keys.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import {
  buildEpisodeScriptMessages,
  buildEpisodeScriptRequest,
  chatCompletionsUrl,
  EpisodeScriptError,
  extractJsonObject,
  generateEpisodeScript,
  normalizeEpisodeScript,
  parseEpisodeScriptPayload,
} from '../movie/episode-script-generator';
import { directScriptToStoryboard } from '../movie/script-director';
import { mediaGetStoryboardHandler } from '../tools/media-storyboard';
import type { CustomLLMConfig } from '../../shared/types';

const ipcHandlers: Record<string, (...args: any[]) => Promise<any>> = {};
jest.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: any) => { ipcHandlers[name] = handler; } } }));
const mockSettings: { current: any } = { current: {} };
jest.mock('../config-manager', () => ({ getSettings: () => mockSettings.current }));
const mockAssertOnline = jest.fn();
jest.mock('../utils/provider-network-policy', () => ({ assertProviderOnlineAccess: (p: string) => mockAssertOnline(p) }));

const DEEPSEEK: CustomLLMConfig = {
  name: 'DeepSeek', provider: 'deepseek', apiUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test-not-real', model: 'deepseek-flash', enabled: true,
};
const PREMISE = 'A lighthouse keeper finds a message in a bottle from her younger self, warning her not to light the lamp tonight.';

const modelJson = {
  title: 'The Last Light',
  logline: 'A keeper must choose between duty and a warning from the past.',
  genre: 'noir_thriller',
  shots: [
    { title: 'Storm Island', visual: 'A lighthouse on a black rock in a storm', narration: 'The storm came early that year.', framing: 'wide', lens: '24mm', movement: 'slow push in', durationSec: 6, beatType: 'establishing', characters: ['MARA'] },
    { title: 'The Bottle', visual: 'Wet hands lift a glass bottle from the surf', narration: 'Inside, a note in her own handwriting.', framing: 'close', lens: '85mm', movement: 'static', durationSec: 5, beatType: 'investigation', characters: ['MARA'] },
    { title: 'The Lamp', visual: 'She stands at the unlit lamp, match in hand', narration: 'Do not light the lamp tonight.', framing: 'medium', lens: '35mm', movement: 'tilt up', durationSec: 5, beatType: 'climax', characters: ['MARA'] },
  ],
};

function completion(content: string) {
  return JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content } }] });
}
function fakeFetch(status: number, body: string) {
  return jest.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => body }) as any);
}

describe('prompt and request shape', () => {
  test('asks for strict JSON with the director enums and the requested shot count', () => {
    const [system, user] = buildEpisodeScriptMessages({ premise: PREMISE, shotCount: 5 });
    expect(system.role).toBe('system');
    expect(system.content).toMatch(/ONE JSON object and nothing else/);
    for (const v of ['"wide"', '"extreme_close"', '"85mm"', '"slow push in"', '"establishing"']) expect(system.content).toContain(v);
    expect(user.content).toContain(PREMISE);
    expect(user.content).toContain('exactly 5 shots');
  });

  test('clamps the shot count to 3..8', () => {
    expect(buildEpisodeScriptMessages({ premise: 'x', shotCount: 99 })[1].content).toContain('exactly 8 shots');
    expect(buildEpisodeScriptMessages({ premise: 'x', shotCount: 1 })[1].content).toContain('exactly 3 shots');
  });

  test('POSTs an OpenAI chat/completions body to the configured base URL with JSON mode', () => {
    const req = buildEpisodeScriptRequest(DEEPSEEK, { premise: PREMISE });
    expect(req.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(req.init.method).toBe('POST');
    expect(req.init.headers.Authorization).toBe('Bearer sk-test-not-real');
    const body = JSON.parse(req.init.body);
    expect(body).toMatchObject({ model: 'deepseek-flash', stream: false, response_format: { type: 'json_object' } });
    expect(body.messages).toHaveLength(2);
  });

  test('normalizes base URLs', () => {
    expect(chatCompletionsUrl('https://api.deepseek.com/')).toBe('https://api.deepseek.com/chat/completions');
    expect(chatCompletionsUrl('http://x/v1/chat/completions')).toBe('http://x/v1/chat/completions');
  });
});

describe('parsing and validation', () => {
  test('accepts bare JSON, fenced JSON and JSON wrapped in a sentence', () => {
    const raw = JSON.stringify(modelJson);
    expect(extractJsonObject(raw)).toEqual(modelJson);
    expect(extractJsonObject('```json\n' + raw + '\n```')).toEqual(modelJson);
    expect(extractJsonObject('Here is your script: ' + raw + ' Enjoy!')).toEqual(modelJson);
  });

  test.each(['', 'not json at all', '{"title": "x", "shots": [', '```json\n{oops}\n```'])('rejects malformed output %p as BAD_JSON', bad => {
    expect(() => extractJsonObject(bad)).toThrow(expect.objectContaining({ code: 'BAD_JSON' }));
  });

  test('normalizes into the exact DirectedShot shape script-director produces', () => {
    const script = normalizeEpisodeScript(modelJson, PREMISE);
    expect(script.title).toBe('The Last Light');
    expect(script.genre).toBe('noir_thriller');
    expect(script.shots.map(s => s.shotId)).toEqual(['shot_001', 'shot_002', 'shot_003']);
    expect(script.totalDurationSec).toBe(16);
    for (const s of script.shots) {
      expect(Object.keys(s).sort()).toEqual(['beatType', 'characters', 'durationSec', 'framing', 'lens', 'movement', 'narration', 'order', 'prompt', 'shotId', 'title'].sort());
    }
    expect(script.shots[0].prompt).toMatch(/^A lighthouse on a black rock in a storm, /);
  });

  test('coerces bad enum values, clamps durations and caps shots at 8', () => {
    const shots = Array.from({ length: 12 }, (_, i) => ({ visual: `beat ${i}`, framing: 'ultra-wide', lens: '200mm', movement: 'dolly zoom', durationSec: i === 0 ? 99 : 'x', beatType: 'nope' }));
    const script = normalizeEpisodeScript({ title: '', genre: 'made-up', shots }, 'a dragon and a wizard');
    expect(script.shots).toHaveLength(8);
    expect(script.shots[0]).toMatchObject({ framing: 'medium', lens: '35mm', movement: 'static', durationSec: 10, beatType: 'establishing' });
    expect(script.shots[1].durationSec).toBe(5);
    expect(script.title).toBe('Generated Episode');
    expect(script.genre).toBe('fantasy_myth');
  });

  test.each([
    [null],
    [[]],
    [{ title: 'x' }],
    [{ shots: 'three' }],
    [{ shots: [{ visual: 'one' }, { nothing: true }] }],
  ])('rejects a structurally invalid reply %p as INVALID_SCRIPT', bad => {
    expect(() => normalizeEpisodeScript(bad)).toThrow(expect.objectContaining({ code: 'INVALID_SCRIPT' }));
  });

  test('re-parsing a normalized script is stable (prompts are not re-suffixed)', () => {
    const once = normalizeEpisodeScript(modelJson, PREMISE);
    expect(parseEpisodeScriptPayload(JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect(parseEpisodeScriptPayload(JSON.stringify(once))).toEqual(once);
  });
});

describe('generateEpisodeScript', () => {
  beforeEach(() => mockAssertOnline.mockReset());

  test('calls the configured provider once and returns the normalized script', async () => {
    const f = fakeFetch(200, completion(JSON.stringify(modelJson)));
    const assertOnline = jest.fn();
    const script = await generateEpisodeScript({ premise: PREMISE, shotCount: 3 }, { config: DEEPSEEK, fetchImpl: f, assertOnline });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = (f.mock.calls[0] as any[]);
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('deepseek-flash');
    expect(assertOnline).toHaveBeenCalledWith('DeepSeek');
    expect(script.shots).toHaveLength(3);
  });

  test.each([
    [undefined, 'NO_PROVIDER'],
    [{ ...DEEPSEEK, apiUrl: '' }, 'NO_PROVIDER'],
    [{ ...DEEPSEEK, model: '' }, 'NO_PROVIDER'],
    [{ ...DEEPSEEK, apiUrl: 'file:///etc/passwd' }, 'NO_PROVIDER'],
    [{ ...DEEPSEEK, provider: 'anthropic' }, 'UNSUPPORTED_PROVIDER'],
  ])('a missing or unusable config (%p) fails before any request', async (config, code) => {
    const f = fakeFetch(200, '{}');
    await expect(generateEpisodeScript({ premise: PREMISE }, { config: config as any, fetchImpl: f }))
      .rejects.toMatchObject({ code });
    expect(f).not.toHaveBeenCalled();
  });

  test('an empty premise fails before any request', async () => {
    const f = fakeFetch(200, '{}');
    await expect(generateEpisodeScript({ premise: '  ' }, { config: DEEPSEEK, fetchImpl: f })).rejects.toMatchObject({ code: 'EMPTY_PREMISE' });
    expect(f).not.toHaveBeenCalled();
  });

  test('Online access off blocks a remote provider before any request', async () => {
    const f = fakeFetch(200, '{}');
    const assertOnline = () => { throw new Error('DeepSeek needs Online access.'); };
    await expect(generateEpisodeScript({ premise: PREMISE }, { config: DEEPSEEK, fetchImpl: f, assertOnline }))
      .rejects.toMatchObject({ code: 'ONLINE_ACCESS_DISABLED', message: 'DeepSeek needs Online access.' });
    expect(f).not.toHaveBeenCalled();
  });

  test.each([
    [401, '{"error":{"message":"Authentication Fails"}}', /HTTP 401: Authentication Fails\. Check the API key/],
    [404, '{"error":{"message":"Model Not Exist"}}', /HTTP 404: Model Not Exist\. Check the base URL and model ID/],
    [500, 'upstream exploded', /HTTP 500\./],
  ])('HTTP %i is a clear HTTP_ERROR', async (status, body, message) => {
    await expect(generateEpisodeScript({ premise: PREMISE }, { config: DEEPSEEK, fetchImpl: fakeFetch(status, body) }))
      .rejects.toMatchObject({ code: 'HTTP_ERROR', message: expect.stringMatching(message) });
  });

  test('a network failure is NETWORK_ERROR and never echoes the key', async () => {
    const f = jest.fn(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    const err = await generateEpisodeScript({ premise: PREMISE }, { config: DEEPSEEK, fetchImpl: f as any }).catch(e => e);
    expect(err).toBeInstanceOf(EpisodeScriptError);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).not.toContain('sk-test-not-real');
  });

  test('malformed model content is BAD_JSON; a non-completion body is BAD_JSON', async () => {
    await expect(generateEpisodeScript({ premise: PREMISE }, { config: DEEPSEEK, fetchImpl: fakeFetch(200, completion('Sure! Here is a story about a lighthouse.')) }))
      .rejects.toMatchObject({ code: 'BAD_JSON' });
    await expect(generateEpisodeScript({ premise: PREMISE }, { config: DEEPSEEK, fetchImpl: fakeFetch(200, '<html>') }))
      .rejects.toMatchObject({ code: 'BAD_JSON' });
  });

  test('works end to end against a local 127.0.0.1 OpenAI-compatible server (no Online gate for loopback)', async () => {
    const seen: any[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url, method: req.method, auth: req.headers.authorization, body: JSON.parse(body) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(completion('```json\n' + JSON.stringify(modelJson) + '\n```'));
      });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const port = (server.address() as AddressInfo).port;
      const assertOnline = jest.fn(() => { throw new Error('should not be called for loopback'); });
      const script = await generateEpisodeScript(
        { premise: PREMISE, shotCount: 3 },
        { config: { ...DEEPSEEK, provider: 'custom', apiUrl: `http://127.0.0.1:${port}/v1` }, assertOnline },
      );
      expect(script.title).toBe('The Last Light');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ url: '/v1/chat/completions', method: 'POST', auth: 'Bearer sk-test-not-real' });
      expect(seen[0].body.response_format).toEqual({ type: 'json_object' });
      expect(assertOnline).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});

describe('round trip into the storyboard loader and the IPC handlers', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-episode-script-'));
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = tmpRoot;
    mockAssertOnline.mockReset();
  });
  afterEach(() => {
    delete process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('a saved script loads through media_get_storyboard with every shot, prompt and narration', async () => {
    const script = normalizeEpisodeScript(modelJson, PREMISE);
    const saved = await directScriptToStoryboard({ script: PREMISE, title: script.title, directed: script });
    expect(saved.ok).toBe(true);
    const loaded = await mediaGetStoryboardHandler({ projectId: saved.projectId }, {} as any);
    expect(loaded.success).toBe(true);
    const scene = (loaded.result as any).scenes[0];
    expect((loaded.result as any).project.name).toBe('The Last Light');
    expect(scene.shots.map((s: any) => s.shotId)).toEqual(['shot_001', 'shot_002', 'shot_003']);
    scene.shots.forEach((s: any, i: number) => {
      expect(s.prompt).toBe(script.shots[i].prompt);
      expect(s.narration).toBe(script.shots[i].narration);
      expect(s.framing).toBe(script.shots[i].framing);
    });
  });

  test('IPC: generate-script uses the saved custom-LLM config in main and returns the script', async () => {
    const { registerStudioIpc } = await import('../modules/bundled/studio-ipc');
    registerStudioIpc((_c, h) => h, jest.fn(), () => undefined);
    mockSettings.current = { useCustomLLM: true, customLLM: DEEPSEEK };
    const f = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(fakeFetch(200, completion(JSON.stringify(modelJson))) as any);
    const res = await ipcHandlers['homebot:media:storyboard:generate-script']({}, { premise: PREMISE, shotCount: 3 });
    expect(res.ok).toBe(true);
    expect(res.script.shots).toHaveLength(3);
    expect(JSON.stringify(res)).not.toContain('sk-test-not-real');
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as any[])[0]).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(mockAssertOnline).toHaveBeenCalledWith('DeepSeek');
  });

  test('IPC: generate-script reports a missing config and a disabled module without a request', async () => {
    const { registerStudioIpc } = await import('../modules/bundled/studio-ipc');
    const f = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(fakeFetch(200, '{}') as any);
    registerStudioIpc((_c, h) => h, jest.fn(), () => undefined);
    mockSettings.current = {};
    const missing = await ipcHandlers['homebot:media:storyboard:generate-script']({}, { premise: PREMISE });
    expect(missing).toMatchObject({ ok: false, code: 'NO_PROVIDER' });
    registerStudioIpc((_c, h) => h, jest.fn(), () => { throw new Error('Production Studio is turned off.'); });
    const off = await ipcHandlers['homebot:media:storyboard:generate-script']({}, { premise: PREMISE });
    expect(off).toMatchObject({ ok: false, error: 'Production Studio is turned off.' });
    expect(f).not.toHaveBeenCalled();
  });

  test('IPC: save-script persists a storyboard the loader opens; invalid JSON is rejected', async () => {
    const { registerStudioIpc } = await import('../modules/bundled/studio-ipc');
    registerStudioIpc((_c, h) => h, jest.fn(), () => undefined);
    const script = normalizeEpisodeScript(modelJson, PREMISE);
    const res = await ipcHandlers['homebot:media:storyboard:save-script']({}, { script, premise: PREMISE });
    expect(res).toMatchObject({ ok: true, title: 'The Last Light' });
    const loaded = await mediaGetStoryboardHandler({ projectId: res.projectId }, {} as any);
    expect((loaded.result as any).scenes[0].shots).toHaveLength(3);

    const bad = await ipcHandlers['homebot:media:storyboard:save-script']({}, { script: '{not json' });
    expect(bad).toMatchObject({ ok: false, code: 'BAD_JSON' });
  });
});
