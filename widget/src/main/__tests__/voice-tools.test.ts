/**
 * voice-tools.test.ts
 * Tests for src/main/tools/voice.ts
 *
 * Edge TTS (msedge-tts) is mocked so tests run without network.
 * Falls back to Web Speech API path when Edge TTS throws.
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn().mockReturnValue('/tmp/homebot-test'),
    getAppPath: jest.fn().mockReturnValue('/tmp/homebot-app'),
  },
  BrowserWindow: {
    getAllWindows: jest.fn(),
  },
}));

// Mock fs and os for temp file handling
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// Mock msedge-tts
const mockToFile = jest.fn().mockResolvedValue(undefined);
const mockSetMetadata = jest.fn().mockResolvedValue(undefined);
const mockGetVoices = jest.fn().mockResolvedValue([
  { ShortName: 'en-US-AvaNeural', FriendlyName: 'Microsoft Ava (Natural)', Locale: 'en-US', Gender: 'Female' },
  { ShortName: 'en-US-JennyNeural', FriendlyName: 'Microsoft Jenny (Natural)', Locale: 'en-US', Gender: 'Female' },
  { ShortName: 'en-US-GuyNeural', FriendlyName: 'Microsoft Guy (Natural)', Locale: 'en-US', Gender: 'Male' },
  { ShortName: 'en-GB-SoniaNeural', FriendlyName: 'Microsoft Sonia (Natural)', Locale: 'en-GB', Gender: 'Female' },
]);

jest.mock('msedge-tts', () => ({
  MsEdgeTTS: jest.fn().mockImplementation(() => ({
    setMetadata: mockSetMetadata,
    toFile: mockToFile,
    getVoices: mockGetVoices,
  })),
  OUTPUT_FORMAT: {
    AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'audio-24khz-96kbitrate-mono-mp3',
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

  test('succeeds with Edge TTS and returns voice metadata', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow({ success: true })]);
    const res = await speakHandler({ text: 'Hello world' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.textLength).toBe(11);
    expect(res.result.voice).toMatch(/Neural/);
  });

  test('calls toFile with correct text', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow({ success: true })]);
    await speakHandler({ text: 'Test speech' }, {} as any);
    expect(mockToFile).toHaveBeenCalledWith(
      expect.stringContaining('homebot-'),
      'Test speech',
      expect.any(Object)
    );
  });

  test('falls back to Web Speech API when Edge TTS fails', async () => {
    mockToFile.mockRejectedValueOnce(new Error('network error'));
    const win = fakeWindow({ success: true, voice: 'Microsoft Zira' });
    mockGetAllWindows.mockReturnValue([win]);
    const res = await speakHandler({ text: 'Fallback test' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.message).toMatch(/fallback/i);
    // UI needs to know we degraded
    expect(res.result.engine).toBe('web-speech');
    expect(res.result.usedFallback).toBe(true);
    expect(win.webContents.executeJavaScript).toHaveBeenCalled();
  });

  test('success result reports edge-neural engine and usedFallback flag', async () => {
    mockGetAllWindows.mockReturnValue([fakeWindow({ success: true })]);
    const res = await speakHandler({ text: 'Hi' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.engine).toBe('edge-neural');
    expect(typeof res.result.usedFallback).toBe('boolean');
  });

  test('returns failure when both Edge TTS and Web Speech fail', async () => {
    mockToFile.mockRejectedValueOnce(new Error('network error'));
    const win = fakeWindow(null);
    win.webContents.executeJavaScript.mockRejectedValue(new Error('renderer crashed'));
    mockGetAllWindows.mockReturnValue([win]);
    const res = await speakHandler({ text: 'Total failure' }, {} as any);
    expect(res.success).toBe(false);
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
  test('returns female English voices from Edge TTS', async () => {
    const res = await getVoicesHandler({}, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(3); // 3 female English voices in mock
    expect(res.result.voices[0].name).toBe('en-US-AvaNeural');
  });

  test('includes currentVoice in result', async () => {
    const res = await getVoicesHandler({}, {} as any);
    expect(res.result.currentVoice).toBeDefined();
  });

  test('returns failure when getVoices throws', async () => {
    mockGetVoices.mockRejectedValueOnce(new Error('network error'));
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
