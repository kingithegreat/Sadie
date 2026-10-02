/** @jest-environment jsdom */
/**
 * ide-back-nav.test.tsx
 *
 * Inside the IDE (Code mode / the Workspace) there was no visible way back to
 * the main HomeBot interface: the shell covers the mode tabs, and its only exits
 * sat along the bottom edge. It now has a "Back" button in its header, Escape is
 * its keyboard path, and leaving no longer unmounts the shell, so open tabs and
 * unsaved edits are still there on return.
 *
 * The real CodeEditor (CodeMirror) is used on purpose: CodeMirror's content is a
 * contenteditable DIV, and the old tag-based Escape guard did not see it.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from 'codemirror';
import App from '../App';
import WorkspaceShell, { isWorkspaceBackEscape } from '../components/workspace/WorkspaceShell';

const ROOT = 'C:/proj';
const FILE = 'C:/proj/notes.ts';
const ORIGINAL = 'const saved = 1;\n';

// jsdom has no layout; CodeMirror only needs these to exist.
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  (Range.prototype as any).getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  (Range.prototype as any).getBoundingClientRect = () => rect;
});

function setupElectron() {
  const api = {
    // App
    getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space' }),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
    subscribeToStream: jest.fn(() => jest.fn()),
    onMessage: jest.fn(() => jest.fn()),
    // Workspace
    workspaceRoot: jest.fn(async () => ({ success: true, path: ROOT })),
    workspaceList: jest.fn(async (dir: string) => (
      dir === ROOT
        ? { success: true, path: ROOT, entries: [{ name: 'notes.ts', path: FILE, isDirectory: false }] }
        : { success: false, error: 'Not a directory.' }
    )),
    workspaceRead: jest.fn(async () => ({ success: true, content: ORIGINAL, language: 'typescript' })),
    workspaceSave: jest.fn(async () => ({ success: true })),
    onAssistantToolActivity: jest.fn(() => () => {}),
  };
  (window as any).electron = api;
  return api;
}

afterEach(() => {
  delete (window as any).electron;
  // WorkspaceShell portals into document.body, which testing-library's cleanup
  // does not reach — a stale shell would double every query.
  document.body.innerHTML = '';
});

const shell = () => document.querySelector('.workspace-shell');
const modeButton = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button.mode-btn'))
    .find(b => b.textContent?.trim() === label)!;
const editorView = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
const backButton = () => screen.getByRole('button', { name: 'Back to HomeBot' });

async function renderApp() {
  const api = setupElectron();
  render(<App />);
  await waitFor(() => expect(modeButton('Code')).toBeTruthy());
  return api;
}

async function enterCode() {
  fireEvent.click(modeButton('Code'));
  await waitFor(() => expect(shell()).not.toBeNull());
  await screen.findByRole('button', { name: 'Back to HomeBot' });
}

/** Opens notes.ts from the Explorer. */
async function openNotes() {
  fireEvent.click(await screen.findByRole('treeitem', { name: /notes\.ts/ }));
  await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull());
}

/** Opens notes.ts and types into it without saving. */
async function openAndEdit() {
  await openNotes();
  act(() => {
    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'const unsaved = 2;\n' } });
  });
  expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
}

