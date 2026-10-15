/** @jest-environment jsdom */

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import InputBox, { createEmptyComposerDraft, type ComposerDraft } from '../components/InputBox';
import { whisperTranscribeOnce, type RecordingController, type VoiceEngine, type WhisperTranscribeOptions } from '../utils/speech';

jest.mock('../utils/speech', () => ({
  ...jest.requireActual('../utils/speech'),
  whisperTranscribeOnce: jest.fn(),
}));

type BrowserRecognition = InstanceType<Window['SpeechRecognition']>;
type SpeechReply = { success: boolean; text: string; error?: string };

function held<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let recognitions: FakeRecognition[];
class FakeRecognition extends EventTarget implements BrowserRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: BrowserRecognition['onstart'] = jest.fn();
  onend: BrowserRecognition['onend'] = jest.fn();
  onresult: BrowserRecognition['onresult'] = jest.fn();
  onerror: BrowserRecognition['onerror'] = jest.fn();
  start = jest.fn(() => this.onstart());
  stop = jest.fn();
  abort = jest.fn(() => { this.onerror(Object.assign(new Event('error'), { error: 'aborted' })); this.onend(); });
  constructor() { super(); recognitions.push(this); }
}

function result(recognition: FakeRecognition, text: string, isFinal = true) {
  const alternative = { transcript: text, confidence: 1 };
  const entry = { isFinal, length: 1, 0: alternative, item: () => alternative };
  recognition.onresult(Object.assign(new Event('result'), {
    resultIndex: 0, results: { length: 1, 0: entry, item: () => entry },
  }));
}

function Composer({ onSend }: { onSend: jest.Mock }) {
  const [key, setKey] = useState('A');
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft>>({
    A: { ...createEmptyComposerDraft(), text: 'A draft' },
    B: { ...createEmptyComposerDraft(), text: 'B draft' },
  });
  return <>
    <button onClick={() => setKey('A')}>Chat A</button>
    <button onClick={() => setKey('B')}>Chat B</button>
    <output aria-label="Retained A draft">{drafts.A.text}</output>
    <output aria-label="Retained B draft">{drafts.B.text}</output>
    <InputBox draftKey={key} draft={drafts[key]} onDraftChange={next => setDrafts(previous => ({ ...previous, [key]: next }))} onSendMessage={onSend} />
  </>;
}

let bridge: {
  getSettings: jest.Mock;
  getUncensoredMode: jest.Mock;
  startSpeechRecognition: jest.Mock;
  stopSpeechRecognition: jest.Mock;
};

beforeEach(() => {
  jest.useFakeTimers();
  recognitions = [];
  (whisperTranscribeOnce as jest.Mock).mockReset();
  window.SpeechRecognition = FakeRecognition;
  bridge = {
    getSettings: jest.fn().mockResolvedValue({ voiceEngine: 'whisper' }),
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    startSpeechRecognition: jest.fn(),
    stopSpeechRecognition: jest.fn().mockResolvedValue({ success: true }),
  };
  (window as any).electron = bridge;
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  delete (window as any).electron;
  delete (window as any).SpeechRecognition;
});

function input() { return screen.getByRole('textbox', { name: 'Message HomeBot' }); }
function switchTo(key: 'A' | 'B') { fireEvent.click(screen.getByRole('button', { name: `Chat ${key}` })); }
function advanceSend() { act(() => { jest.advanceTimersByTime(101); }); }

