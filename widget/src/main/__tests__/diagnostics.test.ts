/**
 * diagnostics.test.ts
 *
 * Unit tests for widget/src/main/diagnostics.ts
 *
 * Covers:
 *  - buildDiskInfo threshold logic
 *  - checkService (mocked axios)
 *  - checkWritePermissions (real temp dir)
 *  - vramToProfile mapping
 *  - runDiagnostics integration (all external calls mocked)
 */

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('axios');
jest.mock('../moa', () => ({
  detectGpuVram: jest.fn(),
}));
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/userData'),
    on: jest.fn(),
    isPackaged: false,
  },
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  BrowserWindow: jest.fn(),
}));

import axios from 'axios';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildDiskInfo,
  checkService,
  checkWritePermissions,
  vramToProfile,
  runDiagnostics,
  DISK_WARN_GB,
  DISK_BLOCK_GB,
} from '../diagnostics';
import { detectGpuVram } from '../moa';

// ── buildDiskInfo ─────────────────────────────────────────────────────────────

describe('buildDiskInfo', () => {
  test('returns ok=true and no warning when null (detection unavailable)', () => {
    const result = buildDiskInfo(null);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeNull();
    expect(result.freeGB).toBeNull();
  });

  test('returns ok=false and blocking warning when below DISK_BLOCK_GB', () => {
    const result = buildDiskInfo(DISK_BLOCK_GB - 0.5);
    expect(result.ok).toBe(false);
    expect(result.warning).toContain('free up space');
  });

  test('returns ok=true and a soft warning between DISK_BLOCK_GB and DISK_WARN_GB', () => {
    const result = buildDiskInfo((DISK_BLOCK_GB + DISK_WARN_GB) / 2);
    expect(result.ok).toBe(true);
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain('GB free');
  });

  test('returns ok=true and no warning above DISK_WARN_GB', () => {
    const result = buildDiskInfo(DISK_WARN_GB + 5);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeNull();
  });

  test('exact boundary: DISK_BLOCK_GB should block', () => {
    const result = buildDiskInfo(DISK_BLOCK_GB - 0.01);
    expect(result.ok).toBe(false);
  });

  test('exact boundary: DISK_WARN_GB should be clear', () => {
    const result = buildDiskInfo(DISK_WARN_GB);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeNull();
  });
});

// ── vramToProfile ─────────────────────────────────────────────────────────────

describe('vramToProfile', () => {
  test('returns null when vramGB is null', () => {
    expect(vramToProfile(null)).toBeNull();
  });

  test('4gb for low VRAM', () => {
    expect(vramToProfile(4)).toBe('4gb');
    expect(vramToProfile(5.9)).toBe('4gb');
  });

  test('8gb for mid VRAM', () => {
    expect(vramToProfile(6)).toBe('8gb');
    expect(vramToProfile(11.9)).toBe('8gb');
  });

  test('16gb+ for high VRAM', () => {
    expect(vramToProfile(12)).toBe('16gb+');
    expect(vramToProfile(24)).toBe('16gb+');
  });
});

// ── checkService ──────────────────────────────────────────────────────────────

describe('checkService', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns reachable=true for a 200 response', async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 200 });
    const result = await checkService('http://localhost:11434/api/tags');
    expect(result.reachable).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(typeof result.latencyMs).toBe('number');
  });

  test('returns reachable=false on network error (ECONNREFUSED)', async () => {
    (axios.get as jest.Mock).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const result = await checkService('http://localhost:11434/api/tags');
    expect(result.reachable).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.latencyMs).toBeNull();
  });

  test('returns reachable=false for 5xx response', async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 503 });
    const result = await checkService('http://localhost:5678/healthz');
    expect(result.reachable).toBe(false);
    expect(result.statusCode).toBe(503);
  });

  test('returns reachable=true for 404 (service up but path unknown)', async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 404 });
    const result = await checkService('http://localhost:6333/healthz');
    expect(result.reachable).toBe(true);
    expect(result.statusCode).toBe(404);
  });
});

// ── checkWritePermissions ─────────────────────────────────────────────────────

