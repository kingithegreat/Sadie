/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from 'codemirror';
import { undo, undoDepth } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView as CMEditorView } from '@codemirror/view';
import CodeEditor, {
  languageExtension,
  buildInlineEditPrompt,
  cleanCodeReplacement,
  computeSimpleLineDiff,
  type CodeEditorSession,
} from '../components/workspace/CodeEditor';

// jsdom has no layout; CodeMirror only needs these to exist.
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  (Range.prototype as any).getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  (Range.prototype as any).getBoundingClientRect = () => rect;
});

const viewOf = (container: HTMLElement) => EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;

test('every language the Explorer reports gets a highlighter', () => {
  for (const lang of ['javascript', 'typescript', 'python', 'json', 'css', 'xml', 'html', 'markdown', 'sql', 'yaml',
    'rust', 'java', 'go', 'bash', 'powershell', 'ini', 'csharp', 'lua', 'luau']) {
    expect(languageExtension(lang)).not.toEqual([]);
  }
  expect(languageExtension('plaintext')).toEqual([]);
});

test('edits report the new text, Ctrl+S saves, and a value from outside replaces the document', () => {
  const onChange = jest.fn();
  const onSave = jest.fn();
  const { container, rerender } = render(<CodeEditor value={'const a = 1;\n'} language="typescript" onChange={onChange} onSave={onSave} />);
  const view = viewOf(container);
  expect(container.querySelector('.cm-content')?.getAttribute('aria-label')).toBe('Code editor');

  act(() => { view.dispatch({ changes: { from: 0, to: 5, insert: 'let' } }); });
  expect(onChange).toHaveBeenLastCalledWith('let a = 1;\n');

  act(() => {
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
  });
  expect(onSave).toHaveBeenCalledTimes(1);

  rerender(<CodeEditor value={'other file\n'} language="markdown" onChange={onChange} onSave={onSave} />);
  expect(view.state.doc.toString()).toBe('other file\n');
});

test('read-only refuses edits from the keyboard', () => {
  const { container } = render(<CodeEditor value="fixed" language="plaintext" onChange={jest.fn()} onSave={jest.fn()} readOnly />);
  const view = viewOf(container);
  expect(view.state.readOnly).toBe(true);
  expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
});

test('restored editor state uses current handlers, compartments, read-only mode and theme', () => {
  const session: CodeEditorSession = { current: null };
  const oldChange = jest.fn();
  const oldSave = jest.fn();
  const first = render(<CodeEditor value="first" language="plaintext" onChange={oldChange} onSave={oldSave} session={session} />);
  act(() => { viewOf(first.container).dispatch({ changes: { from: 5, insert: ' edit' } }); });
  first.unmount();
  oldChange.mockClear();
  document.documentElement.setAttribute('data-theme', 'light');
  const nextChange = jest.fn();
  const nextSave = jest.fn();
  const second = render(<CodeEditor value="first edit" language="typescript" onChange={nextChange} onSave={nextSave} readOnly session={session} />);
  const view = viewOf(second.container);
  expect(undoDepth(view.state)).toBe(1);
  expect(view.state.readOnly).toBe(true);
  expect(view.state.facet(CMEditorView.darkTheme)).toBe(false);
  second.rerender(<CodeEditor value="first edit" language="json" onChange={nextChange} onSave={nextSave} session={session} />);
  expect(view.state.facet(EditorState.readOnly)).toBe(false);
  act(() => {
    expect(undo(view)).toBe(true);
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true,
    }));
  });
  expect(nextChange).toHaveBeenLastCalledWith('first');
  expect(nextSave).toHaveBeenCalledTimes(1);
  expect(oldChange).not.toHaveBeenCalled();
  expect(oldSave).not.toHaveBeenCalled();
  second.unmount();
  document.documentElement.removeAttribute('data-theme');
});

