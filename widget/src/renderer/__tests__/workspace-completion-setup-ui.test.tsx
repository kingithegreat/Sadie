/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from 'codemirror';
import CodeEditor from '../components/workspace/CodeEditor';
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  (Range.prototype as any).getClientRects = () => [];
  (Range.prototype as any).getBoundingClientRect = () => rect;
});
afterEach(() => localStorage.clear());
const viewOf = (container: HTMLElement) => EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
const setup = { model: 'qwen2.5-coder:1.5b-base', sizeGB: 1, command: 'ollama pull qwen2.5-coder:1.5b-base' };

test('a missing completion model shows an install prompt; installing is an explicit click', async () => {
  const workspaceCodeComplete = jest.fn().mockResolvedValue({ success: true, text: '', reason: 'The small completion model is not installed.', setup });
  const workspaceCodeCompleteSetup = jest.fn().mockResolvedValue({ success: true, installed: true, model: setup.model });
  (window as any).electron = { workspaceCodeComplete, workspaceCodeCompleteSetup };
  const { container } = render(<CodeEditor root="/p" filePath="/p/a.ts" value="const x = " language="typescript" onChange={jest.fn()} onSave={jest.fn()} />);
  fireEvent.click(screen.getByText('Editor settings'));
  fireEvent.click(screen.getByLabelText(/Local AI suggestions/));
  act(() => viewOf(container).dispatch({ selection: { anchor: 10 } }));
  await act(async () => fireEvent.click(screen.getByText('Suggest code')));
  const prompt = screen.getByTestId('completion-setup');
  expect(prompt).toHaveTextContent('qwen2.5-coder:1.5b-base (~1 GB)');
  expect(prompt).toHaveTextContent('ollama pull qwen2.5-coder:1.5b-base');
  expect(workspaceCodeCompleteSetup).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByText('Install qwen2.5-coder:1.5b-base')));
  expect(workspaceCodeCompleteSetup).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('completion-setup')).toBeNull();
  expect(screen.getByText(/installed. Suggestions will appear/)).toBeInTheDocument();
});

test('a ready suggestion reports its latency and the running p50', async () => {
  (window as any).electron = { workspaceCodeComplete: jest.fn().mockResolvedValue({ success: true, text: '1;', latencyMs: 240, stats: { count: 5, p50Ms: 210, p95Ms: 400, lastMs: 240 } }) };
  const { container } = render(<CodeEditor root="/p" filePath="/p/a.ts" value="const x = " language="typescript" onChange={jest.fn()} onSave={jest.fn()} />);
  fireEvent.click(screen.getByText('Editor settings'));
  fireEvent.click(screen.getByLabelText(/Local AI suggestions/));
  act(() => viewOf(container).dispatch({ selection: { anchor: 10 } }));
  await act(async () => fireEvent.click(screen.getByText('Suggest code')));
  expect(screen.getByText(/Local suggestion ready \(240 ms; p50 210 ms over 5\)/)).toBeInTheDocument();
});
