/**
 * Video Download Tool Tests
 */

const mockExecFileImpl = jest.fn();
jest.mock('child_process', () => ({ execFile: mockExecFileImpl }));

jest.mock('../tools/filesystem', () => ({
  resolveUserPath: jest.fn((p: string) => `/home/testuser/${p}`)
}));

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true)
}));

function mockExecFileResolve(stdout: string) {
  mockExecFileImpl.mockImplementation((_cmd: string, _args: any, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, { stdout, stderr: '' });
    return { on: jest.fn() };
  });
}

function mockExecFileReject(message: string) {
  mockExecFileImpl.mockImplementation((_cmd: string, _args: any, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(new Error(message), { stdout: '', stderr: message });
    return { on: jest.fn() };
  });
}

import { getVideoInfoHandler, downloadVideoHandler } from '../tools/video-download';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getVideoInfoHandler', () => {
  test('rejects missing url', async () => {
    const res = await getVideoInfoHandler({}, {} as any);
    expect(res.success).toBe(false);
  });

  test('rejects non-http url', async () => {
    const res = await getVideoInfoHandler({ url: 'not-a-url' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('returns parsed metadata when yt-dlp is available', async () => {
    // First call: --version check (availability probe), second call: --dump-json
    let call = 0;
    mockExecFileImpl.mockImplementation((_cmd: string, _args: any, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      call += 1;
      if (call === 1) {
        callback(null, { stdout: 'yt-dlp 2026.01.01', stderr: '' });
      } else {
        const info = {
          title: 'Test Video',
          uploader: 'Test Channel',
          duration: 120,
          view_count: 1000,
          thumbnail: 'https://example.com/thumb.jpg',
          extractor_key: 'Youtube',
          webpage_url: 'https://youtube.com/watch?v=abc123',
          formats: [
            { vcodec: 'avc1', height: 1080 },
            { vcodec: 'avc1', height: 720 },
            { vcodec: 'none', acodec: 'opus' }
          ]
        };
        callback(null, { stdout: JSON.stringify(info), stderr: '' });
      }
      return { on: jest.fn() };
    });

    const res = await getVideoInfoHandler({ url: 'https://youtube.com/watch?v=abc123' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.title).toBe('Test Video');
    expect(res.result.available_qualities).toContain('1080p');
    expect(res.result.available_qualities).toContain('audio_only');
  });
});

describe('downloadVideoHandler', () => {
  test('rejects missing url', async () => {
    const res = await downloadVideoHandler({}, {} as any);
    expect(res.success).toBe(false);
  });

  test('returns error when yt-dlp is not installed', async () => {
    mockExecFileReject('command not found');
    const res = await downloadVideoHandler({ url: 'https://youtube.com/watch?v=abc123' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/yt-dlp is not installed/i);
  });
});
