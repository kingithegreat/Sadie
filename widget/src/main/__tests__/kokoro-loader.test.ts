const mockModel = jest.fn();
const mockTokenizer = jest.fn();
const mockKokoro = jest.fn();
const mockRuntimeRequire = jest.fn(() => ({
  StyleTextToSpeech2Model: { from_pretrained: mockModel },
  AutoTokenizer: { from_pretrained: mockTokenizer },
}));
jest.mock('module', () => ({ createRequire: jest.fn(() => mockRuntimeRequire) }));
jest.mock('kokoro-js', () => ({ KokoroTTS: jest.fn((...args) => mockKokoro(...args)) }));

import { createRequire } from 'module';
import { loadKokoroForSpeech } from '../tts/kokoro-loader';

beforeEach(() => {
  jest.clearAllMocks();
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
  });
  expect(mockTokenizer).toHaveBeenCalledWith('onnx-community/Kokoro-82M-v1.0-ONNX', {
    local_files_only: !allowDownloads,
  });
  expect(mockKokoro).toHaveBeenCalledWith({ model: 'local' }, { tokenizer: 'local' });
});

test('a missing local tokenizer does not construct a working speech engine', async () => {
  const dispose = jest.fn().mockResolvedValue(undefined);
  mockModel.mockResolvedValue({ dispose });
  mockTokenizer.mockRejectedValue(new Error('tokenizer absent'));
  await expect(loadKokoroForSpeech(false)).rejects.toThrow('tokenizer absent');
  expect(mockKokoro).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});
