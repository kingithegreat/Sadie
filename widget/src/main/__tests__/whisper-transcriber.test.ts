const mockModel = jest.fn();
const mockTokenizer = jest.fn();
const mockProcessor = jest.fn();
const mockFactory = jest.fn();
const mockConstruct = jest.fn();
const mockAsr = jest.fn();
const mockExists = jest.fn();
jest.mock('fs', () => ({ ...jest.requireActual('fs'), existsSync: (...args: unknown[]) => mockExists(...args) }));
jest.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => mockFactory(...args),
  WhisperForConditionalGeneration: { from_pretrained: (...args: unknown[]) => mockModel(...args) },
  AutoTokenizer: { from_pretrained: (...args: unknown[]) => mockTokenizer(...args) },
  AutoProcessor: { from_pretrained: (...args: unknown[]) => mockProcessor(...args) },
  AutomaticSpeechRecognitionPipeline: function (components: unknown) { mockConstruct(components); return mockAsr; },
}), { virtual: false });
jest.mock('electron', () => ({ app: { getPath: () => 'C:\\fake\\userData' }, ipcMain: { handle: jest.fn(), removeHandler: jest.fn() } }));
let mockSettings: Record<string, unknown> = {};
jest.mock('../config-manager', () => ({ getSettings: () => mockSettings }));
import * as path from 'path';
import { __resetWhisperForTests, describeWhisperLoadError, transcribeWithWhisper, whisperCacheDir } from '../speech/whisper-transcriber';
import { toFloat32 } from '../speech/whisper-ipc';
const audio = new Float32Array(16_000);
beforeEach(() => {
  __resetWhisperForTests(); jest.clearAllMocks();
  mockExists.mockReset().mockReturnValue(true);
  mockModel.mockReset().mockResolvedValue({ kind: 'model' });
  mockTokenizer.mockReset().mockResolvedValue({ kind: 'tokenizer' });
  mockProcessor.mockReset().mockResolvedValue({ kind: 'processor' });
  mockAsr.mockReset().mockResolvedValue({ text: '  hello there ' });
  mockFactory.mockImplementation(() => { throw new Error('Generic discovery must not run'); });
  mockSettings = { useCustomLLM: true };
});
test('all Whisper components use the writable cache and Online consent without generic discovery', async () => {
  const progress = jest.fn();
  mockModel.mockImplementationOnce(async (_id: string, opts: any) => { opts.progress_callback({ status: 'progress', progress: 41.6 }); return { kind: 'model' }; });
  expect(await transcribeWithWhisper({ modelId: 'Xenova/whisper-base.en', audio }, progress)).toBe('hello there');
  for (const loader of [mockModel, mockTokenizer, mockProcessor]) expect(loader).toHaveBeenCalledWith('Xenova/whisper-base.en', expect.objectContaining({ cache_dir: path.join('C:\\fake\\userData', 'models', 'transformers'), local_files_only: false, device: 'cpu' }));
  expect(whisperCacheDir()).toBe(mockModel.mock.calls[0][1].cache_dir);
  expect(progress).toHaveBeenCalledWith({ status: 'downloading', percent: 42 });
  expect(mockConstruct).toHaveBeenCalledWith({ task: 'automatic-speech-recognition', model: { kind: 'model' }, tokenizer: { kind: 'tokenizer' }, processor: { kind: 'processor' } });
  expect(mockAsr).toHaveBeenCalledWith(audio, expect.not.objectContaining({ language: expect.anything() }));
  expect(mockFactory).not.toHaveBeenCalled();
  await transcribeWithWhisper({ modelId: 'Xenova/whisper-base.en', audio });
  for (const loader of [mockModel, mockTokenizer, mockProcessor]) expect(loader).toHaveBeenCalledTimes(1);
});
test('Online off loads every component cache-only and a missing model explains setup', async () => {
  mockSettings = { useCustomLLM: false, customLLM: { enabled: true } };
  mockModel.mockRejectedValueOnce(new Error('`local_files_only=true` or `env.allowRemoteModels=false` and file was not found locally at "x/config.json".'));
  await expect(transcribeWithWhisper({ modelId: 'Xenova/whisper-tiny.en', audio })).rejects.toThrow('The voice model (whisper-tiny.en) downloads once. Turn on Online in Settings and try again — after that, voice works offline.');
  for (const loader of [mockModel, mockTokenizer, mockProcessor]) expect(loader.mock.calls[0][1]).toMatchObject({ local_files_only: true });
  for (const loader of [mockModel, mockTokenizer, mockProcessor]) expect(loader.mock.calls[0][0]).toBe(path.join(whisperCacheDir(), 'Xenova/whisper-tiny.en'));
  expect(mockFactory).not.toHaveBeenCalled();
});
test('an incomplete offline cache explains setup before tokenizer discovery', async () => {
  mockSettings = { useCustomLLM: false };
  mockExists.mockReturnValue(false);
  await expect(transcribeWithWhisper({ modelId: 'Xenova/whisper-base.en', audio })).rejects.toThrow('Turn on Online in Settings');
  for (const loader of [mockModel, mockTokenizer, mockProcessor]) expect(loader).not.toHaveBeenCalled();
});
test('a failed component can be retried instead of retaining a rejected load', async () => {
  mockTokenizer.mockRejectedValueOnce(new Error('fetch failed'));
  await expect(transcribeWithWhisper({ modelId: 'Xenova/whisper-base.en', audio })).rejects.toThrow('Could not download the voice model');
  expect(await transcribeWithWhisper({ modelId: 'Xenova/whisper-base.en', audio })).toBe('hello there');
  expect(mockTokenizer).toHaveBeenCalledTimes(2);
});
test('multilingual models get the language; bad input is refused before loading', async () => {
  mockAsr.mockResolvedValue({ text: 'hola' });
  await transcribeWithWhisper({ modelId: 'Xenova/whisper-small', language: 'ES', audio });
  expect(mockAsr).toHaveBeenCalledWith(audio, expect.objectContaining({ language: 'es', task: 'transcribe' }));
  await expect(transcribeWithWhisper({ modelId: 'evil/model', audio })).rejects.toThrow(/supported voice model/);
  await expect(transcribeWithWhisper({ modelId: 'Xenova/whisper-tiny.en', audio: new Float32Array(0) })).rejects.toThrow(/No audio/);
  await expect(transcribeWithWhisper({ modelId: 'Xenova/whisper-tiny.en', audio: new Float32Array(16_000 * 121) })).rejects.toThrow(/120 seconds/);
  expect(mockModel).toHaveBeenCalledTimes(1);
});
test('network and other load failures read plainly', () => {
  expect(describeWhisperLoadError(new Error('fetch failed'), true, 'Xenova/whisper-base')).toMatch(/Check your internet connection/);
  expect(describeWhisperLoadError(new Error('boom'), true, 'Xenova/whisper-base')).toBe('The voice model could not load: boom');
});
test('audio crosses IPC as Float32Array or bytes, and anything else is rejected', () => {
  const f = new Float32Array([0.5, -0.25]); expect(toFloat32(f)).toBe(f);
  expect(Array.from(toFloat32(f.buffer)!)).toEqual([0.5, -0.25]);
  expect(Array.from(toFloat32(new Uint8Array(f.buffer))!)).toEqual([0.5, -0.25]);
  expect(toFloat32(new Uint8Array(3))).toBeNull(); expect(toFloat32('nope')).toBeNull();
});
