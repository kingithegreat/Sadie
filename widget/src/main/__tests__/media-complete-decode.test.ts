import { execFile } from 'child_process';
import { validateCompleteMediaDecode } from '../media-complete-decode';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
const execute = execFile as unknown as jest.Mock;
beforeEach(() => execute.mockReset());

test('a successful complete decode checks both required streams without encoding', async () => {
  execute.mockImplementation((_bin, _args, _opts, callback) => callback(null, '', ''));
  await expect(validateCompleteMediaDecode('ffmpeg', 'movie.mp4')).resolves.toBeUndefined();
  expect(execute.mock.calls[0][1]).toEqual(['-hide_banner', '-nostats', '-loglevel', 'error', '-xerror', '-i', 'movie.mp4', '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  expect(execute.mock.calls[0][2]).toEqual({ timeout: 300_000, maxBuffer: 64 * 1024, windowsHide: true });
});

test.each([
  { code: 1 },
  { killed: true, signal: 'SIGTERM' },
  { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', signal: 'SIGTERM' },
])('decoder errors fail closed even with metadata and bounded stderr: %j', async failure => {
  execute.mockImplementation((_bin, _args, _opts, callback) => callback(Object.assign(new Error('failed'), failure), '', `start packet\n${'broken packet\n'.repeat(100_000)}end packet`));
  const error = await validateCompleteMediaDecode('ffmpeg', 'movie.mp4').catch((value: Error) => value);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message.length).toBeLessThan(2000);
  expect(message).toContain('[diagnostic truncated]');
  expect(message).toContain('start packet');
  expect(message).toContain('end packet');
  expect(message).toContain('Any previous export is unchanged');
  if ('code' in failure) expect(message).toContain(String(failure.code));
  if ('signal' in failure) expect(message).toContain(failure.signal);
});
