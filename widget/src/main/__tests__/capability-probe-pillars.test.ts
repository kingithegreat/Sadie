/**
 * Probing the three headline pillars: Local Image Diffusion and Coding Platform.
 *
 * Aden's mandate: "full assistant, media studio and coding platform."
 *
 * The capability doctor must tell the truth about all three:
 *  1. Local image generation: verifies both that sd-cli.exe actually executes
 *     (not just a dead file sitting in userData) and that a model is present.
 *  2. Code workspace: verifies git executes with `--version` (not `-version`,
 *     which exits with code 1 on git).
 */

export {};

jest.mock('electron', () => ({ app: { getPath: () => '/tmp/homebot-test' } }));

const pillarExecFileMock = jest.fn();
jest.mock('child_process', () => ({ execFile: (...a: any[]) => pillarExecFileMock(...a) }));

const findSDCppBinaryMock = jest.fn();
const findSDCppModelMock = jest.fn();
jest.mock('../tools/web', () => ({
  findSDCppBinary: () => findSDCppBinaryMock(),
  findSDCppModel: () => findSDCppModelMock(),
}));

jest.mock('../ffmpeg-setup', () => ({ findManagedFfmpeg: () => null }));

// Network probes fail fast without hitting the real network
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn().mockRejectedValue(new Error('offline')) } }));

const SD_CLI_PATH = 'C:\\Users\\test\\AppData\\Roaming\\HomeBot\\sd-cpp\\sd-cli.exe';
const SD_MODEL_PATH = 'C:\\Users\\test\\AppData\\Roaming\\HomeBot\\sd-cpp\\models\\v1-5.gguf';

function execFileAnswering(handlers: Record<string, { stdout?: string; error?: Error }> = {}) {
  return (bin: string, args: string[], _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    const key = `${bin} ${(args || []).join(' ')}`.trim();
    const entry = handlers[key] || handlers[bin];
    if (entry) {
      if (entry.error) callback?.(entry.error);
      else callback?.(null, { stdout: entry.stdout || '', stderr: '' });
    } else {
      callback?.(Object.assign(new Error(`Command not found: ${bin}`), { code: 'ENOENT' }));
    }
  };
}

describe('capability probe — local image diffusion & coding pillars', () => {
  beforeEach(() => {
    jest.resetModules();
    pillarExecFileMock.mockReset();
    pillarExecFileMock.mockImplementation(execFileAnswering({}));
    findSDCppBinaryMock.mockReset();
    findSDCppModelMock.mockReset();
  });

  describe('local image diffusion (sd-cpp)', () => {
    test('reports engine and model installed when binary runs and model is found', async () => {
      findSDCppBinaryMock.mockReturnValue(SD_CLI_PATH);
      findSDCppModelMock.mockReturnValue(SD_MODEL_PATH);
      pillarExecFileMock.mockImplementation(
        execFileAnswering({
          [`${SD_CLI_PATH} --version`]: { stdout: 'stable-diffusion.cpp version unknown' },
        })
      );

      const { probeCapabilities } = require('../capability-probe');
      const res = await probeCapabilities({});

      expect(res.sdCppInstalled).toBe(true);
      expect(res.sdModelInstalled).toBe(true);
      // Confirms `--version` was called on the binary
      expect(pillarExecFileMock).toHaveBeenCalledWith(
        SD_CLI_PATH,
        ['--version'],
        expect.objectContaining({ timeout: 4000 }),
        expect.any(Function)
      );
    });

    test('reports engine missing when no binary exists', async () => {
      findSDCppBinaryMock.mockReturnValue(null);
      findSDCppModelMock.mockReturnValue(null);

      const { probeCapabilities } = require('../capability-probe');
      const res = await probeCapabilities({});

      expect(res.sdCppInstalled).toBe(false);
      expect(res.sdModelInstalled).toBe(false);
    });

    test('reports engine missing when binary exists on disk but fails to run', async () => {
      findSDCppBinaryMock.mockReturnValue(SD_CLI_PATH);
      findSDCppModelMock.mockReturnValue(SD_MODEL_PATH);
      // Binary is broken (e.g. missing DLLs, wrong architecture)
      pillarExecFileMock.mockImplementation(
        execFileAnswering({
          [`${SD_CLI_PATH} --version`]: { error: Object.assign(new Error('DLL load error'), { code: 126 }) },
        })
      );

      const { probeCapabilities } = require('../capability-probe');
      const res = await probeCapabilities({});

      expect(res.sdCppInstalled).toBe(false);
      expect(res.sdModelInstalled).toBe(true);
    });

    test('reports model missing when engine runs but models directory has no model', async () => {
      findSDCppBinaryMock.mockReturnValue(SD_CLI_PATH);
      findSDCppModelMock.mockReturnValue(null);
      pillarExecFileMock.mockImplementation(
        execFileAnswering({
          [`${SD_CLI_PATH} --version`]: { stdout: 'stable-diffusion.cpp version unknown' },
        })
      );

      const { probeCapabilities } = require('../capability-probe');
      const res = await probeCapabilities({});

      expect(res.sdCppInstalled).toBe(true);
      expect(res.sdModelInstalled).toBe(false);
    });
  });

  describe('coding platform (git)', () => {
    test('reports git available when git --version executes with code 0', async () => {
      pillarExecFileMock.mockImplementation(
        execFileAnswering({
          'git --version': { stdout: 'git version 2.40.0' },
        })
      );

      const { probeCapabilities } = require('../capability-probe');
      const res = await probeCapabilities({});

      expect(res.gitAvailable).toBe(true);
      expect(pillarExecFileMock).toHaveBeenCalledWith(
        'git',
        ['--version'],
        expect.objectContaining({ timeout: 4000 }),
        expect.any(Function)
      );
    });

    test('reports git missing when git command fails or is absent', async () => {
      pillarExecFileMock.mockImplementation(
        execFileAnswering({
          'git --version': { error: Object.assign(new Error('not found'), { code: 'ENOENT' }) },
        })
      );

      const { probeCapabilities } = require('../capability-probe');
      const res = await probeCapabilities({});

      expect(res.gitAvailable).toBe(false);
    });
  });
});
