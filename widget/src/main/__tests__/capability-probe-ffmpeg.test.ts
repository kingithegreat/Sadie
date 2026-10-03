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

export {};

jest.mock('electron', () => ({ app: { getPath: () => '/tmp/homebot-test' } }));

const execFileMock = jest.fn();
jest.mock('child_process', () => ({ execFile: (...a: any[]) => execFileMock(...a) }));

const findManagedFfmpegMock = jest.fn();
jest.mock('../ffmpeg-setup', () => ({ findManagedFfmpeg: () => findManagedFfmpegMock() }));

const existsSyncMock = jest.fn();
jest.mock('fs', () => ({ ...jest.requireActual('fs'), existsSync: (file: string) => existsSyncMock(file) }));
jest.mock('../tools/web', () => ({ findSDCppBinary: () => null, findSDCppModel: () => null }));

// Nothing here should reach the network; every URL probe fails fast.
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn().mockRejectedValue(new Error('offline')) } }));

const MANAGED = 'C:\\Users\\test\\AppData\\Roaming\\HomeBot\\ffmpeg\\ffmpeg-n9.0-win64-gpl\\bin\\ffmpeg.exe';
const EXPLICIT = 'C:\\portable-video-engine\\ffmpeg.exe';
const PORTABLE = 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const originalFfmpeg = process.env.HOMEBOT_FFMPEG;

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
    existsSyncMock.mockReset();
    existsSyncMock.mockImplementation(file => [MANAGED, EXPLICIT, PORTABLE].includes(file));
    delete process.env.HOMEBOT_FFMPEG;
  });

  afterAll(() => {
    if (originalFfmpeg === undefined) delete process.env.HOMEBOT_FFMPEG;
    else process.env.HOMEBOT_FFMPEG = originalFfmpeg;
  });

  test('explicit portable engine counts as available without PATH or managed install', async () => {
    process.env.HOMEBOT_FFMPEG = `  ${EXPLICIT}  `;
    execFileMock.mockImplementation(execFileAnsweringOnly(EXPLICIT));
    findManagedFfmpegMock.mockReturnValue(null);
    const { probeCapabilities } = require('../capability-probe');
    expect((await probeCapabilities({})).ffmpegAvailable).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(EXPLICIT, ['-version'], { timeout: 4000 }, expect.any(Function));
    expect(execFileMock.mock.calls.map(c => c[0])).not.toContain('ffmpeg');
  });

  test('standard portable Windows install is found when PATH has none', async () => {
    execFileMock.mockImplementation(execFileAnsweringOnly(PORTABLE));
    findManagedFfmpegMock.mockReturnValue(null);
    const { probeCapabilities } = require('../capability-probe');
    expect((await probeCapabilities({})).ffmpegAvailable).toBe(true);
    expect(execFileMock.mock.calls.map(c => c[0])).toContain(PORTABLE);
  });

  test('broken explicit engine falls back to working managed binary in media search order', async () => {
    process.env.HOMEBOT_FFMPEG = EXPLICIT;
    execFileMock.mockImplementation(execFileAnsweringOnly(MANAGED));
    findManagedFfmpegMock.mockReturnValue(MANAGED);
    const { probeCapabilities } = require('../capability-probe');
    expect((await probeCapabilities({})).ffmpegAvailable).toBe(true);
    expect(execFileMock.mock.calls.filter(c => c[1][0] === '-version').map(c => c[0])).toEqual([EXPLICIT, MANAGED]);
  });

  test('managed engine wins over working PATH just as actual media rendering does', async () => {
    execFileMock.mockImplementation((bin, args, opts, cb) => {
      if (bin === MANAGED || bin === 'ffmpeg') cb(null, { stdout: 'ffmpeg version 9.0', stderr: '' });
      else execFileAnsweringOnly(null)(bin, args, opts, cb);
    });
    findManagedFfmpegMock.mockReturnValue(MANAGED);
    const { probeCapabilities } = require('../capability-probe');
    expect((await probeCapabilities({})).ffmpegAvailable).toBe(true);
    expect(execFileMock.mock.calls.filter(c => c[1][0] === '-version').map(c => c[0])).toEqual([MANAGED]);
  });

  test('existing explicit and portable files that fail to run still report missing', async () => {
    process.env.HOMEBOT_FFMPEG = EXPLICIT;
    execFileMock.mockImplementation(execFileAnsweringOnly(null));
    findManagedFfmpegMock.mockReturnValue(null);
    const { probeCapabilities } = require('../capability-probe');
    expect((await probeCapabilities({})).ffmpegAvailable).toBe(false);
    expect(execFileMock.mock.calls.map(c => c[0])).toContain(EXPLICIT);
    expect(execFileMock.mock.calls.map(c => c[0])).toContain(PORTABLE);
  });

  test('timed-out explicit binary falls back rather than claiming it works', async () => {
    process.env.HOMEBOT_FFMPEG = EXPLICIT;
    execFileMock.mockImplementation((bin, args, opts, cb) => {
      if (bin === EXPLICIT) cb(Object.assign(new Error('probe timed out'), { code: 'ETIMEDOUT' }));
      else execFileAnsweringOnly('ffmpeg')(bin, args, opts, cb);
    });
    findManagedFfmpegMock.mockReturnValue(null);
    const { probeCapabilities } = require('../capability-probe');
    expect((await probeCapabilities({})).ffmpegAvailable).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(EXPLICIT, ['-version'], { timeout: 4000 }, expect.any(Function));
    expect(execFileMock.mock.calls.filter(c => c[1][0] === '-version').map(c => c[0])).toEqual([EXPLICIT, 'ffmpeg']);
  });

  test('managed lookup failure does not hide a working explicit engine', async () => {
    process.env.HOMEBOT_FFMPEG = EXPLICIT;
    execFileMock.mockImplementation(execFileAnsweringOnly(EXPLICIT));
    findManagedFfmpegMock.mockImplementation(() => { throw new Error('managed directory unavailable'); });
    const { probeCapabilities } = require('../capability-probe');
    expect((await probeCapabilities({})).ffmpegAvailable).toBe(true);
    expect(execFileMock.mock.calls.map(c => c[0])).toContain(EXPLICIT);
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

  test('PATH ffmpeg alone is still enough after checking managed discovery', async () => {
    execFileMock.mockImplementation(execFileAnsweringOnly('ffmpeg'));
    findManagedFfmpegMock.mockReturnValue(null);

    const { probeCapabilities } = require('../capability-probe');
    const report = await probeCapabilities({});

    expect(report.ffmpegAvailable).toBe(true);
    expect(findManagedFfmpegMock).toHaveBeenCalled();
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
