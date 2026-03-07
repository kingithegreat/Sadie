/**
 * Unit tests for the SADIE Vision tools (vision_describe, vision_query)
 */

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';

jest.mock('fs');
jest.mock('http');
jest.mock('https');
jest.mock('../config-manager', () => ({
  assertPermission: jest.fn(),
  getSettings: jest.fn(() => ({
    ollamaUrl: 'http://127.0.0.1:11434',
    visionModel: 'llava',
  })),
}));
jest.mock('../tools/filesystem', () => ({
  resolveUserPath: (p: string) => p,
}));

// ── helpers ──────────────────────────────────────────────────────────────

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '/home/user';
const IMAGE_PATH = path.join(HOME, 'test.png');
const OUTSIDE_PATH = '/tmp/outside.png';

function mockFs(exists: boolean, isDir: boolean, content: Buffer): void {
  (fs.existsSync as jest.Mock).mockReturnValue(exists);
  (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => isDir });
  (fs.readFileSync as jest.Mock).mockReturnValue(content);
}

function mockOllamaSuccess(text: string): void {
  const mockReq: any = {
    on: jest.fn().mockReturnThis(),
    write: jest.fn(),
    end: jest.fn(),
    setTimeout: jest.fn(),
    destroy: jest.fn(),
  };
  const mockRes: any = {
    on: jest.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'data') cb(Buffer.from(JSON.stringify({ response: text })));
      if (event === 'end') cb();
      return mockRes;
    }),
  };
  (http.request as jest.Mock).mockImplementation((_opts: any, cb: any) => {
    if (cb) cb(mockRes);
    return mockReq;
  });
}

function mockOllamaError(msg: string): void {
  const mockReq: any = {
    on: jest.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'error') cb(new Error(msg));
      return mockReq;
    }),
    write: jest.fn(),
    end: jest.fn(),
    setTimeout: jest.fn().mockReturnThis(),
    destroy: jest.fn(),
  };
  (http.request as jest.Mock).mockImplementation(() => mockReq);
}

// ── import tool handlers after mocks ─────────────────────────────────────

// Must be done after jest.mock calls
let visionToolHandlers: any;
beforeAll(async () => {
  const mod = await import('../tools/vision');
  visionToolHandlers = mod.visionToolHandlers;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── vision_describe ───────────────────────────────────────────────────────

describe('vision_describe', () => {
  it('returns error when file_path is missing', async () => {
    mockFs(true, false, Buffer.from(''));
    const result = await visionToolHandlers.vision_describe({});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/file_path is required/i);
  });

  it('returns error when file does not exist', async () => {
    mockFs(false, false, Buffer.from(''));
    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when path is a directory', async () => {
    mockFs(true, true, Buffer.from(''));
    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/directory/i);
  });

  it('returns error for unsupported file extension', async () => {
    const unsupported = path.join(HOME, 'data.csv');
    mockFs(true, false, Buffer.from(''));
    const result = await visionToolHandlers.vision_describe({ file_path: unsupported });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a supported image/i);
  });

  it('returns error when path is outside home directory', async () => {
    mockFs(true, false, Buffer.from(''));
    const result = await visionToolHandlers.vision_describe({ file_path: OUTSIDE_PATH });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/access denied/i);
  });

  it('returns description on success', async () => {
    mockFs(true, false, Buffer.from('fake-png-data'));
    mockOllamaSuccess('A beautiful mountain landscape.');
    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(true);
    expect(result.result.response).toBe('A beautiful mountain landscape.');
    expect(result.result.model).toBe('llava');
    expect(result.result.file).toBe('test.png');
  });

  it('returns error when Ollama is unreachable', async () => {
    mockFs(true, false, Buffer.from('fake-png-data'));
    mockOllamaError('connect ECONNREFUSED');
    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/vision model error/i);
  });
});

// ── vision_query ──────────────────────────────────────────────────────────

describe('vision_query', () => {
  it('returns error when file_path is missing', async () => {
    mockFs(true, false, Buffer.from(''));
    const result = await visionToolHandlers.vision_query({ question: 'What colour is it?' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/file_path is required/i);
  });

  it('returns error when question is missing', async () => {
    mockFs(true, false, Buffer.from(''));
    const result = await visionToolHandlers.vision_query({ file_path: IMAGE_PATH });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/question is required/i);
  });

  it('returns answer for a specific question', async () => {
    mockFs(true, false, Buffer.from('fake-jpeg-data'));
    const jpegPath = path.join(HOME, 'photo.jpg');
    mockOllamaSuccess('The car is red.');
    const result = await visionToolHandlers.vision_query({
      file_path: jpegPath,
      question: 'What colour is the car?',
    });
    expect(result.success).toBe(true);
    expect(result.result.response).toBe('The car is red.');
  });

  it('passes the question as the prompt to Ollama', async () => {
    mockFs(true, false, Buffer.from('fake-png-data'));
    const capturedBodies: any[] = [];
    const mockReq: any = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn((data: Buffer) => { capturedBodies.push(JSON.parse(data.toString())); }),
      end: jest.fn(),
      setTimeout: jest.fn(),
      destroy: jest.fn(),
    };
    const mockRes: any = {
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        if (event === 'data') cb(Buffer.from(JSON.stringify({ response: 'Three cats.' })));
        if (event === 'end') cb();
        return mockRes;
      }),
    };
    (http.request as jest.Mock).mockImplementation((_opts: any, cb: any) => {
      if (cb) cb(mockRes);
      return mockReq;
    });

    await visionToolHandlers.vision_query({
      file_path: IMAGE_PATH,
      question: 'How many cats?',
    });

    expect(capturedBodies[0]?.prompt).toBe('How many cats?');
    expect(capturedBodies[0]?.model).toBe('llava');
    expect(Array.isArray(capturedBodies[0]?.images)).toBe(true);
  });

  it('returns error when file is outside home dir', async () => {
    mockFs(true, false, Buffer.from('data'));
    const result = await visionToolHandlers.vision_query({
      file_path: OUTSIDE_PATH,
      question: 'Anything visible?',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/access denied/i);
  });

  it('handles multi-chunk NDJSON Ollama response', async () => {
    mockFs(true, false, Buffer.from('fake'));
    // Simulate Ollama streaming two JSON lines
    const mockReq: any = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
      setTimeout: jest.fn(),
      destroy: jest.fn(),
    };
    const mockRes: any = {
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        if (event === 'data') {
          cb(Buffer.from(JSON.stringify({ response: 'A ' }) + '\n' + JSON.stringify({ response: 'dog.' })));
        }
        if (event === 'end') cb();
        return mockRes;
      }),
    };
    (http.request as jest.Mock).mockImplementation((_opts: any, cb: any) => {
      if (cb) cb(mockRes);
      return mockReq;
    });

    const result = await visionToolHandlers.vision_query({
      file_path: IMAGE_PATH,
      question: 'What animal?',
    });
    expect(result.success).toBe(true);
    // The two chunks 'A ' and 'dog.' are concatenated without extra trimming between parts
    expect(result.result.response).toMatch(/A\s+dog\./);
  });
});

