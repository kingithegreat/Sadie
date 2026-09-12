import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runInNewContext } from 'vm';

const mockKokoroLoad = jest.fn();
jest.mock('../tts/kokoro-loader', () => ({ loadKokoroForSpeech: (...args: unknown[]) => mockKokoroLoad(...args) }));
const mockGetWindows = jest.fn();
jest.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => mockGetWindows() } }));

let mockSettings: any = { useCustomLLM: false };
const mockSetMetadata = jest.fn().mockResolvedValue(undefined);
const mockToFile = jest.fn(async (dir: string) => {
  const audioFilePath = path.join(dir, 'audio.mp3');
  fs.writeFileSync(audioFilePath, 'speech fixture');
  return { audioFilePath };
});
const mockGetVoices = jest.fn().mockResolvedValue([]);
jest.mock('msedge-tts', () => ({
  MsEdgeTTS: jest.fn(() => ({
    setMetadata: mockSetMetadata, toFile: mockToFile, getVoices: mockGetVoices,
  })),
  OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'mp3' },
}));
jest.mock('../config-manager', () => ({ getSettings: jest.fn(() => mockSettings) }));
jest.mock('../utils/logger', () => ({ logTelemetryEvent: jest.fn() }));

import { getSettings } from '../config-manager';
import { getVoicesHandler, renderNarrationToFile, resetTTS, __resetKokoroForTest, speakHandler } from '../tools/voice';

let dir: string;
beforeEach(() => {
  jest.clearAllMocks();
  resetTTS();
  __resetKokoroForTest();
  mockKokoroLoad.mockReset();
  mockSettings = { useCustomLLM: false, customLLM: { enabled: true } };
  (getSettings as jest.Mock).mockImplementation(() => mockSettings);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-speech-policy-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test.each([false, undefined])('Online=%s blocks Edge before connection or synthesis', async (choice) => {
  mockSettings = { useCustomLLM: choice };
  await expect(renderNarrationToFile('Private narration.', path.join(dir, 'n.mp3')))
    .rejects.toThrow(/online.*off/i);
  expect(mockSetMetadata).not.toHaveBeenCalled();
  expect(mockToFile).not.toHaveBeenCalled();
  expect(fs.readdirSync(dir)).toEqual([]);
});

test('a stale enabled provider does not override the explicit privacy switch', async () => {
  await expect(renderNarrationToFile('Private narration.', path.join(dir, 'n.mp3')))
    .rejects.toThrow(/online.*off/i);
  expect(mockSetMetadata).not.toHaveBeenCalled();
});

test('unreadable settings fail closed', async () => {
  (getSettings as jest.Mock).mockImplementation(() => { throw new Error('settings unavailable'); });
  await expect(renderNarrationToFile('Private narration.', path.join(dir, 'n.mp3')))
    .rejects.toThrow(/online.*off/i);
  expect(mockSetMetadata).not.toHaveBeenCalled();
});

test('voice discovery does not contact Microsoft with Online off', async () => {
  const result = await getVoicesHandler({}, {} as any);
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/online.*off/i);
  expect(mockGetVoices).not.toHaveBeenCalled();
});

test('explicit online consent reaches speech and produces a file', async () => {
  mockSettings = { useCustomLLM: true };
  const result = await renderNarrationToFile('Allowed narration.', path.join(dir, 'n.mp3'));
  expect(result.engine).toBe('edge');
  expect(mockSetMetadata).toHaveBeenCalledTimes(1);
  expect(mockToFile).toHaveBeenCalledTimes(1);
  expect(fs.readFileSync(result.path, 'utf8')).toBe('speech fixture');
});

test('revoking Online blocks a cached Edge connection', async () => {
  mockSettings = { useCustomLLM: true };
  await renderNarrationToFile('Allowed.', path.join(dir, 'one.mp3'));
  mockSettings.useCustomLLM = false;
  await expect(renderNarrationToFile('Private.', path.join(dir, 'two.mp3')))
    .rejects.toThrow(/online.*off/i);
  expect(mockToFile).toHaveBeenCalledTimes(1);
});

test('revoking Online during a failed stream blocks the reconnect', async () => {
  mockSettings = { useCustomLLM: true };
  mockToFile.mockImplementationOnce(async () => {
    mockSettings.useCustomLLM = false;
    throw new Error('Stream closed before turn.end');
  });
  await expect(renderNarrationToFile('Allowed until revoked.', path.join(dir, 'n.mp3')))
    .rejects.toThrow(/online.*off/i);
  expect(mockSetMetadata).toHaveBeenCalledTimes(1);
  expect(mockToFile).toHaveBeenCalledTimes(1);
});

test('revocation during voice initialization prevents sending the narration', async () => {
  mockSettings = { useCustomLLM: true };
  mockSetMetadata.mockImplementationOnce(async () => { mockSettings.useCustomLLM = false; });
  await expect(renderNarrationToFile('Private after initialization.', path.join(dir, 'n.mp3')))
    .rejects.toThrow(/online.*off/i);
  expect(mockToFile).not.toHaveBeenCalled();
});

test('cached local narration stays usable with Online off', async () => {
  const generate = jest.fn().mockResolvedValue({ toWav: () => Buffer.from('local audio fixture') });
  mockKokoroLoad.mockResolvedValue({ generate });
  const result = await renderNarrationToFile('Local narration.', path.join(dir, 'n.wav'), { engine: 'kokoro' });
  expect(mockKokoroLoad).toHaveBeenCalledWith(false);
  expect(result.engine).toBe('kokoro');
  expect(fs.readFileSync(result.path, 'utf8')).toBe('local audio fixture');
  expect(mockSetMetadata).not.toHaveBeenCalled();
});

test('missing local resources return setup guidance without an online fallback', async () => {
  mockKokoroLoad.mockRejectedValue(new Error('local model absent'));
  await expect(renderNarrationToFile('Private.', path.join(dir, 'n.wav'), { engine: 'kokoro' }))
    .rejects.toThrow(/voice on this PC is not ready.*Online is off/);
  expect(mockKokoroLoad).toHaveBeenCalledWith(false);
  expect(mockSetMetadata).not.toHaveBeenCalled();
  expect(mockToFile).not.toHaveBeenCalled();
});

test('an offline request does not join a pending online model download', async () => {
  mockSettings = { useCustomLLM: true };
  let rejectDownload!: (error: Error) => void;
  mockKokoroLoad.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDownload = reject; }));
  const online = renderNarrationToFile('First.', path.join(dir, 'one.wav'), { engine: 'kokoro' }).catch(e => e);
  mockSettings.useCustomLLM = false;
  mockKokoroLoad.mockRejectedValueOnce(new Error('cache absent'));
  await expect(renderNarrationToFile('Private.', path.join(dir, 'two.wav'), { engine: 'kokoro' }))
    .rejects.toThrow(/Online is off/);
  expect(mockKokoroLoad.mock.calls).toEqual([[true], [false]]);
  rejectDownload(new Error('download interrupted'));
  expect(await online).toBeInstanceOf(Error);
  expect(mockSetMetadata).not.toHaveBeenCalled();
});

