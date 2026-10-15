/** @jest-environment jsdom */
import { whisperTranscribeOnce } from '../utils/speech';

test('cancelling when asynchronous microphone permission resolves stops tracks and skips transcription', async () => {
  const stopTrack = jest.fn();
  const closeContext = jest.fn();
  let resolvePermission!: (stream: any) => void;
  const permission = new Promise<any>(resolve => { resolvePermission = resolve; });
  const originalDevices = navigator.mediaDevices;
  const originalRecorder = globalThis.MediaRecorder;
  const originalContext = globalThis.AudioContext;
  let recorder: any;
  class Recorder {
    state = 'inactive';
    onstop?: () => void;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.onstop?.(); }
    constructor() { recorder = this; }
  }
  class Context {
    close = closeContext;
    createMediaStreamSource() { return { connect: jest.fn(), disconnect: jest.fn() }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData: jest.fn() }; }
  }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: jest.fn().mockReturnValue(permission) } });
  globalThis.MediaRecorder = Recorder as any;
  globalThis.AudioContext = Context as any;
  const transcribe = jest.fn();
  window.electron = { whisperTranscribe: transcribe } as any;
  let capture: Promise<{ text: string }> | undefined;
  try {
    capture = whisperTranscribeOnce({ onController: controller => controller.cancel() });
    resolvePermission({ getTracks: () => [{ stop: stopTrack }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(await capture).toEqual({ text: '' });
    expect(transcribe).not.toHaveBeenCalled();
  } finally {
    // Ensure even the broken baseline probe releases its mocked timer.
    recorder?.stop();
    await capture;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalDevices });
    globalThis.MediaRecorder = originalRecorder;
    globalThis.AudioContext = originalContext;
    delete (window as any).electron;
  }
});
