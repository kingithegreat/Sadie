/** @jest-environment jsdom */

/**
 * Proving the leak detector is actually REACHED.
 *
 * `shared/leaked-tool-calls.ts` is separately unit-tested, and a passing pure
 * function that nothing calls is this codebase's characteristic bug — so this
 * drives the real App, streams a real transcript through the real stream-end
 * handler, and asserts what ends up on screen.
 *
 * The transcript is verbatim from the conversation that reported it: HomeBot
 * printed Moonshot's native tool tokens and then said "Done", having executed
 * nothing.
 */

import { render, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import App from '../App';
import { ElectronAPI } from '../../shared/types';

const LEAKED_REPLY =
  "I'll run a safe test suite on the available developer tools. " +
  '<|tool_calls_section_begin|> <|tool_call_begin|> functions.run_terminal_command:0 ' +
  '<|tool_call_argument_begin|> {"command": "echo test"} <|tool_call_end|> ' +
  '<|tool_calls_section_end|>';

function mountApp() {
  let chunkHandler: ((d: any) => void) | undefined;
  let endHandler: ((d: any) => void) | undefined;
  let streamId: string | undefined;

  (window as any).electron = {
    cancelStream: jest.fn(),
    subscribeToStream: jest.fn((_sid: string, handlers: any) => {
      chunkHandler = handlers.onStreamChunk;
      endHandler = handlers.onStreamEnd;
      return jest.fn();
    }),
    getSettings: jest.fn().mockResolvedValue({
      alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space',
    }),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    sendStreamMessage: jest.fn((payload: any) => { streamId = payload.streamId; return Promise.resolve(); }),
    onMessage: jest.fn(() => jest.fn()),
    sendMessage: jest.fn(),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
  } as unknown as ElectronAPI;

  const utils = render(<App />);
  return {
    ...utils,
    send: async (text: string) => {
      const textarea = utils.getByLabelText('Message HomeBot') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: text } });
      fireEvent.click(utils.getByText('Send'));
      await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalled());
    },
    stream: async (chunk: string) => {
      await act(async () => { chunkHandler!({ chunk, streamId }); });
    },
    end: async (payload: any = {}) => {
      await act(async () => { endHandler!({ streamId, ...payload }); });
    },
  };
}

afterEach(() => { delete (window as any).electron; });

test('a leaked tool call is caught, stripped and corrected on screen', async () => {
  const app = mountApp();
  await app.send('do a tool call test try all avilable tools safely');
  await app.stream(LEAKED_REPLY);
  await app.end();

  const body = document.body.textContent || '';

  // The raw markup must not survive — a user should never see it, and a later
  // model must not read it back out of history and copy the pattern.
  expect(body).not.toContain('tool_call_begin');
  expect(body).not.toContain('functions.run_terminal_command:0');

  // The sentence the model actually wrote is kept.
  expect(body).toContain("I'll run a safe test suite");

  // And the correction is present, naming the tool and saying plainly that
  // nothing ran. This is the assertion the whole change exists for.
  expect(body).toMatch(/nothing was actually run/i);
  expect(body).toContain('run_terminal_command');
});

test('an ordinary reply is left completely alone', async () => {
  // If this ever fails, the detector is crying wolf and every good answer
  // gets a scary warning under it until people stop reading warnings.
  const app = mountApp();
  await app.send('hi');
  await app.stream('Hey! What\'s up?');
  await app.end();

  const body = document.body.textContent || '';
  expect(body).toContain("Hey! What's up?");
  expect(body).not.toMatch(/nothing was actually run/i);
});

test('a cancelled stream is not accused of leaking', async () => {
  // Cancelling mid-markup leaves a half-written tool call behind. That is the
  // user stopping it, not the model lying, and it must not be reported as one.
  const app = mountApp();
  await app.send('do a tool call test');
  await app.stream('Working on it <|tool_call_begin|> functions.list_directory:0');
  await app.end({ cancelled: true });

  const body = document.body.textContent || '';
  expect(body).not.toMatch(/nothing was actually run/i);
});