function systemSpeech(voices: Array<{ name: string; lang: string; localService: boolean }>) {
  const speak = jest.fn(utterance => utterance.onend());
  const speechSynthesis = { cancel: jest.fn(), getVoices: () => voices, speak };
  const executeJavaScript = jest.fn(script => runInNewContext(script, {
    window: { speechSynthesis },
    SpeechSynthesisUtterance: class { constructor(public text: string) {} },
    setTimeout: jest.fn(),
  }));
  mockGetWindows.mockReturnValue([{ webContents: { executeJavaScript } }]);
  return speak;
}

test('spoken replies use an explicitly local system voice after privacy denial', async () => {
  const local = { name: 'Microsoft Zira', lang: 'en-US', localService: true };
  const speak = systemSpeech([{ name: 'Microsoft Jenny', lang: 'en-US', localService: false }, local]);
  const result = await speakHandler({ text: 'Private reply.', allowCloud: true }, {} as any);
  expect(result.success).toBe(true);
  expect(speak).toHaveBeenCalledTimes(1);
  expect(speak.mock.calls[0][0].voice).toEqual(local);
  expect(mockSetMetadata).not.toHaveBeenCalled();
});

test('remote-only system voices cannot bypass the privacy denial or use an implicit default', async () => {
  const speak = systemSpeech([{ name: 'Microsoft Jenny', lang: 'en-US', localService: false }]);
  const result = await speakHandler({ text: 'Private reply.' }, {} as any);
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/No voice on this PC/);
  expect(speak).not.toHaveBeenCalled();
  expect(mockSetMetadata).not.toHaveBeenCalled();
});
