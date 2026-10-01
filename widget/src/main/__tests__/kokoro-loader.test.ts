const mockModel = jest.fn();
const mockTokenizer = jest.fn();
const mockKokoro = jest.fn();
const mockGetPath = jest.fn(() => 'C:/fixture/homebot-profile');
const mockRuntimeEnv = { cacheDir: 'C:/read-only/app.asar/transformers/.cache' };
const mockRuntimeRequire = jest.fn(() => ({
  StyleTextToSpeech2Model: { from_pretrained: mockModel },
  AutoTokenizer: { from_pretrained: mockTokenizer },
  env: mockRuntimeEnv,
}));
jest.mock('electron', () => ({ app: { getPath: mockGetPath } }));
jest.mock('module', () => ({ createRequire: jest.fn(() => mockRuntimeRequire) }));
jest.mock('kokoro-js', () => ({ KokoroTTS: jest.fn((...args) => mockKokoro(...args)) }));

import { createRequire } from 'module';
import * as path from 'path';
import { loadKokoroForSpeech } from '../tts/kokoro-loader';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPath.mockReturnValue('C:/fixture/homebot-profile');
  mockModel.mockResolvedValue({ model: 'local' });
  mockTokenizer.mockResolvedValue({ tokenizer: 'local' });
  mockKokoro.mockReturnValue({ generate: jest.fn() });
});

test.each([false, true])('download consent %s reaches both actual underlying loaders', async allowDownloads => {
  await loadKokoroForSpeech(allowDownloads);
  expect(createRequire).toHaveBeenCalledWith(require.resolve('kokoro-js'));
  expect(mockRuntimeRequire).toHaveBeenCalledWith('@huggingface/transformers');
  expect(mockModel).toHaveBeenCalledWith('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8', device: 'cpu', local_files_only: !allowDownloads,
    cache_dir: path.join('C:/fixture/homebot-profile', 'models', 'kokoro'),
  });
  expect(mockTokenizer).toHaveBeenCalledWith('onnx-community/Kokoro-82M-v1.0-ONNX', {
    local_files_only: !allowDownloads,
    cache_dir: path.join('C:/fixture/homebot-profile', 'models', 'kokoro'),
  });
  expect(mockKokoro).toHaveBeenCalledWith({ model: 'local' }, { tokenizer: 'local' });
});

test('uses the active profile for both caches without mutating the runtime default', async () => {
  mockGetPath.mockReturnValueOnce('C:/fixture/profile-a');
  await loadKokoroForSpeech(true);
  mockGetPath.mockReturnValueOnce('C:/fixture/profile-b');
  await loadKokoroForSpeech(false);
  expect(mockGetPath).toHaveBeenNthCalledWith(1, 'userData');
  expect(mockGetPath).toHaveBeenNthCalledWith(2, 'userData');
  for (const loader of [mockModel, mockTokenizer]) {
    expect(loader.mock.calls[0][1]).toEqual(expect.objectContaining({
      cache_dir: path.join('C:/fixture/profile-a', 'models', 'kokoro'),
      local_files_only: false,
    }));
    expect(loader.mock.calls[1][1]).toEqual(expect.objectContaining({
      cache_dir: path.join('C:/fixture/profile-b', 'models', 'kokoro'),
      local_files_only: true,
    }));
  }
  expect(mockRuntimeEnv.cacheDir).toBe('C:/read-only/app.asar/transformers/.cache');
});

test('a missing local tokenizer does not construct a working speech engine', async () => {
  const dispose = jest.fn().mockResolvedValue(undefined);
  mockModel.mockResolvedValue({ dispose });
  mockTokenizer.mockRejectedValue(new Error('tokenizer absent'));
  await expect(loadKokoroForSpeech(false)).rejects.toThrow('tokenizer absent');
  expect(mockKokoro).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});
