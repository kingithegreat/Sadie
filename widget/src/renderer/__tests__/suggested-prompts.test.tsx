/** @jest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react';
import SuggestedPrompts from '../components/SuggestedPrompts';

afterEach(() => { delete (window as any).electron; });

test('shows the same four plain starting points immediately without setup or history', () => {
  const { rerender } = render(<SuggestedPrompts onSelect={jest.fn()} />);
  const labels = () => screen.getAllByRole('button').map(button => button.textContent);
  expect(labels()).toEqual(['Draft a message', 'Explain something', 'Plan a task', 'Brainstorm ideas']);
  rerender(<SuggestedPrompts onSelect={jest.fn()} />);
  expect(labels()).toEqual(['Draft a message', 'Explain something', 'Plan a task', 'Brainstorm ideas']);
  expect(screen.getByText('Choose a starting point. Edit it before you send.')).toBeInTheDocument();
});

test('does not replay operational requests from prior conversations or make background requests', () => {
  const loadConversations = jest.fn().mockResolvedValue({
    success: true,
    data: { conversations: [{ messages: [
      { role: 'user', content: 'Delete all files on my Desktop' },
      { role: 'user', content: 'Run npm test in my project folder' },
      { role: 'user', content: 'Generate an image using my online account' },
    ] }] },
  });
  const sendToHomeBotStream = jest.fn();
  (window as any).electron = { loadConversations, sendToHomeBotStream };
  render(<SuggestedPrompts onSelect={jest.fn()} />);
  expect(loadConversations).not.toHaveBeenCalled();
  expect(sendToHomeBotStream).not.toHaveBeenCalled();
  expect(screen.queryByText(/Delete all files|Run npm test|online account/)).not.toBeInTheDocument();
});

test('selection provides complete editable wording only when the user chooses it', () => {
  const onSelect = jest.fn();
  render(<SuggestedPrompts onSelect={onSelect} />);
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Draft a message' }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith('Help me draft a short, polite message. Ask me who it is for and what I want to say.');
});

test.each(['Explain something', 'Plan a task', 'Brainstorm ideas'])(
  '%s does not submit a literal missing-content placeholder', label => {
    const onSelect = jest.fn();
    render(<SuggestedPrompts onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    const prompt = onSelect.mock.calls[0][0] as string;
    expect(prompt).toMatch(/^Help me /);
    expect(prompt).toContain('Ask me ');
    expect(prompt).not.toMatch(/\[|\]|clipboard|calendar|npm|generate an image|search the web/i);
  },
);
