/** @jest-environment jsdom */

import { render, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { ElectronAPI } from '../../shared/types';

const MOCK_DOC_BASE64 = Buffer.from('Quarterly review body', 'utf8').toString('base64');

class FakeFileReader {
  public result: string | ArrayBuffer | null = null;
  public onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;
  public onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;

  readAsDataURL(file: Blob) {
    setTimeout(() => {
      this.result = `data:${file.type || 'application/octet-stream'};base64,${MOCK_DOC_BASE64}`;
      this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
    }, 0);
  }
}

beforeEach(() => {
  Object.defineProperty(global, 'FileReader', { writable: true, value: FakeFileReader });
});

test('when no active conversation exists, sending a message creates conversation and persists messages', async () => {
  const fakeConv = {
    id: 'conv-test-1',
    title: 'Conversation',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mocks: Partial<ElectronAPI> = {
    getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space' }),
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [], activeConversationId: null } }),
    createConversation: jest.fn().mockResolvedValue({ success: true, data: fakeConv }),
    setActiveConversation: jest.fn().mockResolvedValue({ success: true }),
    addMessage: jest.fn().mockResolvedValue({ success: true }),
    sendStreamMessage: jest.fn().mockResolvedValue(undefined),
    subscribeToStream: jest.fn().mockReturnValue(() => {}),
    onMessage: jest.fn().mockReturnValue(() => {}),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' })
  };

  (window as any).electron = mocks as ElectronAPI;

  const { getByLabelText, getByText } = render(<App />);

  const textarea = getByLabelText('Message HomeBot') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: 'Persistence test' } });
  const sendButton = getByText('Send');
  fireEvent.click(sendButton);

  // createConversation should be invoked to create an active conversation
  await waitFor(() => expect((window as any).electron.createConversation).toHaveBeenCalled());

  // addMessage should be called at least twice: user + assistant placeholder
  await waitFor(() => expect((window as any).electron.addMessage).toHaveBeenCalledTimes(2));

  // Validate the first addMessage call used the created conversation id and role=user
  const firstCall = (window as any).electron.addMessage.mock.calls[0];
  expect(firstCall[0]).toBe(fakeConv.id);
  expect(firstCall[1].role).toBe('user');

  // Validate the second addMessage call used the created conversation id and role=assistant
  const secondCall = (window as any).electron.addMessage.mock.calls[1];
  expect(secondCall[0]).toBe(fakeConv.id);
  expect(secondCall[1].role).toBe('assistant');
});

test('first message uses created conversation id (not "default") in stream request', async () => {
  const fakeConv = {
    id: 'conv-coherence-test',
    title: 'Conversation',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const capturedStreamRequests: any[] = [];

  const mocks: Partial<ElectronAPI> = {
    getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space' }),
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [], activeConversationId: null } }),
    createConversation: jest.fn().mockResolvedValue({ success: true, data: fakeConv }),
    setActiveConversation: jest.fn().mockResolvedValue({ success: true }),
    addMessage: jest.fn().mockResolvedValue({ success: true }),
    sendStreamMessage: jest.fn().mockImplementation((req) => { capturedStreamRequests.push(req); return Promise.resolve(undefined); }),
    subscribeToStream: jest.fn().mockReturnValue(() => {}),
    onMessage: jest.fn().mockReturnValue(() => {}),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
  };

  (window as any).electron = mocks as ElectronAPI;

  const { getByLabelText, getByText } = render(<App />);

  const textarea = getByLabelText('Message HomeBot') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: 'First coherence message' } });
  fireEvent.click(getByText('Send'));

  await waitFor(() => expect(capturedStreamRequests.length).toBeGreaterThan(0));

  // The stream request must use the real conversation id, not 'default'
  expect(capturedStreamRequests[0].conversation_id).toBe(fakeConv.id);
});

test('sending an attached document includes document payload on the first stream request', async () => {
  const fakeConv = {
    id: 'conv-doc-test',
    title: 'Conversation',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const capturedStreamRequests: any[] = [];

  const mocks: Partial<ElectronAPI> = {
    getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space' }),
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [], activeConversationId: null } }),
    createConversation: jest.fn().mockResolvedValue({ success: true, data: fakeConv }),
    setActiveConversation: jest.fn().mockResolvedValue({ success: true }),
    addMessage: jest.fn().mockResolvedValue({ success: true }),
    sendStreamMessage: jest.fn().mockImplementation((req) => { capturedStreamRequests.push(req); return Promise.resolve(undefined); }),
    subscribeToStream: jest.fn().mockReturnValue(() => {}),
    onMessage: jest.fn().mockReturnValue(() => {}),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
  };

  (window as any).electron = mocks as ElectronAPI;

  const { getByLabelText, getByText, findByText } = render(<App />);

  const documentInput = getByLabelText('Attach documents') as HTMLInputElement;
  const file = new File(['Quarterly review body'], 'SADIE_Midpoint_Review.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  fireEvent.change(documentInput, { target: { files: [file] } });
  await findByText('SADIE_Midpoint_Review.docx');

  const textarea = getByLabelText('Message HomeBot') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: 'this was you what do i think?' } });
  fireEvent.click(getByText('Send'));

  await waitFor(() => expect(capturedStreamRequests.length).toBeGreaterThan(0));

  const payload = capturedStreamRequests[0];
  expect(payload.message).toContain('[Document attached: SADIE_Midpoint_Review.docx]');
  expect(payload.message).toContain('this was you what do i think?');
  expect(payload.documents).toHaveLength(1);
  expect(payload.documents[0]).toMatchObject({
    filename: 'SADIE_Midpoint_Review.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: file.size,
  });
  expect(payload.documents[0].data).toBe(MOCK_DOC_BASE64);
});