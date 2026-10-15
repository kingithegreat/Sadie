/** @jest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';

// Keep the real App, Dashboard, ChatInterface, composer and conversation
// sidebar. Only the Settings destination and unrelated Quiz body are light
// fixtures; these tests prove App routing, not Settings' own form behavior.
jest.mock('../components/SettingsPanel', () => ({
  __esModule: true,
  default: function SettingsFixture({ onClose }: { onClose: () => void }) {
    return <section role="dialog" aria-label="Settings">
      <p>Settings overlay</p>
      <button type="button" onClick={onClose}>Close Settings</button>
    </section>;
  },
}));

jest.mock('../components/QuizPanel', () => ({
  __esModule: true,
  default: function QuizFixture() { return <section aria-label="Quiz workspace">Quiz workspace</section>; },
}));

const originalAnimationFrame = window.requestAnimationFrame;
let bridge: Record<string, jest.Mock>;
let endStream: ((payload: { streamId: string; cancelled: boolean }) => void) | undefined;

beforeEach(() => {
  endStream = undefined;
  const conversations = new Map<string, {
    id: string; title: string; messages: never[]; createdAt: string; updatedAt: string; messageCount: number;
  }>();
  let conversationNumber = 0;
  const settings = {
    firstRun: false, theme: 'dark', chatModel: 'qwen2.5:7b',
    useCustomLLM: false, uncensoredMode: false, modelRoutingMode: 'off',
  };
  bridge = {
    getSettings: jest.fn().mockResolvedValue(settings),
    saveSettings: jest.fn().mockResolvedValue({ success: true }),
    getWidgetMode: jest.fn().mockResolvedValue(true),
    toggleWidgetMode: jest.fn().mockResolvedValue(false),
    onWidgetModeChanged: jest.fn(() => jest.fn()),
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
    resolveActiveModel: jest.fn().mockResolvedValue({ success: true, source: 'local', model: 'qwen2.5:7b' }),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:7b' }] }),
    moduleList: jest.fn().mockResolvedValue({ ok: true, modules: [] }),
    loadConversations: jest.fn(async () => ({
      success: true, data: { conversations: Array.from(conversations.values()) },
    })),
    createConversation: jest.fn(async () => {
      const number = ++conversationNumber;
      const conversation = {
        id: `conversation-${number}`, title: `Conversation ${number}`, messages: [] as never[],
        createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', messageCount: 0,
      };
      conversations.set(conversation.id, conversation);
      return { success: true, data: conversation };
    }),
    getConversation: jest.fn(async (id: string) => ({ success: conversations.has(id), data: conversations.get(id) })),
    setActiveConversation: jest.fn().mockResolvedValue({ success: true }),
    saveConversation: jest.fn().mockResolvedValue({ success: true }),
    addMessage: jest.fn().mockResolvedValue({ success: true }),
    updateMessage: jest.fn().mockResolvedValue({ success: true }),
    sendStreamMessage: jest.fn().mockResolvedValue(undefined),
    subscribeToStream: jest.fn((_id: string, handlers: { onStreamEnd: typeof endStream }) => {
      endStream = handlers.onStreamEnd;
      return jest.fn();
    }),
    getCapabilityReport: jest.fn().mockResolvedValue({
      success: true,
      capabilities: [{
        id: 'local-chat', label: 'Answer on this PC', state: 'needs_setup',
        detail: 'Choose how HomeBot should answer.', navMode: 'settings',
      }],
      summary: { ready: 0, total: 1 },
    }),
  };
  (window as any).electron = bridge;
  // JSDOM focus scheduling, not a test-only App route.
  window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 0);
});

afterEach(() => {
  cleanup();
  delete (window as any).electron;
  window.requestAnimationFrame = originalAnimationFrame;
});

async function renderCompactApp() {
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true'));
  await waitFor(() => expect(bridge.setActiveConversation).toHaveBeenCalledWith('conversation-1'));
  expect(screen.getByTestId('homebot-app-root')).toHaveClass('widget-mode');
}

async function exploreHome() {
  fireEvent.click(screen.getByRole('button', { name: 'Explore HomeBot' }));
  await screen.findByRole('heading', { name: 'What would you like to do?' });
  expect(screen.getByTestId('homebot-app-root')).toHaveClass('expanded-mode');
}

async function startChat() {
  fireEvent.click(screen.getByRole('button', { name: 'Start with chat' }));
  const composer = await screen.findByRole('textbox', { name: 'Message HomeBot' });
  await waitFor(() => expect(composer).toHaveFocus());
  return composer;
}

async function attachTextFile(name: string, content: string) {
  const file = new File([content], name, { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText('Attach documents', { exact: true }), { target: { files: [file] } });
  await screen.findByText(name);
}

async function chooseConversation(title: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
  fireEvent.click(await screen.findByText(title));
}

test('normal compact Explore leads to Home and Start focuses the actual chat composer without creating another conversation', async () => {
  await renderCompactApp();
  expect(bridge.createConversation).toHaveBeenCalledTimes(1);
  await exploreHome();
  expect(bridge.toggleWidgetMode).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('textbox', { name: 'Message HomeBot' })).not.toBeInTheDocument();
  const composer = await startChat();
  expect(composer).toHaveValue('');
  expect(bridge.createConversation).toHaveBeenCalledTimes(1);
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test('an actual starter fills an editable draft and editing it does not send a request', async () => {
  await renderCompactApp();
  await exploreHome();
  const composer = await startChat();
  const starter = screen.getByRole('button', { name: 'Draft a message' });
  const prompt = starter.getAttribute('title');
  expect(prompt).toBeTruthy();
  fireEvent.click(starter);
  expect(composer).toHaveValue(prompt);
  expect(composer).toHaveFocus();
  fireEvent.change(composer, { target: { value: 'Politely decline tomorrow’s meeting and offer Friday afternoon.' } });
  expect(composer).toHaveValue('Politely decline tomorrow’s meeting and offer Friday afternoon.');
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.saveConversation).not.toHaveBeenCalled();
});

test('the actual Home/Chat navigation preserves an unfinished brief and its file attachment', async () => {
  await renderCompactApp();
  await exploreHome();
  const composer = await startChat();
  fireEvent.change(composer, { target: { value: 'Review my meeting notes and help me write a reply.' } });
  await attachTextFile('meeting-notes.txt', 'The meeting is at 10am. My alternative is Friday afternoon.');
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  await screen.findByRole('heading', { name: 'What would you like to do?' });
  expect(screen.queryByRole('textbox', { name: 'Message HomeBot' })).not.toBeInTheDocument();
  const restored = await startChat();
  expect(restored).toHaveValue('Review my meeting notes and help me write a reply.');
  expect(screen.getByText('meeting-notes.txt')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove meeting-notes.txt' })).toBeInTheDocument();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.createConversation).toHaveBeenCalledTimes(1);

  // The file still has its original bytes, not only a restored filename.
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(bridge.sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = bridge.sendStreamMessage.mock.calls[0][0];
  try {
    expect(request.conversation_id).toBe('conversation-1');
    expect(request.message).toBe('[Document attached: meeting-notes.txt]\n\nReview my meeting notes and help me write a reply.');
    expect(request.documents).toHaveLength(1);
    expect(request.documents[0]).toMatchObject({
      filename: 'meeting-notes.txt', mimeType: 'text/plain',
      data: btoa('The meeting is at 10am. My alternative is Friday afternoon.'),
    });
  } finally {
    act(() => { endStream?.({ streamId: request.streamId, cancelled: false }); });
  }
});

test('Home capability Settings action opens the App settings overlay while Home stays mounted instead of Quiz', async () => {
  await renderCompactApp();
  await exploreHome();
  expect(bridge.getCapabilityReport).not.toHaveBeenCalled();
  expect(screen.queryByTestId('cap-nav-local-chat')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Check setup and available features'));
  fireEvent.click(await screen.findByTestId('cap-nav-local-chat'));
  expect(bridge.getCapabilityReport).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'What would you like to do?' })).toBeInTheDocument();
  expect(screen.queryByText('Quiz workspace')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));
  expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
});

test('two conversations restore their own unsent text and attachments through the real sidebar', async () => {
  await renderCompactApp();
  await exploreHome();
  const composer = await startChat();
  fireEvent.change(composer, { target: { value: 'My first conversation draft.' } });
  await attachTextFile('first-notes.txt', 'First conversation attachment.');

  fireEvent.keyDown(window, { ctrlKey: true, key: 'n' });
  await waitFor(() => expect(bridge.setActiveConversation).toHaveBeenCalledWith('conversation-2'));
  expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('');
  expect(screen.queryByText('first-notes.txt')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message HomeBot' }), { target: { value: 'My second conversation draft.' } });
  await attachTextFile('second-notes.txt', 'Second conversation attachment.');

  await chooseConversation('Conversation 1');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('My first conversation draft.'));
  expect(bridge.getConversation).toHaveBeenCalledWith('conversation-1');
  expect(screen.getByText('first-notes.txt')).toBeInTheDocument();
  expect(screen.queryByText('second-notes.txt')).not.toBeInTheDocument();

  await chooseConversation('Conversation 2');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('My second conversation draft.'));
  expect(bridge.getConversation).toHaveBeenCalledWith('conversation-2');
  expect(screen.getByText('second-notes.txt')).toBeInTheDocument();
  expect(screen.queryByText('first-notes.txt')).not.toBeInTheDocument();
  expect(bridge.sendStreamMessage).not.toHaveBeenCalled();
  expect(bridge.saveConversation).not.toHaveBeenCalled();
});