// ── ollamaGenerate edge cases ────────────────────────────────────────────

describe('ollamaGenerate — edge cases', () => {
  it('uses https.request when ollamaUrl starts with https://', async () => {
    const configManager = require('../config-manager');
    configManager.getSettings.mockReturnValueOnce({
      ollamaUrl: 'https://ollama.example.com:11434',
      visionModel: 'llava',
    });
    mockFs(true, false, Buffer.from('fake-png'));

    const mockReq: any = { on: jest.fn().mockReturnThis(), write: jest.fn(), end: jest.fn(), setTimeout: jest.fn(), destroy: jest.fn() };
    const mockRes: any = {
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        if (event === 'data') cb(Buffer.from(JSON.stringify({ response: 'Described via HTTPS.' })));
        if (event === 'end') cb();
        return mockRes;
      }),
    };
    (https.request as jest.Mock).mockImplementation((_opts: any, cb: any) => {
      if (cb) cb(mockRes);
      return mockReq;
    });

    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(true);
    expect(result.result.response).toBe('Described via HTTPS.');
    expect(https.request).toHaveBeenCalled();
  });

  it('returns timeout error when Ollama request times out', async () => {
    mockFs(true, false, Buffer.from('fake-png'));
    const mockReq: any = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
      setTimeout: jest.fn((_ms: number, cb: () => void) => { cb(); }),
      destroy: jest.fn(),
    };
    (http.request as jest.Mock).mockImplementation(() => mockReq);

    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });

  it('returns "(no response)" when all NDJSON lines lack a response field', async () => {
    mockFs(true, false, Buffer.from('fake-png'));
    const mockReq: any = { on: jest.fn().mockReturnThis(), write: jest.fn(), end: jest.fn(), setTimeout: jest.fn(), destroy: jest.fn() };
    const mockRes: any = {
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        if (event === 'data') cb(Buffer.from(JSON.stringify({ done: true })));
        if (event === 'end') cb();
        return mockRes;
      }),
    };
    (http.request as jest.Mock).mockImplementation((_opts: any, cb: any) => { cb(mockRes); return mockReq; });

    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(true);
    expect(result.result.response).toBe('(no response)');
  });

  it('allows access when HOME env var is unset (home guard is skipped)', async () => {
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    mockFs(true, false, Buffer.from('fake-png'));
    mockOllamaSuccess('Allowed.');

    const result = await visionToolHandlers.vision_describe({ file_path: OUTSIDE_PATH });
    expect(result.success).toBe(true);

    if (origHome !== undefined) process.env.HOME = origHome;
    if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
  });

  it('falls back to env vars when config-manager getter throws', async () => {
    const configManager = require('../config-manager');
    configManager.getSettings.mockImplementationOnce(() => { throw new Error('config unavailable'); });

    mockFs(true, false, Buffer.from('fake-png'));
    mockOllamaSuccess('Fallback success.');

    const result = await visionToolHandlers.vision_describe({ file_path: IMAGE_PATH });
    expect(result.success).toBe(true);
  });
});

// ── visionToolDefs ────────────────────────────────────────────────────────

describe('visionToolDefs shape', () => {
  it('exports two tool definitions', async () => {
    const { visionToolDefs } = await import('../tools/vision');
    expect(visionToolDefs).toHaveLength(2);
    expect(visionToolDefs.map((d: any) => d.name)).toEqual(
      expect.arrayContaining(['vision_describe', 'vision_query'])
    );
  });

  it('vision_query has required file_path and question', async () => {
    const { visionToolDefs } = await import('../tools/vision');
    const vq = visionToolDefs.find((d: any) => d.name === 'vision_query');
    expect(vq?.parameters?.required).toEqual(expect.arrayContaining(['file_path', 'question']));
  });

  it('vision_describe has required file_path', async () => {
    const { visionToolDefs } = await import('../tools/vision');
    const vd = visionToolDefs.find((d: any) => d.name === 'vision_describe');
    expect(vd?.parameters?.required).toEqual(expect.arrayContaining(['file_path']));
  });
});
