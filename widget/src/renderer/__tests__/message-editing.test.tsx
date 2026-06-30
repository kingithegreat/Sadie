/** @jest-environment jsdom */

import { render, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../components/MessageBubble';
import type { ChatMessage } from '../types';

beforeEach(() => {
  (window as any).electron = {
    writeClipboard: jest.fn(),
    ttsSpeak: jest.fn().mockResolvedValue(undefined),
    ttsStop: jest.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => { delete (window as any).electron; });

const noop = () => {};

function makeUserMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'u1',
    role: 'user',
    content: 'Hello there',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('MessageBubble — message editing', () => {
  test('context menu has Edit option for user messages when onEdit provided', () => {
    const { container } = render(
      <MessageBubble message={makeUserMsg()} onCancel={noop} onRetry={noop} onEdit={noop} />
    );
    const wrapper = container.querySelector('.message-wrapper')!;
    fireEvent.contextMenu(wrapper);
    const menuItems = container.querySelectorAll('.context-menu-item');
    const labels = Array.from(menuItems).map(el => el.textContent);
    expect(labels.some(l => l?.includes('Edit'))).toBe(true);
  });

  test('context menu does NOT have Edit option when onEdit is omitted', () => {
    const { container } = render(
      <MessageBubble message={makeUserMsg()} onCancel={noop} onRetry={noop} />
    );
    const wrapper = container.querySelector('.message-wrapper')!;
    fireEvent.contextMenu(wrapper);
    const menuItems = container.querySelectorAll('.context-menu-item');
    const labels = Array.from(menuItems).map(el => el.textContent);
    expect(labels.some(l => l?.includes('Edit'))).toBe(false);
  });

  test('clicking Edit shows textarea with current content', () => {
    const { container } = render(
      <MessageBubble message={makeUserMsg({ content: 'Original text' })} onCancel={noop} onRetry={noop} onEdit={noop} />
    );
    const wrapper = container.querySelector('.message-wrapper')!;
    fireEvent.contextMenu(wrapper);
    const editItem = Array.from(container.querySelectorAll('.context-menu-item')).find(el => el.textContent?.includes('Edit'));
    fireEvent.click(editItem!);
    const textarea = container.querySelector('.message-edit-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('Original text');
  });

  test('clicking Save calls onEdit with new content', () => {
    const onEdit = jest.fn();
    const { container } = render(
      <MessageBubble message={makeUserMsg({ content: 'Original' })} onCancel={noop} onRetry={noop} onEdit={onEdit} />
    );
    // Open edit mode via context menu
    fireEvent.contextMenu(container.querySelector('.message-wrapper')!);
    const editItem = Array.from(container.querySelectorAll('.context-menu-item')).find(el => el.textContent?.includes('Edit'));
    fireEvent.click(editItem!);
    // Change content
    const textarea = container.querySelector('.message-edit-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Updated text' } });
    // Click save
    const saveBtn = container.querySelector('.edit-save-btn')!;
    fireEvent.click(saveBtn);
    expect(onEdit).toHaveBeenCalledWith('u1', 'Updated text');
  });

  test('Cancel button closes edit mode without calling onEdit', () => {
    const onEdit = jest.fn();
    const { container } = render(
      <MessageBubble message={makeUserMsg()} onCancel={noop} onRetry={noop} onEdit={onEdit} />
    );
    fireEvent.contextMenu(container.querySelector('.message-wrapper')!);
    const editItem = Array.from(container.querySelectorAll('.context-menu-item')).find(el => el.textContent?.includes('Edit'));
    fireEvent.click(editItem!);
    expect(container.querySelector('.message-edit-textarea')).not.toBeNull();
    // Click cancel
    const cancelBtn = Array.from(container.querySelectorAll('.message-edit-actions .message-action-btn')).find(el => el.textContent === 'Cancel');
    fireEvent.click(cancelBtn!);
    expect(container.querySelector('.message-edit-textarea')).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  test('[edited] label shown when message has edited flag', () => {
    const { container } = render(
      <MessageBubble message={makeUserMsg({ edited: true })} onCancel={noop} onRetry={noop} />
    );
    const timestamp = container.querySelector('.message-timestamp');
    expect(timestamp?.textContent).toContain('[edited]');
  });

  test('[edited] label NOT shown when message is not edited', () => {
    const { container } = render(
      <MessageBubble message={makeUserMsg()} onCancel={noop} onRetry={noop} />
    );
    const timestamp = container.querySelector('.message-timestamp');
    expect(timestamp?.textContent).not.toContain('[edited]');
  });
});
