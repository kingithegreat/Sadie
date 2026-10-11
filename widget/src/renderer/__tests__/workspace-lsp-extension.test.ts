/** @jest-environment jsdom */
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { lspCompletion, lspHandles } from '../components/workspace/lsp/lspExtension';

test('LSP completion is used for Python files and maps server items onto CodeMirror options', async () => {
  const state = EditorState.create({ doc: 'import os\nos.pa' });
  const transport = jest.fn().mockResolvedValue({ success: true, from: 13, entries: [{ label: 'path', kind: 'module' }, { label: 'pardir', kind: 'variable', detail: 'str' }] });
  const result = await lspCompletion({ root: '/p', filePath: '/p/a.py' }, new CompletionContext(state, state.doc.length, false), transport);
  expect(transport).toHaveBeenCalledWith({ action: 'complete', root: '/p', path: '/p/a.py', content: 'import os\nos.pa', position: 15 });
  expect(result?.from).toBe(13);
  expect(result?.options).toEqual([{ label: 'path', type: 'module', detail: undefined, apply: undefined }, { label: 'pardir', type: 'variable', detail: 'str', apply: undefined }]);
});

test('non-Python files never reach the language server', async () => {
  expect(lspHandles({ root: '/p', filePath: '/p/a.ts' })).toBe(false);
  const state = EditorState.create({ doc: 'x.' });
  const transport = jest.fn();
  expect(await lspCompletion({ root: '/p', filePath: '/p/a.ts' }, new CompletionContext(state, 2, true), transport)).toBeNull();
  expect(transport).not.toHaveBeenCalled();
});
