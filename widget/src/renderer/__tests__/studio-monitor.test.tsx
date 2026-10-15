/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StudioMonitor } from '../components/StudioMonitor';

let fullscreenElement: Element | null;
const enter = jest.fn();
const exit = jest.fn();
const props = () => ({ playing: false, onPlayingChange: jest.fn(), time: 2, duration: 10, onSeek: jest.fn(), onError: jest.fn() });

beforeEach(() => {
  fullscreenElement = null;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: enter });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  enter.mockReset().mockImplementation(function (this: HTMLElement) {
    fullscreenElement = this;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  exit.mockReset().mockImplementation(() => {
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
});

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
  for (const key of ['fullscreenElement', 'fullscreenEnabled', 'exitFullscreen']) Reflect.deleteProperty(document, key);
});

test('fullscreen includes preview, play/pause, seek and exit; Escape synchronizes state and returns focus', async () => {
  const callbacks = props();
  render(<StudioMonitor {...callbacks}><video aria-label="Preview" /></StudioMonitor>);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enter timeline fullscreen' })));
  expect(fullscreenElement).toBe(screen.getByTestId('studio-monitor'));
  expect(fullscreenElement?.querySelector('video')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Play timeline preview' }));
  expect(callbacks.onPlayingChange).toHaveBeenCalledWith(true);
  fireEvent.change(screen.getByRole('slider', { name: 'Timeline fullscreen position' }), { target: { value: '6' } });
  expect(callbacks.onSeek).toHaveBeenCalledWith(6);
  // Browser Escape exits fullscreen independently of our button.
  act(() => { fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')); });
  expect(screen.queryByRole('slider')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Enter timeline fullscreen' }));
});

test('explicit Exit fullscreen calls the browser and keeps the normal preview', async () => {
  render(<StudioMonitor {...props()}><video /></StudioMonitor>);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enter timeline fullscreen' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Exit timeline fullscreen' })));
  expect(exit).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('studio-monitor').querySelector('video')).not.toBeNull();
});

test('Escape explicitly exits only this monitor fullscreen and returns focus', async () => {
  render(<StudioMonitor {...props()}><video /></StudioMonitor>);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(exit).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enter timeline fullscreen' })));
  await act(async () => fireEvent.keyDown(document, { key: 'Escape' }));
  expect(exit).toHaveBeenCalledTimes(1);
  expect(fullscreenElement).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Enter timeline fullscreen' }));
});

test('Escape exit rejection reports a retry action without claiming fullscreen exited', async () => {
  const callbacks = props();
  render(<StudioMonitor {...callbacks}><video /></StudioMonitor>);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enter timeline fullscreen' })));
  exit.mockRejectedValueOnce(new Error('denied'));
  await act(async () => fireEvent.keyDown(document, { key: 'Escape' }));
  expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('Could not exit fullscreen'));
  expect(screen.getByRole('button', { name: 'Exit timeline fullscreen' })).toBeInTheDocument();
});

test('rejected fullscreen reports a friendly error and leaves retry available', async () => {
  enter.mockRejectedValueOnce(new Error('denied'));
  const callbacks = props();
  render(<StudioMonitor {...callbacks}><video /></StudioMonitor>);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enter timeline fullscreen' })));
  expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('Could not change fullscreen'));
  expect(screen.getByRole('button', { name: 'Enter timeline fullscreen' })).not.toBeDisabled();
});

test('unavailable fullscreen is visibly disabled', () => {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
  render(<StudioMonitor {...props()}><video /></StudioMonitor>);
  expect(screen.getByRole('button', { name: 'Enter timeline fullscreen' })).toBeDisabled();
  expect(enter).not.toHaveBeenCalled();
});
