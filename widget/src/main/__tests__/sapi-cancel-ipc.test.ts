import { EventEmitter } from 'events';
import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import { registerSapiRecognitionIpc } from '../speech/sapi-ipc';

jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }));
jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('fs', () => ({ writeFileSync: jest.fn(), unlinkSync: jest.fn() }));

const handles = new Map<string, (event: any) => any>();
const children: { kill: jest.Mock; complete: (error: Error | null, text: string) => void }[] = [];
const eventFor = (id: number) => ({ sender: Object.assign(new EventEmitter(), { id }) });
const start = (event: any) => handles.get('homebot:start-speech-recognition')!(event);
const stop = (event: any) => handles.get('homebot:stop-speech-recognition')!(event);

beforeEach(() => {
  jest.clearAllMocks();
  handles.clear();
  children.length = 0;
  (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => handles.set(channel, handler));
  (execFile as unknown as jest.Mock).mockImplementation((_command, _args, _options, callback) => {
    const child = { kill: jest.fn().mockReturnValue(true), complete: callback };
    children.push(child);
    return child;
  });
  registerSapiRecognitionIpc();
});

test('Stop kills only the requesting renderer child, resolves cancelled and ignores late recognition', async () => {
  const first = eventFor(1);
  const second = eventFor(2);
  const firstResult = start(first);
  const secondResult = start(second);
  expect(stop(first)).toEqual({ success: true });
  expect(children[0].kill).toHaveBeenCalledTimes(1);
  expect(children[1].kill).not.toHaveBeenCalled();
  expect(await firstResult).toEqual({ success: false, text: '', cancelled: true });
  children[0].complete(null, 'Late cancelled text');
  children[1].complete(null, '  Active text  ');
  expect(await secondResult).toEqual({ success: true, text: 'Active text' });
  expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  expect(first.sender.listenerCount('destroyed')).toBe(0);
});

test('starting again replaces only that renderer capture', async () => {
  const event = eventFor(1);
  const first = start(event);
  const second = start(event);
  expect(await first).toMatchObject({ cancelled: true, text: '' });
  expect(children[0].kill).toHaveBeenCalledTimes(1);
  children[1].complete(null, 'Second attempt');
  expect(await second).toEqual({ success: true, text: 'Second attempt' });
});

test('destroying the renderer releases its microphone child and temporary file', async () => {
  const event = eventFor(4);
  const result = start(event);
  event.sender.emit('destroyed');
  expect(children[0].kill).toHaveBeenCalledTimes(1);
  expect(await result).toMatchObject({ cancelled: true, text: '' });
  expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
});

test('failed process cancellation is reported and never becomes a successful transcript', async () => {
  const event = eventFor(1);
  const result = start(event);
  children[0].kill.mockReturnValue(false);
  expect(stop(event)).toMatchObject({ success: false, error: expect.stringContaining('Could not stop') });
  children[0].complete(null, 'Must not be sent');
  expect(await result).toMatchObject({ success: false, text: '', cancelled: true });
});

test('no active capture is an idempotent successful Stop', () => {
  expect(stop(eventFor(20))).toEqual({ success: true });
  expect(execFile).not.toHaveBeenCalled();
});

test('local recognition retains its timeout, hidden window and script cleanup on errors', async () => {
  const event = eventFor(1);
  const result = start(event);
  expect(execFile).toHaveBeenCalledWith('powershell', expect.arrayContaining(['-NonInteractive', '-File']),
    { timeout: 20_000, windowsHide: true }, expect.any(Function));
  expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('homebot-voice-'), expect.stringContaining('System.Speech'), 'utf8');
  children[0].complete(new Error('timeout'), '');
  expect(await result).toEqual({ success: false, text: '', error: 'Speech recognition failed: timeout' });
  expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
});

test('script write failure does not spawn a child or retain a renderer listener', async () => {
  (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => { throw new Error('disk full'); });
  const event = eventFor(1);
  expect(await start(event)).toMatchObject({ success: false, text: '', error: expect.stringContaining('disk full') });
  expect(execFile).not.toHaveBeenCalled();
  expect(event.sender.listenerCount('destroyed')).toBe(0);
});
