/** @jest-environment jsdom */
import { act, render } from '@testing-library/react';
import { EditorView } from 'codemirror';
import CodeEditor, { languageExtension } from '../components/workspace/CodeEditor';

// jsdom has no layout; CodeMirror only needs these to exist.
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  (Range.prototype as any).getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  (Range.prototype as any).getBoundingClientRect = () => rect;
});

const viewOf = (container: HTMLElement) => EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;

test('every language the Explorer reports gets a highlighter', () => {
  for (const lang of ['javascript', 'typescript', 'python', 'json', 'css', 'xml', 'html', 'markdown', 'sql', 'yaml',
    'rust', 'java', 'go', 'bash', 'powershell', 'ini', 'csharp']) {
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