describe('IDE Back control (App)', () => {
  test('Back in the IDE header returns to the main interface', async () => {
    await renderApp();
    expect(modeButton('Chat')).toHaveClass('active');

    await enterCode();
    expect(backButton()).toHaveAttribute('title', 'Back to HomeBot (Esc)');
    fireEvent.click(backButton());

    await waitFor(() => expect(shell()).toBeNull());
    expect(modeButton('Chat')).toHaveClass('active');
    expect(modeButton('Code')).not.toHaveClass('active');
    expect(screen.getByLabelText('Message HomeBot')).toBeInTheDocument();
  });

  test('Back returns to the view the user came from, not always chat', async () => {
    await renderApp();
    fireEvent.click(modeButton('Home'));
    await waitFor(() => expect(modeButton('Home')).toHaveClass('active'));

    await enterCode();
    fireEvent.click(backButton());

    await waitFor(() => expect(shell()).toBeNull());
    expect(modeButton('Home')).toHaveClass('active');
  });

  test('Escape (the IDE\'s existing shortcut) goes back too, including after Ctrl+Shift+K', async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(shell()).not.toBeNull());

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(shell()).toBeNull());
    expect(modeButton('Chat')).toHaveClass('active');
  });

  test('unsaved edits and open tabs are still there after Back and returning', async () => {
    const api = await renderApp();
    await enterCode();
    await openAndEdit();

    fireEvent.click(backButton());
    await waitFor(() => expect(shell()).toBeNull());
    expect(modeButton('Chat')).toHaveClass('active');

    await enterCode();
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull());
    expect(editorView().state.doc.toString()).toBe(`${ORIGINAL}const unsaved = 2;\n`);
    expect(screen.getByRole('tab', { name: /notes\.ts/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
    // The tab was kept, not re-read from disk over the edit, and nothing saved.
    expect(api.workspaceRead).toHaveBeenCalledTimes(1);
    expect(api.workspaceSave).not.toHaveBeenCalled();
  });

  test('Escape leaves with a dirty file and the edit survives', async () => {
    await renderApp();
    await enterCode();
    await openAndEdit();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(shell()).toBeNull());

    await enterCode();
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull());
    expect(editorView().state.doc.toString()).toContain('const unsaved = 2;');
  });

  test('the header Workspace button opens the same IDE, with the same edits', async () => {
    await renderApp();
    await enterCode();
    await openAndEdit();
    fireEvent.click(backButton());
    await waitFor(() => expect(shell()).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull());
    expect(editorView().state.doc.toString()).toContain('const unsaved = 2;');
    // Back from the overlay closes it and leaves the mode underneath alone.
    fireEvent.click(backButton());
    await waitFor(() => expect(shell()).toBeNull());
    expect(modeButton('Chat')).toHaveClass('active');
  });

  test('Escape inside the editor stays with the editor', async () => {
    await renderApp();
    await enterCode();
    // A clean file on purpose: the old guard only held while the file was
    // dirty, and CodeMirror's contenteditable DIV passed its tag check.
    await openNotes();

    const content = document.querySelector('.cm-content') as HTMLElement;
    content.focus();
    fireEvent.keyDown(content, { key: 'Escape' });

    expect(shell()).not.toBeNull();
    expect(modeButton('Code')).toHaveClass('active');
  });

  test('Escape with the unsaved-changes prompt open closes only the prompt; Cancel keeps you in the IDE', async () => {
    await renderApp();
    await enterCode();
    await openAndEdit();

    // The IDE's existing confirm pattern: closing a dirty tab asks first.
    fireEvent.click(screen.getByRole('button', { name: 'Close notes.ts' }));
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Close “notes.ts” without saving?');

    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(shell()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close notes.ts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(shell()).not.toBeNull();
    expect(modeButton('Code')).toHaveClass('active');
    expect(editorView().state.doc.toString()).toContain('const unsaved = 2;');
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
  });
});

describe('WorkspaceShell Back wiring', () => {
  test('the header Back button calls onBack, not onClose or onHome', async () => {
    setupElectron();
    const onBack = jest.fn();
    const onClose = jest.fn();
    const onHome = jest.fn();
    render(<WorkspaceShell open onClose={onClose} onHome={onHome} onBack={onBack} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Back to HomeBot' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onHome).not.toHaveBeenCalled();
  });

  test('without onBack, Back falls back to onClose', async () => {
    setupElectron();
    const onClose = jest.fn();
    render(<WorkspaceShell open onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to HomeBot' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape that a field, the editor or a modal owns is not a Back', () => {
    const key = (init: KeyboardEventInit, target: EventTarget = document.body) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      Object.defineProperty(e, 'target', { value: target });
      return e;
    };
    expect(isWorkspaceBackEscape(key({ key: 'Escape' }))).toBe(true);
    expect(isWorkspaceBackEscape(key({ key: 'Enter' }))).toBe(false);
    expect(isWorkspaceBackEscape(key({ key: 'Escape', shiftKey: true }))).toBe(false);

    const handled = key({ key: 'Escape' });
    handled.preventDefault();
    expect(isWorkspaceBackEscape(handled)).toBe(false);

    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isWorkspaceBackEscape(key({ key: 'Escape' }, input))).toBe(false);

    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const button = document.createElement('button');
    editor.appendChild(button);
    document.body.appendChild(editor);
    expect(isWorkspaceBackEscape(key({ key: 'Escape' }, button))).toBe(false);

    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    expect(isWorkspaceBackEscape(key({ key: 'Escape' }))).toBe(false);
  });

  test('hidden (open=false) renders nothing and ignores Escape', async () => {
    setupElectron();
    const onBack = jest.fn();
    const { rerender } = render(<WorkspaceShell open onClose={jest.fn()} onBack={onBack} />);
    await screen.findByRole('button', { name: 'Back to HomeBot' });

    rerender(<WorkspaceShell open={false} onClose={jest.fn()} onBack={onBack} />);
    expect(shell()).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onBack).not.toHaveBeenCalled();
  });
});