async function start(engine: VoiceEngine, autoSend = false) {
  bridge.getSettings.mockResolvedValue({ voiceEngine: engine });
  if (autoSend) fireEvent.click(screen.getByRole('button', { name: 'Auto-send after voice is off' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voice input' })); });
}

function prepare(engine: VoiceEngine) {
  const completion = held<{ text: string }>();
  const sapi = held<SpeechReply>();
  const controller: RecordingController = { stop: jest.fn(), cancel: jest.fn() };
  let options!: WhisperTranscribeOptions;
  (whisperTranscribeOnce as jest.Mock).mockImplementation((next: WhisperTranscribeOptions) => {
    options = next;
    options.onController?.(controller);
    return completion.promise;
  });
  bridge.startSpeechRecognition.mockReturnValue(sapi.promise);
  return {
    controller,
    get options() { return options; },
    async finish(text = 'recognized words') {
      await act(async () => {
        if (engine === 'whisper') completion.resolve({ text });
        else if (engine === 'sapi') sapi.resolve({ success: true, text });
        else { result(recognitions[0], text); recognitions[0].onend(); }
      });
    },
    async fail() {
      await act(async () => {
        if (engine === 'whisper') completion.reject(new Error('stale engine error'));
        else if (engine === 'sapi') sapi.reject(new Error('stale engine error'));
        else recognitions[0].onerror(Object.assign(new Event('error'), { error: 'network' }));
      });
    },
  };
}

const engines: VoiceEngine[] = ['whisper', 'sapi', 'webspeech'];

describe.each(engines)('%s composer session', engine => {
  test.each([false, true])('late transcript cannot change or send B (auto-send: %s)', async autoSend => {
    const onSend = jest.fn();
    const operation = prepare(engine);
    render(<Composer onSend={onSend} />);
    await start(engine, autoSend);
    switchTo('B');
    if (engine === 'whisper') expect(operation.controller.cancel).toHaveBeenCalledTimes(1);
    if (engine === 'sapi') expect(bridge.stopSpeechRecognition).toHaveBeenCalledTimes(1);
    if (engine === 'webspeech') expect(recognitions[0].abort).toHaveBeenCalledTimes(1);
    await operation.finish();
    advanceSend();
    expect(input()).toHaveValue('B draft');
    expect(screen.getByLabelText('Retained A draft')).toHaveTextContent('A draft');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Voice input' })).toBeInTheDocument();
  });

  test('A to B to A does not reauthorize the original session', async () => {
    const onSend = jest.fn();
    const operation = prepare(engine);
    render(<Composer onSend={onSend} />);
    await start(engine, true);
    switchTo('B');
    switchTo('A');
    await operation.finish();
    advanceSend();
    expect(input()).toHaveValue('A draft');
    expect(onSend).not.toHaveBeenCalled();
  });

  test.each([false, true])('current completed transcript preserves explicit auto-send choice (%s)', async autoSend => {
    const onSend = jest.fn();
    const operation = prepare(engine);
    render(<Composer onSend={onSend} />);
    await start(engine, autoSend);
    await operation.finish();
    expect(onSend).not.toHaveBeenCalled();
    advanceSend();
    if (autoSend) {
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith('A draft recognized words', undefined, undefined);
      expect(input()).toHaveValue('');
    } else {
      expect(onSend).not.toHaveBeenCalled();
      expect(input()).toHaveValue('A draft recognized words');
    }
  });

  test('old failure cannot stop or report an error over a newer session', async () => {
    const onSend = jest.fn();
    const old = prepare(engine);
    render(<Composer onSend={onSend} />);
    await start(engine);
    switchTo('B');
    const fresh = prepare(engine);
    await start(engine);
    await old.fail();
    if (engine === 'webspeech') act(() => { recognitions[0].onstart(); recognitions[0].onend(); });
    expect(screen.getByRole('button', { name: /Stop listening/ })).toBeInTheDocument();
    expect(screen.queryByText(/stale engine error|requires internet connection/)).toBeNull();
    if (engine === 'webspeech') {
      act(() => { result(recognitions[1], 'fresh words'); recognitions[1].onend(); });
    } else await fresh.finish('fresh words');
    expect(input()).toHaveValue('B draft fresh words');
    expect(onSend).not.toHaveBeenCalled();
  });

  test('unmount cancels the owned engine and ignores offscreen completion', async () => {
    const onSend = jest.fn();
    const operation = prepare(engine);
    const view = render(<Composer onSend={onSend} />);
    await start(engine, true);
    view.unmount();
    if (engine === 'whisper') expect(operation.controller.cancel).toHaveBeenCalledTimes(1);
    if (engine === 'sapi') expect(bridge.stopSpeechRecognition).toHaveBeenCalledTimes(1);
    if (engine === 'webspeech') expect(recognitions[0].abort).toHaveBeenCalledTimes(1);
    await operation.finish();
    advanceSend();
    expect(onSend).not.toHaveBeenCalled();
  });
});

test.each(['navigation', 'stop', 'unmount'])('a pending Settings reply cannot start capture after %s', async action => {
  const settings = held<{ voiceEngine: VoiceEngine }>();
  bridge.getSettings.mockReturnValueOnce(settings.promise);
  const onSend = jest.fn();
  const view = render(<Composer onSend={onSend} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voice input' })); });
  if (action === 'navigation') { switchTo('B'); switchTo('A'); }
  else if (action === 'stop') fireEvent.click(screen.getByRole('button', { name: /Stop listening/ }));
  else view.unmount();
  await act(async () => { settings.resolve({ voiceEngine: 'whisper' }); });
  expect(whisperTranscribeOnce).not.toHaveBeenCalled();
  expect(bridge.startSpeechRecognition).not.toHaveBeenCalled();
  expect(recognitions).toHaveLength(0);
  expect(onSend).not.toHaveBeenCalled();
});

test('late Whisper permission/controller is cancelled without replacing the current B controller', async () => {
  const first = held<{ text: string }>();
  const second = held<{ text: string }>();
  const callbacks: WhisperTranscribeOptions[] = [];
  (whisperTranscribeOnce as jest.Mock).mockImplementationOnce((options: WhisperTranscribeOptions) => { callbacks.push(options); return first.promise; })
    .mockImplementationOnce((options: WhisperTranscribeOptions) => { callbacks.push(options); return second.promise; });
  const oldController: RecordingController = { stop: jest.fn(), cancel: jest.fn() };
  const newController: RecordingController = { stop: jest.fn(), cancel: jest.fn() };
  render(<Composer onSend={jest.fn()} />);
  await start('whisper');
  switchTo('B');
  await start('whisper');
  act(() => { callbacks[1].onController?.(newController); callbacks[0].onController?.(oldController); callbacks[0].onStatus?.('stale recording status'); });
  expect(oldController.cancel).toHaveBeenCalledTimes(1);
  expect(newController.cancel).not.toHaveBeenCalled();
  expect(screen.queryByText('stale recording status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Stop listening/ }));
  expect(newController.stop).toHaveBeenCalledTimes(1);
  expect(oldController.stop).not.toHaveBeenCalled();
  await act(async () => { first.resolve({ text: 'old words' }); second.resolve({ text: 'valid stopped words' }); });
  expect(input()).toHaveValue('B draft valid stopped words');
});

test('manual Stop before a Whisper controller arrives finishes that recording once without cancellation', async () => {
  const completion = held<{ text: string }>();
  let options!: WhisperTranscribeOptions;
  (whisperTranscribeOnce as jest.Mock).mockImplementation(next => { options = next; return completion.promise; });
  const controller: RecordingController = { stop: jest.fn(), cancel: jest.fn() };
  const onSend = jest.fn();
  render(<Composer onSend={onSend} />);
  await start('whisper', true);
  fireEvent.click(screen.getByRole('button', { name: /Stop listening/ }));
  act(() => { options.onController?.(controller); });
  expect(controller.stop).toHaveBeenCalledTimes(1);
  expect(controller.cancel).not.toHaveBeenCalled();
  await act(async () => { completion.resolve({ text: 'stopped transcript' }); });
  advanceSend();
  expect(onSend).toHaveBeenCalledWith('A draft stopped transcript', undefined, undefined);
});

test('WebSpeech combines final events and sends exactly once on a normal end after manual Stop', async () => {
  const onSend = jest.fn();
  render(<Composer onSend={onSend} />);
  await start('webspeech', true);
  act(() => { result(recognitions[0], 'interim words', false); result(recognitions[0], 'first final'); });
  advanceSend();
  expect(onSend).not.toHaveBeenCalled();
  act(() => { result(recognitions[0], 'second final'); });
  fireEvent.click(screen.getByRole('button', { name: /Stop listening/ }));
  expect(recognitions[0].stop).toHaveBeenCalledTimes(1);
  act(() => { recognitions[0].onend(); recognitions[0].onend(); });
  advanceSend();
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith('A draft first final second final', undefined, undefined);
});

test.each(['interim', 'network', 'aborted'])('WebSpeech %s cannot auto-send on end', async ending => {
  const onSend = jest.fn();
  render(<Composer onSend={onSend} />);
  await start('webspeech', true);
  act(() => {
    result(recognitions[0], 'heard words', ending !== 'interim');
    if (ending !== 'interim') recognitions[0].onerror(Object.assign(new Event('error'), { error: ending }));
    recognitions[0].onend();
  });
  advanceSend();
  expect(onSend).not.toHaveBeenCalled();
});

test.each(['navigation', 'manual-send', 'new-session', 'new-edit', 'unmount'])('a queued auto-send is cancelled by %s', async action => {
  const onSend = jest.fn();
  const operation = prepare('whisper');
  const view = render(<Composer onSend={onSend} />);
  await start('whisper', true);
  await operation.finish();
  if (action === 'navigation') { switchTo('B'); switchTo('A'); }
  else if (action === 'manual-send') fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  else if (action === 'new-session') {
    prepare('whisper');
    await start('whisper');
  } else if (action === 'new-edit') fireEvent.change(input(), { target: { value: 'Newer words after dictation.' } });
  else view.unmount();
  advanceSend();
  expect(onSend).toHaveBeenCalledTimes(action === 'manual-send' ? 1 : 0);
  if (action === 'new-edit') expect(input()).toHaveValue('Newer words after dictation.');
});
