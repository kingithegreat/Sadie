import { execFile } from 'child_process';
import { validateCompleteMediaDecode } from '../media-complete-decode';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
const execute = execFile as unknown as jest.Mock;
beforeEach(() => { execute.mockReset(); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

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
  expect(message).toBe('The movie could not be checked completely. Retry the export. Any previous export is unchanged.');
  const diagnostic = (error as Error & { cause: { code: string; signal: string | null; stderr: string } }).cause;
  expect(diagnostic.stderr.length).toBeLessThan(1600);
  expect(diagnostic.stderr).toContain('[diagnostic truncated]');
  expect(diagnostic.stderr).toContain('start packet');
  expect(diagnostic.stderr).toContain('end packet');
  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith('[Media decode] Output validation failed', diagnostic);
  if ('code' in failure) expect(diagnostic.code).toBe(String(failure.code));
  if ('signal' in failure) expect(diagnostic.signal).toBe(failure.signal);
});

test('diagnostics redact the output path and do not copy a command-bearing exception message', async () => {
  execute.mockImplementationOnce((_bin, _args, _opts, callback) => callback(Object.assign(new Error('command with private arguments'), { code: 1 }), '', 'movie.mp4 contains a broken packet'));
  const error = await validateCompleteMediaDecode('ffmpeg', 'movie.mp4').catch((value: Error) => value) as Error & { cause: { stderr: string } };
  expect(error.cause.stderr).toBe('<export> contains a broken packet');
  execute.mockImplementationOnce((_bin, _args, _opts, callback) => callback(new Error('command with private arguments'), '', ''));
  const empty = await validateCompleteMediaDecode('ffmpeg', 'movie.mp4').catch((value: Error) => value) as Error & { cause: { stderr: string } };
  expect(empty.cause.stderr).toBe('');
  expect(JSON.stringify(empty.cause)).not.toContain('private arguments');
});
