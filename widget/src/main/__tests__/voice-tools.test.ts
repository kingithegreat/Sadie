/**
 * voice-tools.test.ts
 * Tests for src/main/tools/voice.ts
 *
 * BrowserWindow is mocked via __mocks__/electron.js and extended per-test to
 * simulate the renderer's Web Speech API response.
 */

// Extend the electron mock with BrowserWindow for these tests
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn().mockReturnValue('/tmp/sadie-test'),
    getAppPath: jest.fn().mockReturnValue('/tmp/sadie-app'),
  },
  BrowserWindow: {
    getAllWindows: jest.fn(),
  },
}));

import { BrowserWindow } from 'electron';
import {
  speakHandler,
  stopSpeakingHandler,
  getVoicesHandler,
  speakDef,
  stopSpeakingDef,
  getVoicesDef,
  voiceToolDefs,
  voiceToolHandlers,
} from '../tools/voice';

const mockGetAllWindows = BrowserWindow.getAllWindows as jest.MockedFunction<typeof BrowserWindow.getAllWindows>;

// Helper: build a fake BrowserWindow with executeJavaScript returning a value
function fakeWindow(jsResult: any) {
  return {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: jest.fn().mockResolvedValue(jsResult),
    },
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── speakHandler ───────────────────────────────────────────────────────────

describe('speakHandler', () => {
  test('returns failure when text is missing', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow({ success: true })]);
    const res = await speakHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/text is required/i);
  });

  test('returns failure when text is not a string', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow({ success: true })]);
    const res = await speakHandler({ text: 42 }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/text is required/i);
  });

  test('returns failure when no window is available', async () => {
    mockGetAllWindows.mockReturnValue([]);
    const res = await speakHandler({ text: 'Hello' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no window/i);
  });

  test('succeeds and returns speaking metadata', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow({ success: true })]);
    const res = await speakHandler({ text: 'Hello world' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.textLength).toBe(11);
    expect(res.result.rate).toBe(1.0);
    expect(res.result.pitch).toBe(1.0);
    expect(res.result.volume).toBe(1.0);
  });

  test('clamps rate to [0.5, 2.0]', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow({ success: true })]);
    const res = await speakHandler({ text: 'Test', rate: 5 }, {} as any);
    expect(res.result.rate).toBe(2.0);
    const res2 = await speakHandler({ text: 'Test', rate: 0.1 }, {} as any);
    expect(res2.result.rate).toBe(0.5);
  });

  test('clamps pitch to [0.5, 2.0]', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow({ success: true })]);
    const res = await speakHandler({ text: 'Test', pitch: 10 }, {} as any);
    expect(res.result.pitch).toBe(2.0);
  });

  test('clamps volume to [0.0, 1.0]', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow({ success: true })]);
    const res = await speakHandler({ text: 'Test', volume: 3.0 }, {} as any);
    expect(res.result.volume).toBe(1.0);
    const res2 = await speakHandler({ text: 'Test', volume: -1 }, {} as any);
    expect(res2.result.volume).toBe(0.0);
  });

  test('propagates error from renderer speech API', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow({ success: false, error: 'Speech synthesis not supported' })]);
    const res = await speakHandler({ text: 'Hi' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Speech synthesis not supported');
  });

  test('returns failure when executeJavaScript throws', async () => {
    const win = fakeWindow(null);
    win.webContents.executeJavaScript.mockRejectedValue(new Error('renderer crashed'));
    mockGetAllWindows.mockReturnValue([win]);
    const res = await speakHandler({ text: 'Crash test' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/failed to speak/i);
  });
});

// ── stopSpeakingHandler ────────────────────────────────────────────────────

describe('stopSpeakingHandler', () => {
  test('returns failure when no window is available', async () => {
    mockGetAllWindows.mockReturnValue([]);
    const res = await stopSpeakingHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no window/i);
  });

  test('succeeds when window is available', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow(undefined)]);
    const res = await stopSpeakingHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.message).toMatch(/stopped/i);
  });

  test('returns failure when executeJavaScript throws', async () => {
    const win = fakeWindow(null);
    win.webContents.executeJavaScript.mockRejectedValue(new Error('IPC error'));
    mockGetAllWindows.mockReturnValue([win]);
    const res = await stopSpeakingHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/failed to stop/i);
  });
});

// ── getVoicesHandler ───────────────────────────────────────────────────────

describe('getVoicesHandler', () => {
  test('returns failure when no window is available', async () => {
    mockGetAllWindows.mockReturnValue([]);
    const res = await getVoicesHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no window/i);
  });

  test('returns voice list from renderer', async () => {
    const voices = [
      { name: 'Microsoft Zira', lang: 'en-US', local: true },
      { name: 'Google US English', lang: 'en-US', local: false },
    ];
    mockGetAllWindows.mockReturnValue([fakeWindow(voices)]);
    const res = await getVoicesHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(2);
    expect(res.result.voices[0].name).toBe('Microsoft Zira');
  });

  test('returns empty voices list when renderer has no voices', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow([])]);
    const res = await getVoicesHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(0);
  });

  test('caps voices list at 20 entries', async () => {
    const manyVoices = Array.from({ length: 50 }, (_, i) => ({
      name: `Voice ${i}`, lang: 'en-US', local: true,
    }));
    mockGetAllWindows.mockReturnValue([fakeWindow(manyVoices)]);
    const res = await getVoicesHandler({}, {} as any);
    expect(res.result.voices.length).toBeLessThanOrEqual(20);
  });

  test('returns failure when executeJavaScript throws', async () => {
    const win = fakeWindow(null);
    win.webContents.executeJavaScript.mockRejectedValue(new Error('JS error'));
    mockGetAllWindows.mockReturnValue([win]);
    const res = await getVoicesHandler({}, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/failed to get voices/i);
  });
});

// ── Tool definitions ───────────────────────────────────────────────────────

describe('voice tool definitions', () => {
  test('voiceToolDefs exports 3 definitions', () => {
    expect(voiceToolDefs).toHaveLength(3);
  });

  test('speakDef requires text', () => {
    expect(speakDef.name).toBe('speak');
    expect(speakDef.category).toBe('voice');
    expect(speakDef.parameters.required).toContain('text');
  });

  test('stopSpeakingDef has no required parameters', () => {
    expect(stopSpeakingDef.name).toBe('stop_speaking');
    expect(stopSpeakingDef.parameters.required).toEqual([]);
  });

  test('getVoicesDef has no required parameters', () => {
    expect(getVoicesDef.name).toBe('get_voices');
    expect(getVoicesDef.parameters.required).toEqual([]);
  });

  test('voiceToolHandlers exports all 3 handlers', () => {
    expect(voiceToolHandlers.speak).toBeDefined();
    expect(voiceToolHandlers.stop_speaking).toBeDefined();
    expect(voiceToolHandlers.get_voices).toBeDefined();
  });
});
