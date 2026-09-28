/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import VoiceConversation from '../components/VoiceConversation';
import { whisperTranscribeOnce, type WhisperTranscribeOptions } from '../utils/speech';

jest.mock('../utils/speech', () => ({
  ...jest.requireActual('../utils/speech'),
  whisperTranscribeOnce: jest.fn(),
}));

const capture = whisperTranscribeOnce as jest.MockedFunction<typeof whisperTranscribeOnce>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.electron = {
    getSettings: jest.fn().mockResolvedValue({ voiceEngine: 'whisper', whisperModel: 'base', voiceLanguage: 'en' }),
    ttsStop: jest.fn().mockResolvedValue({ success: true }),
    stopSpeechRecognition: jest.fn().mockResolvedValue({ success: true }),
    ttsSpeak: jest.fn().mockResolvedValue({ success: true }),
  } as any;
});
afterEach(() => { delete (window as any).electron; });

function pendingCapture(deliverController = true) {
  const result = deferred<{ text: string }>();
  const cancel = jest.fn();
  let options!: WhisperTranscribeOptions;
  capture.mockImplementation(opts => {
    options = opts!;
    if (deliverController) opts?.onController?.({ cancel, stop: jest.fn() });
    return result.promise;
  });
  return { result, cancel, controller: () => options.onController?.({ cancel, stop: jest.fn() }) };
}

async function listen() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start listening' })); });
}

test('Stop cancels capture and discards a late transcription', async () => {
  const pending = pendingCapture();
  const send = jest.fn();
  render(<VoiceConversation open onClose={jest.fn()} onSendMessage={send} />);
  await listen();
  fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
  expect(pending.cancel).toHaveBeenCalledTimes(1);
  await act(async () => { pending.result.resolve({ text: 'Cancelled speech' }); });
  expect(send).not.toHaveBeenCalled();
});

test('Close stops capture and reopening cannot revive the old transcript', async () => {
  const pending = pendingCapture();
  const send = jest.fn();
  const props = { onClose: jest.fn(), onSendMessage: send };
  const view = render(<VoiceConversation open {...props} />);
  await listen();
  view.rerender(<VoiceConversation open={false} {...props} />);
  expect(pending.cancel).toHaveBeenCalledTimes(1);
  view.rerender(<VoiceConversation open {...props} />);
  await act(async () => { pending.result.resolve({ text: 'Old conversation' }); });
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Start listening' })).toBeEnabled();
});

test('Close button invalidates capture before the parent changes open', async () => {
  const pending = pendingCapture();
  const send = jest.fn();
  const close = jest.fn();
  render(<VoiceConversation open onClose={close} onSendMessage={send} />);
  await listen();
  fireEvent.click(screen.getByRole('button', { name: 'Close voice conversation' }));
  await act(async () => { pending.result.resolve({ text: 'After close' }); });
  expect(close).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});

test('a controller arriving after Stop is cancelled immediately', async () => {
  const pending = pendingCapture(false);
  render(<VoiceConversation open onClose={jest.fn()} onSendMessage={jest.fn()} />);
  await listen();
  fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
  act(() => { pending.controller(); });
  expect(pending.cancel).toHaveBeenCalledTimes(1);
  await act(async () => { pending.result.resolve({ text: '' }); });
});

test('Stop while settings are pending prevents any capture from starting', async () => {
  const settings = deferred<any>();
  (window.electron.getSettings as jest.Mock).mockReturnValue(settings.promise);
  render(<VoiceConversation open onClose={jest.fn()} onSendMessage={jest.fn()} />);
  await listen();
  fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
  await act(async () => { settings.resolve({ voiceEngine: 'whisper' }); });
  expect(capture).not.toHaveBeenCalled();
});

test('unmount cancels an active recording', async () => {
  const pending = pendingCapture();
  const view = render(<VoiceConversation open onClose={jest.fn()} onSendMessage={jest.fn()} />);
  await listen();
  view.unmount();
  expect(pending.cancel).toHaveBeenCalledTimes(1);
  await act(async () => { pending.result.resolve({ text: 'Unmounted' }); });
});

test('legacy Windows dictation Stop requests local process cancellation and ignores late text', async () => {
  const result = deferred<any>();
  (window.electron.getSettings as jest.Mock).mockResolvedValue({ voiceEngine: 'sapi' });
  (window.electron as any).startSpeechRecognition = jest.fn().mockReturnValue(result.promise);
  const send = jest.fn();
  render(<VoiceConversation open onClose={jest.fn()} onSendMessage={send} />);
  await listen();
  fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
  expect((window.electron as any).stopSpeechRecognition).toHaveBeenCalled();
  await act(async () => { result.resolve({ success: true, text: 'Old dictation' }); });
  expect(send).not.toHaveBeenCalled();
});

test('an active successful local capture sends exactly its recognized text', async () => {
  const pending = pendingCapture();
  const send = jest.fn();
  render(<VoiceConversation open onClose={jest.fn()} onSendMessage={send} />);
  await listen();
  await act(async () => { pending.result.resolve({ text: 'Hello from my microphone' }); });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith('Hello from my microphone');
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({ modelSize: 'base', language: 'en' }));
});

test('Stop speaking prevents a pending continuous conversation from restarting the microphone', async () => {
  const pending = pendingCapture();
  const speech = deferred<any>();
  (window.electron.ttsSpeak as jest.Mock).mockReturnValue(speech.promise);
  const props = { onClose: jest.fn(), onSendMessage: jest.fn() };
  const view = render(<VoiceConversation open {...props} />);
  fireEvent.click(screen.getByText('Continuous conversation'));
  await listen();
  await act(async () => { pending.result.resolve({ text: 'My question' }); });
  view.rerender(<VoiceConversation open {...props} lastAssistantMessage="Answer" />);
  fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
  await act(async () => { speech.resolve({ success: true }); });
  expect(capture).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Start listening' })).toBeEnabled();
});
