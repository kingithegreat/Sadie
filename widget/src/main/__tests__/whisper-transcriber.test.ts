const mockPipeline = jest.fn();
jest.mock('@huggingface/transformers', () => ({ pipeline: (...args: unknown[]) => mockPipeline(...args) }), { virtual: false });
jest.mock('electron', () => ({ app: { getPath: () => 'C:\\fake\\userData' }, ipcMain: { handle: jest.fn(), removeHandler: jest.fn() } }));
let mockSettings: Record<string, unknown> = {};
jest.mock('../config-manager', () => ({ getSettings: () => mockSettings }));

import * as path from 'path';
import { __resetWhisperForTests, describeWhisperLoadError, transcribeWithWhisper, whisperCacheDir } from '../speech/whisper-transcriber';
import { toFloat32 } from '../speech/whisper-ipc';

const audio = new Float32Array(16_000);

beforeEach(() => {
  __resetWhisperForTests();
  mockPipeline.mockReset();
  mockSettings = { useCustomLLM: true };
});

test('the model loads in the main process into HomeBot\'s data folder, and downloads only while Online is on', async () => {
  const asr = jest.fn(async () => ({ text: '  hello there ' }));
  mockPipeline.mockResolvedValue(asr);
  const progress = jest.fn();
  mockPipeline.mockImplementationOnce(async (_task: string, _model: string, opts: any) => { opts.progress_callback({ status: 'progress', progress: 41.6 }); return asr; });

  expect(await transcribeWithWhisper({ modelId: 'Xenova/whisper-base.en', audio }, progress)).toBe('hello there');
  const [task, model, opts] = mockPipeline.mock.calls[0];
  expect([task, model]).toEqual(['automatic-speech-recognition', 'Xenova/whisper-base.en']);
  expect(opts).toMatchObject({ cache_dir: path.join('C:\\fake\\userData', 'models', 'transformers'), local_files_only: false, device: 'cpu' });
  expect(whisperCacheDir()).toBe(opts.cache_dir);
  expect(progress).toHaveBeenCalledWith({ status: 'downloading', percent: 42 });
  // English-only checkpoints get no language option.
  expect(asr).toHaveBeenCalledWith(audio, expect.not.objectContaining({ language: expect.anything() }));

  // A second transcription reuses the loaded model.
  await transcribeWithWhisper({ modelId: 'Xenova/whisper-base.en', audio });
  expect(mockPipeline).toHaveBeenCalledTimes(1);
});

test('with Online off the load is cache-only, and a missing model says how to get it', async () => {
  mockSettings = { useCustomLLM: false };
  mockPipeline.mockRejectedValue(new Error('`local_files_only=true` or `env.allowRemoteModels=false` and file was not found locally at "x/config.json".'));
  await expect(transcribeWithWhisper({ modelId: 'Xenova/whisper-tiny.en', audio })).rejects.toThrow(
    'The voice model (whisper-tiny.en) downloads once. Turn on Online in Settings and try again — after that, voice works offline.');
  expect(mockPipeline.mock.calls[0][2]).toMatchObject({ local_files_only: true });
});

test('multilingual models get the language; bad input is refused before any load', async () => {
  const asr = jest.fn(async () => ({ text: 'hola' }));
  mockPipeline.mockResolvedValue(asr);
  await transcribeWithWhisper({ modelId: 'Xenova/whisper-small', language: 'ES', audio });
  expect(asr).toHaveBeenCalledWith(audio, expect.objectContaining({ language: 'es', task: 'transcribe' }));

  await expect(transcribeWithWhisper({ modelId: 'evil/model', audio })).rejects.toThrow(/supported voice model/);
  await expect(transcribeWithWhisper({ modelId: 'Xenova/whisper-tiny.en', audio: new Float32Array(0) })).rejects.toThrow(/No audio/);
  await expect(transcribeWithWhisper({ modelId: 'Xenova/whisper-tiny.en', audio: new Float32Array(16_000 * 121) })).rejects.toThrow(/120 seconds/);
  expect(mockPipeline).toHaveBeenCalledTimes(1);
});

test('network and other load failures read plainly', () => {
  expect(describeWhisperLoadError(new Error('fetch failed'), true, 'Xenova/whisper-base')).toMatch(/Check your internet connection/);
  expect(describeWhisperLoadError(new Error('boom'), true, 'Xenova/whisper-base')).toBe('The voice model could not load: boom');
});

test('audio crosses IPC as Float32Array or bytes, and anything else is rejected', () => {
  const f = new Float32Array([0.5, -0.25]);
  expect(toFloat32(f)).toBe(f);
  expect(Array.from(toFloat32(f.buffer)!)).toEqual([0.5, -0.25]);
  expect(Array.from(toFloat32(new Uint8Array(f.buffer))!)).toEqual([0.5, -0.25]);
  expect(toFloat32(new Uint8Array(3))).toBeNull();
  expect(toFloat32('nope')).toBeNull();
});
