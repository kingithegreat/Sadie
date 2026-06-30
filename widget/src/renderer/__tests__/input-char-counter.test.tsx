/** @jest-environment jsdom */

import { render, fireEvent } from '@testing-library/react';
import { InputBox } from '../components/InputBox';

beforeEach(() => {
  (window as any).electron = {
    writeClipboard: jest.fn(),
    whisperTranscribe: jest.fn().mockResolvedValue({ text: '' }),
    ragIndexFile: jest.fn(),
    ttsSpeak: jest.fn().mockResolvedValue(undefined),
    ttsStop: jest.fn().mockResolvedValue(undefined),
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
  };
});
afterEach(() => { delete (window as any).electron; });

const noop = () => {};

describe('InputBox — character counter', () => {
  test('renders character counter showing 0 / 4000 by default', () => {
    const { container } = render(<InputBox onSendMessage={noop} />);
    const counter = container.querySelector('.char-counter');
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toBe('0 / 4000');
  });

  test('counter updates as user types', () => {
    const { container } = render(<InputBox onSendMessage={noop} />);
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    const counter = container.querySelector('.char-counter');
    expect(counter!.textContent).toBe('5 / 4000');
  });

  test('counter gets warning class above 3000 chars', () => {
    const { container } = render(<InputBox onSendMessage={noop} />);
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'a'.repeat(3001) } });
    const counter = container.querySelector('.char-counter');
    expect(counter!.classList.contains('warning')).toBe(true);
    expect(counter!.classList.contains('danger')).toBe(false);
  });

  test('counter gets danger class above 3800 chars', () => {
    const { container } = render(<InputBox onSendMessage={noop} />);
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'a'.repeat(3801) } });
    const counter = container.querySelector('.char-counter');
    expect(counter!.classList.contains('danger')).toBe(true);
  });

  test('textarea has maxLength of 4000', () => {
    const { container } = render(<InputBox onSendMessage={noop} />);
    const textarea = container.querySelector('textarea')!;
    expect(textarea.getAttribute('maxLength')).toBe('4000');
  });
});