describe('checkWritePermissions', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-diag-test-'));
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('returns canWrite=true for a writable directory', () => {
    const result = checkWritePermissions(tmpDir);
    expect(result.canWrite).toBe(true);
    expect(result.path).toBe(tmpDir);
  });

  test('returns canWrite=false for a non-existent uncreateable path', () => {
    // Was jest.spyOn(fs, 'mkdirSync') — Node 24 made core fs exports
    // non-configurable, so the spy throws "Cannot redefine property" before
    // the assertion even runs. No mock needed: a path whose PARENT is a file
    // is genuinely uncreateable on every platform — mkdir under a file fails
    // with ENOTDIR/EEXIST — and tests the real code path instead of a stub.
    const parentFile = path.join(os.tmpdir(), `diag-not-a-dir-${Date.now()}`);
    fs.writeFileSync(parentFile, 'x');
    try {
      const result = checkWritePermissions(path.join(parentFile, 'child'));
      expect(result.canWrite).toBe(false);
    } finally {
      fs.unlinkSync(parentFile);
    }
  });
});

// ── runDiagnostics integration ────────────────────────────────────────────────

describe('runDiagnostics', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-diag-int-'));
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  beforeEach(() => {
    // Default: Ollama online, n8n offline, Qdrant offline, GPU known
    (axios.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/tags')) return Promise.resolve({ status: 200 });
      return Promise.reject(new Error('ECONNREFUSED'));
    });
    (detectGpuVram as jest.Mock).mockResolvedValue({ vramGB: 8, gpuName: 'RTX 3070', method: 'nvidia-smi' });
  });

  afterEach(() => jest.clearAllMocks());

  test('returns a complete DiagnosticsResult', async () => {
    const result = await runDiagnostics(
      { ollamaUrl: 'http://127.0.0.1:11434', n8nUrl: 'http://localhost:5678' },
      tmpDir
    );

    expect(result).toHaveProperty('disk');
    expect(result).toHaveProperty('ollama');
    expect(result).toHaveProperty('n8n');
    expect(result).toHaveProperty('qdrant');
    expect(result).toHaveProperty('permissions');
    expect(result).toHaveProperty('hardware');
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('timestamp');
  });

  test('Ollama reachable, n8n and Qdrant not', async () => {
    const result = await runDiagnostics(
      { ollamaUrl: 'http://127.0.0.1:11434', n8nUrl: 'http://localhost:5678' },
      tmpDir
    );
    expect(result.ollama.reachable).toBe(true);
    expect(result.n8n.reachable).toBe(false);
    expect(result.qdrant.reachable).toBe(false);
  });

  test('hardware profile is set from GPU detection', async () => {
    const result = await runDiagnostics(
      { ollamaUrl: 'http://127.0.0.1:11434', n8nUrl: 'http://localhost:5678' },
      tmpDir
    );
    expect(result.hardware.vramGB).toBe(8);
    expect(result.hardware.gpuName).toBe('RTX 3070');
    expect(result.hardware.profile).toBe('8gb');
  });

  test('permissions.canWrite=true for a real writable temp dir', async () => {
    const result = await runDiagnostics(
      { ollamaUrl: 'http://127.0.0.1:11434', n8nUrl: 'http://localhost:5678' },
      tmpDir
    );
    expect(result.permissions.canWrite).toBe(true);
  });

  test('survives GPU detection failure gracefully', async () => {
    (detectGpuVram as jest.Mock).mockRejectedValueOnce(new Error('nvidia-smi not found'));
    const result = await runDiagnostics(
      { ollamaUrl: 'http://127.0.0.1:11434', n8nUrl: 'http://localhost:5678' },
      tmpDir
    );
    expect(result.hardware.vramGB).toBeNull();
    expect(result.hardware.profile).toBeNull();
  });

  test('durationMs is a positive number', async () => {
    const result = await runDiagnostics(
      { ollamaUrl: 'http://127.0.0.1:11434', n8nUrl: 'http://localhost:5678' },
      tmpDir
    );
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test('timestamp is a valid ISO string', async () => {
    const result = await runDiagnostics(
      { ollamaUrl: 'http://127.0.0.1:11434', n8nUrl: 'http://localhost:5678' },
      tmpDir
    );
    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
  });

  test('custom qdrantUrl is used', async () => {
    const result = await runDiagnostics(
      { ollamaUrl: 'http://127.0.0.1:11434', n8nUrl: 'http://localhost:5678', qdrantUrl: 'http://localhost:6333' },
      tmpDir
    );
    expect(result.qdrant.url).toContain('6333');
  });
});
