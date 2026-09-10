/**
 * Does the ffmpeg probe find the ffmpeg HomeBot itself installed?
 *
 * The Home capability panel reported "ffmpeg: not installed" on machines where
 * Media Studio was rendering video perfectly well. Both statements were true.
 * There are two ffmpegs: one on PATH, and the one HomeBot's own one-click setup
 * downloads into userData. The renderer prefers the managed copy; the probe
 * only ever asked PATH. So the capability existed, the user was told it did
 * not, and nothing in the codebase could notice the disagreement.
 *
 * These drive the real exported entry point, `probeCapabilities`, and assert
 * the field the panel actually reads. Per rule 13 the probe is fed both a case
 * it SHOULD match and one it should not — a fallback that always returned true
 * would pass a one-sided test just as well as a correct one.
 */

jest.mock('electron', () => ({ app: { getPath: () => '/tmp/homebot-test' } }));

const execFileMock = jest.fn();
jest.mock('child_process', () => ({ execFile: (...a: any[]) => execFileMock(...a) }));

const findManagedFfmpegMock = jest.fn();
jest.mock('../ffmpeg-setup', () => ({ findManagedFfmpeg: () => findManagedFfmpegMock() }));

// Nothing here should reach the network; every URL probe fails fast.
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn().mockRejectedValue(new Error('offline')) } }));

const MANAGED = 'C:\Users\test\AppData\Roaming\HomeBot\ffmpeg\ffmpeg-n9.0-win64-gpl\bin\ffmpeg.exe';

/**
 * `promisify(execFile)` is what the probe calls, so the mock has to honour the
 * callback contract rather than return a promise.
 */
function execFileAnsweringOnly(workingBin: string | null) {
  return (bin: string, _args: string[], _opts: any, cb: Function) => {
    if (workingBin !== null && bin === workingBin) cb(null, { stdout: 'ffmpeg version 9.0', stderr: '' });
    else cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  };
}

describe('ffmpeg probe finds the managed install, not just PATH', () => {
  beforeEach(() => {
    jest.resetModules();
    execFileMock.mockReset();
    findManagedFfmpegMock.mockReset();
  });

  test('managed ffmpeg counts as available when PATH has none', async () => {
    execFileMock.mockImplementation(execFileAnsweringOnly(MANAGED));
    findManagedFfmpegMock.mockReturnValue(MANAGED);

    const { probeCapabilities } = require('../capability-probe');
    const report = await probeCapabilities({});

    expect(report.ffmpegAvailable).toBe(true);
    // Proves it was the managed binary that answered, not a PATH lookup that
    // silently succeeded: the exact path must have been executed.
    expect(execFileMock.mock.calls.map(c => c[0])).toContain(MANAGED);
  });

  test('PATH ffmpeg alone is still enough, and the managed search is not needed', async () => {
    execFileMock.mockImplementation(execFileAnsweringOnly('ffmpeg'));
    findManagedFfmpegMock.mockReturnValue(null);

    const { probeCapabilities } = require('../capability-probe');
    const report = await probeCapabilities({});

    expect(report.ffmpegAvailable).toBe(true);
    expect(findManagedFfmpegMock).not.toHaveBeenCalled();
  });

  test('no ffmpeg anywhere still reports false', async () => {
    // The half that matters: a fallback that returned true unconditionally
    // would pass the first test and fail this one.
    execFileMock.mockImplementation(execFileAnsweringOnly(null));
    findManagedFfmpegMock.mockReturnValue(null);

    const { probeCapabilities } = require('../capability-probe');
    const report = await probeCapabilities({});

    expect(report.ffmpegAvailable).toBe(false);
  });

  test('a managed path that is present but will not run reports false', async () => {
    // The lesson this file's subject was written for: a binary that exists and
    // is the wrong architecture looks identical to a working one until render.
    execFileMock.mockImplementation(execFileAnsweringOnly(null));
    findManagedFfmpegMock.mockReturnValue(MANAGED);

    const { probeCapabilities } = require('../capability-probe');
    const report = await probeCapabilities({});

    expect(report.ffmpegAvailable).toBe(false);
    expect(execFileMock.mock.calls.map(c => c[0])).toContain(MANAGED);
  });
});
