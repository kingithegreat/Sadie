/**
 * sd-cpp-setup.test.ts — one-click local image setup.
 *
 * Everything network-shaped is injected, so these tests run the REAL selection
 * and orchestration logic against fixture data — CI never touches GitHub,
 * HuggingFace or the disk beyond a temp dir.
 */

const os = require('os');
const path = require('path');
const fsx = require('fs');
const USER_DATA = fsx.mkdtempSync(path.join(os.tmpdir(), 'homebot-sdcpp-'));

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => USER_DATA),
    getAppPath: jest.fn(() => USER_DATA),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn(),
  Notification: jest.fn(),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import * as fs from 'fs';
import {
  pickBinaryAsset, pickModelFile, runAutoSetup,
  type SetupIO, type SetupProgress, type ReleaseAsset, type RepoFile,
} from '../sd-cpp-setup';

// ---- selection --------------------------------------------------------------

describe('pickBinaryAsset — choosing the build a stranger\'s machine can run', () => {
  const MB = 1024 * 1024;
  const ASSETS: ReleaseAsset[] = [
    { name: 'sd-master-abc123-bin-win-cuda12-x64.zip', browser_download_url: 'u1', size: 400 * MB },
    { name: 'sd-master-abc123-bin-win-cpu-x64.zip', browser_download_url: 'u0', size: 23 * MB },
    { name: 'sd-master-abc123-bin-win-avx2-x64.zip', browser_download_url: 'u2', size: 40 * MB },
    { name: 'sd-master-abc123-bin-win-noavx-x64.zip', browser_download_url: 'u3', size: 40 * MB },
    { name: 'sd-master-abc123-bin-macos-arm64.zip', browser_download_url: 'u4', size: 40 * MB },
    { name: 'sd-master-abc123-bin-linux-avx2-x64.zip', browser_download_url: 'u5', size: 40 * MB },
  ];

  test('prefers the current portable "cpu" build over everything', () => {
    // Verified against the real latest release: 2026 builds ship
    // win-cpu-x64.zip. CUDA is skipped — driver-dependent and ten times the
    // size; a default setup must work the first time on any machine.
    expect(pickBinaryAsset(ASSETS)!.name).toContain('win-cpu-x64');
  });

  test('older releases with avx naming still resolve', () => {
    expect(pickBinaryAsset(ASSETS.filter(a => !/-cpu-/.test(a.name)))!.name).toContain('win-avx2-x64');
  });

  test('falls back to noavx when nothing newer exists', () => {
    const old = ASSETS.filter(a => !/avx2|-cpu-/.test(a.name) || !/win/.test(a.name));
    expect(pickBinaryAsset(old)!.name).toContain('win-noavx-x64');
  });

  test('a release with ONLY a CUDA Windows build is refused, not shipped', () => {
    // Mutation testing showed the CUDA exclusion was shielded by the avx
    // preference loop under the fixtures above — an equivalent mutant. This
    // case is the one where the exclusion alone decides: shipping a CUDA build
    // to a machine without the matching driver produces an sd.exe that
    // launches and dies, which reads as "HomeBot is broken".
    expect(pickBinaryAsset([
      { name: 'sd-master-abc-bin-win-cuda12-x64.zip', browser_download_url: 'u', size: 1 },
    ])).toBeNull();
  });

  test('returns null rather than guessing when no Windows build exists', () => {
    expect(pickBinaryAsset(ASSETS.filter(a => !/win/.test(a.name)))).toBeNull();
  });
});

describe('pickModelFile — a checkpoint, not a component', () => {
  const GB = 1024 * 1024 * 1024;
  const FILES: RepoFile[] = [
    { path: 'stable-diffusion-v1-5-Q4_0.gguf', size: 1.6 * GB },
    { path: 'stable-diffusion-v1-5-Q8_0.gguf', size: 2.2 * GB },
    { path: 'stable-diffusion-v1-5-f16.gguf', size: 3.4 * GB },
    { path: 'sd-vae-Q8_0.gguf', size: 0.09 * GB },          // a component, not a model
    { path: 'clip-text-encoder.gguf', size: 0.3 * GB },      // likewise
    { path: 'README.md', size: 4096 },
  ];

  test('prefers a Q4 quantisation — the size/quality middle ground', () => {
    expect(pickModelFile(FILES)!.path).toBe('stable-diffusion-v1-5-Q4_0.gguf');
  });

  test('never picks a VAE or encoder side-file, however small', () => {
    const noQ4 = FILES.filter(f => !/Q4/.test(f.path));
    expect(pickModelFile(noQ4)!.path).toBe('stable-diffusion-v1-5-Q8_0.gguf');
  });

  test('refuses a repo with nothing usable rather than downloading junk', () => {
    expect(pickModelFile(FILES.filter(f => /vae|clip|README/i.test(f.path)))).toBeNull();
  });
});

