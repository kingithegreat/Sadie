/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceAssistantPanel, { MAX_FILE_CHARS, buildWorkspacePrompt } from '../components/workspace/WorkspaceAssistantPanel';

describe('buildWorkspacePrompt', () => {
  test('attached files come first, fenced with their language, then the question', () => {
    const prompt = buildWorkspacePrompt('  Why is beta wrong?  ', [
      { kind: 'file', path: 'C:/proj/app.ts', name: 'app.ts', content: 'const beta = 2;', language: 'typescript' },
      { kind: 'folder', path: 'C:/proj', entries: ['src/', 'app.ts'] },
    ]);
    expect(prompt).toContain('File: C:/proj/app.ts\n```typescript\nconst beta = 2;\n```');
    expect(prompt).toContain('Folder: C:/proj\nContains:\n- src/\n- app.ts');
    expect(prompt.endsWith('Why is beta wrong?')).toBe(true);
  });

  test('a huge file is truncated and says so; no context means just the question', () => {
    const big = 'x'.repeat(MAX_FILE_CHARS + 500);
    const prompt = buildWorkspacePrompt('q', [{ kind: 'file', path: 'big.txt', name: 'big.txt', content: big, language: 'plaintext' }]);
    expect(prompt).toContain('(truncated: 500 more characters)');
    expect(prompt.length).toBeLessThan(MAX_FILE_CHARS + 400);
    expect(buildWorkspacePrompt('just this', [])).toBe('just this');
  });
});

describe('WorkspaceAssistantPanel', () => {
  let handlers: any;
  let sent: any[];
  beforeEach(() => {
    sent = [];
    (window as any).electron = {
      subscribeToStream: jest.fn((_id: string, h: any) => { handlers = h; return jest.fn(); }),
      sendStreamMessage: jest.fn(async (req: any) => { sent.push(req); }),
      cancelStream: jest.fn(),
      workspaceList: jest.fn(async () => ({ success: true, entries: [{ name: 'src', isDirectory: true }] })),
    };
  });
  afterEach(() => { delete (window as any).electron; });

  const files = [
    { path: 'C:/proj/app.ts', name: 'app.ts', content: 'const beta = 3; // UNSAVED edit', language: 'typescript' },
    { path: 'C:/proj/util.ts', name: 'util.ts', content: 'export const u = 1;', language: 'typescript' },
  ];

  test('attaching the current file sends its editor content (unsaved edits included) and streams the answer', async () => {
    render(<WorkspaceAssistantPanel root="C:/proj" files={files} activePath="C:/proj/app.ts" onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Add context'), { target: { value: 'file:C:/proj/app.ts' } });
    expect(screen.getByRole('list', { name: 'Attached context' })).toHaveTextContent('app.ts');
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'What does beta do?' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ conversation_id: 'workspace:C:/proj', user_id: 'desktop_user' });
    expect(sent[0].message).toContain('const beta = 3; // UNSAVED edit');
    expect(sent[0].message).not.toContain('export const u = 1;'); // not attached
    expect(sent[0].message.endsWith('What does beta do?')).toBe(true);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    act(() => { handlers.onStreamChunk({ chunk: 'Beta is ' }); handlers.onStreamChunk({ chunk: 'three.' }); handlers.onStreamEnd({}); });
    expect(screen.getByRole('log', { name: 'Assistant conversation' })).toHaveTextContent('Beta is three.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  test('a folder attaches its listing, and a stream error is shown', async () => {
    render(<WorkspaceAssistantPanel root="C:/proj" files={files} activePath={null} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Add context'), { target: { value: 'folder:C:/proj' } });
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'Overview?' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Ask the assistant'), { key: 'Enter', ctrlKey: true }); });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].message).toContain('Folder: C:/proj\nContains:\n- src/');
    act(() => { handlers.onStreamError({ message: 'No model is available.' }); });
    expect(screen.getByRole('log', { name: 'Assistant conversation' })).toHaveTextContent('No model is available.');
  });
});