describe('IDE-5: Inline Edit (Ctrl+K)', () => {
  test('typing before or inside the target while generating refuses stale acceptance and preserves all bytes', async () => {
    let callbacks: any;
    (window as any).electron = { sendStreamMessage: jest.fn().mockResolvedValue({ success: true }), subscribeToStream: jest.fn((_id, handlers) => { callbacks = handlers; return jest.fn(); }), cancelStream: jest.fn() };
    const { container } = render(<CodeEditor value={'const first = 1;\nconst second = 2;\n'} language="typescript" onChange={jest.fn()} onSave={jest.fn()} />);
    const view = viewOf(container);
    act(() => { view.dispatch({ selection: { anchor: 17, head: 34 } }); view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); });
    fireEvent.change(screen.getByTestId('inline-edit-input'), { target: { value: 'rename second' } });
    await act(async () => { fireEvent.click(screen.getByTestId('inline-edit-submit-btn')); });
    act(() => { view.dispatch({ changes: { from: 0, insert: '// user edit\n' } }); callbacks.onStreamChunk({ chunk: 'const renamed = 2;' }); callbacks.onStreamEnd(); });
    const expected = view.state.doc.toString();
    fireEvent.click(screen.getByTestId('inline-edit-accept-btn'));
    expect(view.state.doc.toString()).toBe(expected);
    expect(screen.getByTestId('inline-edit-error')).toHaveTextContent('replacement was not applied');
  });

  test('rejected request displays recovery error and does not leave an active generation', async () => {
    (window as any).electron = { sendStreamMessage: jest.fn().mockRejectedValue(new Error('Connection failed')), subscribeToStream: jest.fn(() => jest.fn()) };
    const { container } = render(<CodeEditor value="const value = 1;" language="typescript" onChange={jest.fn()} onSave={jest.fn()} />);
    const view = viewOf(container);
    act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); });
    fireEvent.change(screen.getByTestId('inline-edit-input'), { target: { value: 'change value' } });
    await act(async () => { fireEvent.click(screen.getByTestId('inline-edit-submit-btn')); });
    expect(screen.getByTestId('inline-edit-error')).toHaveTextContent('Connection failed');
    expect(screen.queryByTestId('inline-edit-loading')).not.toBeInTheDocument();
    expect(view.state.doc.toString()).toBe('const value = 1;');
  });
  test('buildInlineEditPrompt packages instruction, language, and selected code snippet', () => {
    const prompt = buildInlineEditPrompt('convert to arrow function', 'function add(a, b) { return a + b; }', 'typescript');
    expect(prompt).toContain('INSTRUCTION:\nconvert to arrow function');
    expect(prompt).toContain('CURRENT CODE:\n```typescript\nfunction add(a, b) { return a + b; }\n```');
    expect(prompt).toContain('Output ONLY the replacement code');
  });

  test('cleanCodeReplacement strips opening/closing markdown code fences', () => {
    const wrapped = '```typescript\nconst result = add(1, 2);\n```';
    expect(cleanCodeReplacement(wrapped)).toBe('const result = add(1, 2);');

    const clean = 'const result = add(1, 2);';
    expect(cleanCodeReplacement(clean)).toBe('const result = add(1, 2);');
  });

  test('computeSimpleLineDiff calculates adds, removes, and equal lines', () => {
    const before = 'const a = 1;\nconst b = 2;\n';
    const after = 'const a = 1;\nconst b = 3;\n';
    const diff = computeSimpleLineDiff(before, after);

    expect(diff).toEqual([
      { type: 'equal', text: 'const a = 1;' },
      { type: 'remove', text: 'const b = 2;' },
      { type: 'add', text: 'const b = 3;' },
      { type: 'equal', text: '' },
    ]);
  });

  test('Mod-k opens inline edit bar, submit triggers assistant, accept replaces code and undo restores it', async () => {
    let streamCallback: any = null;
    const sendStreamMessage = jest.fn().mockResolvedValue({ success: true });
    const subscribeToStream = jest.fn((_id, cbs) => {
      streamCallback = cbs;
      return () => {};
    });

    (window as any).electron = {
      sendStreamMessage,
      subscribeToStream,
      cancelStream: jest.fn(),
    };

    const onChange = jest.fn();
    const { container } = render(
      <CodeEditor value={'const greeting = "hello";\nconsole.log(greeting);\n'} language="typescript" onChange={onChange} onSave={jest.fn()} />
    );
    const view = viewOf(container);

    // Select first line
    act(() => {
      view.dispatch({ selection: { anchor: 0, head: 25 } });
    });

    // Press Ctrl+K
    act(() => {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true }));
    });

    // Inline edit bar should be open
    expect(screen.getByTestId('code-inline-edit-bar')).toBeInTheDocument();
    expect(screen.getByText('Line 1')).toBeInTheDocument();

    const input = screen.getByTestId('inline-edit-input');
    act(() => {
      fireEvent.change(input, { target: { value: 'rename to message' } });
    });

    // Submit prompt
    await act(async () => {
      fireEvent.click(screen.getByTestId('inline-edit-submit-btn'));
    });

    expect(sendStreamMessage).toHaveBeenCalledTimes(1);
    expect(sendStreamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('rename to message'),
      })
    );

    // Stream response chunk and end
    act(() => {
      streamCallback?.onStreamChunk?.({ chunk: 'const message = "hello";' });
      streamCallback?.onStreamEnd?.();
    });

    // Diff preview should be visible
    expect(screen.getByTestId('code-inline-diff-preview')).toBeInTheDocument();
    expect(screen.getByTestId('inline-edit-accept-btn')).toBeInTheDocument();

    // Click Accept
    act(() => {
      fireEvent.click(screen.getByTestId('inline-edit-accept-btn'));
    });

    // Document should now have the replacement
    expect(view.state.doc.toString()).toBe('const message = "hello";\nconsole.log(greeting);\n');
    expect(onChange).toHaveBeenCalledWith('const message = "hello";\nconsole.log(greeting);\n');

    // Inline edit bar should be closed
    expect(screen.queryByTestId('code-inline-edit-bar')).not.toBeInTheDocument();

    // Undo (Ctrl+Z) restores original code
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe('const greeting = "hello";\nconsole.log(greeting);\n');
  });

  test('Reject dismisses inline edit and leaves document untouched', async () => {
    (window as any).electron = {
      sendStreamMessage: jest.fn(),
      subscribeToStream: jest.fn(),
      cancelStream: jest.fn(),
    };

    const onChange = jest.fn();
    const { container } = render(
      <CodeEditor value={'const count = 0;\n'} language="typescript" onChange={onChange} onSave={jest.fn()} />
    );
    const view = viewOf(container);

    // Trigger Ctrl+K
    act(() => {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(screen.getByTestId('code-inline-edit-bar')).toBeInTheDocument();

    // Click Close (✕)
    act(() => {
      fireEvent.click(screen.getByTestId('inline-edit-close-btn'));
    });

    // Bar closed, text unchanged
    expect(screen.queryByTestId('code-inline-edit-bar')).not.toBeInTheDocument();
    expect(view.state.doc.toString()).toBe('const count = 0;\n');
    expect(onChange).not.toHaveBeenCalled();
  });
});