// ---- orchestration ----------------------------------------------------------

const GB = 1024 * 1024 * 1024;

function fakeIO(overrides: Partial<SetupIO> = {}): SetupIO {
  return {
    getJson: jest.fn(async (url: string) => {
      if (url.includes('github')) {
        return { assets: [{ name: 'sd-master-xyz-bin-win-avx2-x64.zip', browser_download_url: 'https://x/bin.zip', size: 40 * 1024 * 1024 }] };
      }
      return [{ path: 'model-Q4_0.gguf', size: 1.6 * GB }];
    }),
    download: jest.fn(async (_url: string, dest: string, onBytes: any) => {
      onBytes(10 * 1024 * 1024, 40 * 1024 * 1024);
      fs.writeFileSync(dest, 'fake-bytes');
    }),
    extractZip: jest.fn(async (_zip: string, into: string) => {
      // A realistic build zip: the exe nested one directory down.
      const nest = path.join(into, 'sd-master-xyz-bin-win-cpu-x64');
      fs.mkdirSync(nest, { recursive: true });
      fs.writeFileSync(path.join(nest, 'sd-cli.exe'), 'exe');
      fs.writeFileSync(path.join(nest, 'ggml.dll'), 'dll');
    }),
    freeDiskGB: jest.fn(() => 50),
    ...overrides,
  };
}

describe('runAutoSetup', () => {
  const sdDir = path.join(USER_DATA, 'sd-cpp');

  beforeEach(() => {
    fs.rmSync(sdDir, { recursive: true, force: true });
  });

  test('happy path: engine found in a nested zip, model downloaded, phases in order', async () => {
    const seen: SetupProgress[] = [];
    const msg = await runAutoSetup(p => seen.push(p), fakeIO());

    expect(msg).toMatch(/Ready/);
    // The exe was brought up to where findSDCppBinary looks — WITH its DLL,
    // because sd-cli.exe cannot start without its ggml siblings.
    expect(fs.existsSync(path.join(sdDir, 'sd-cli.exe'))).toBe(true);
    expect(fs.existsSync(path.join(sdDir, 'ggml.dll'))).toBe(true);
    // The model landed in models/.
    expect(fs.existsSync(path.join(sdDir, 'models', 'model-Q4_0.gguf'))).toBe(true);

    const phases = seen.map(p => p.phase);
    expect(phases[0]).toBe('resolving');
    expect(phases).toContain('binary');
    expect(phases).toContain('model');
    expect(phases[phases.length - 1]).toBe('done');
    // Every note is for a person: no URLs, no exe names, no jargon.
    for (const p of seen) {
      expect(p.note).not.toMatch(/https?:|sd\.exe|gguf|avx/i);
    }
  });

  test('refuses politely when the disk is nearly full', async () => {
    await expect(runAutoSetup(() => {}, fakeIO({ freeDiskGB: () => 2 })))
      .rejects.toThrow(/Not enough disk space.*Clear some space/s);
  });

  test('a dead download never becomes a real file', async () => {
    const io = fakeIO({
      download: jest.fn(async () => { throw new Error('The download stopped early — check the internet connection and try again.'); }),
    });
    await expect(runAutoSetup(() => {}, io)).rejects.toThrow(/stopped early/);
    expect(fs.existsSync(path.join(sdDir, 'sd-cli.exe'))).toBe(false);
    expect(fs.existsSync(path.join(sdDir, 'models', 'model-Q4_0.gguf'))).toBe(false);
  });

  test('a release with no Windows build points at the manual path instead of guessing', async () => {
    const io = fakeIO({ getJson: jest.fn(async (url: string) =>
      url.includes('github') ? { assets: [{ name: 'bin-macos-arm64.zip', browser_download_url: 'u', size: 1 }] } : []) });
    await expect(runAutoSetup(() => {}, io)).rejects.toThrow(/Show me how/);
  });

  test('skips what already exists, so a retry never re-downloads 2 GB', async () => {
    fs.mkdirSync(path.join(sdDir, 'models'), { recursive: true });
    fs.writeFileSync(path.join(sdDir, 'sd.exe'), 'already');
    fs.writeFileSync(path.join(sdDir, 'models', 'existing.gguf'), 'already');

    const io = fakeIO();
    await runAutoSetup(() => {}, io);
    expect(io.download).not.toHaveBeenCalled();
  });
});

afterAll(() => { try { fsx.rmSync(USER_DATA, { recursive: true, force: true }); } catch {} });
