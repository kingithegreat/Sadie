import React from 'react';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../components/MessageBubble';
import type { ChatMessage } from '../types';

const baseMessage: ChatMessage = {
  id: '1',
  role: 'assistant',
  content: 'Hello world',
  createdAt: Date.now(),
  streamingState: 'finished',
};

test('renders validated confidence badge when reflection accepted', () => {
  render(
    <MessageBubble
      message={{
        ...baseMessage,
        reflection: { confidence: 0.85, accepted: true, threshold: 0.7 },
      }}
      onCancel={() => {}}
      onRetry={() => {}}
    />,
  );
  expect(screen.getByText(/Validated result/i)).toBeInTheDocument();
  expect(screen.getByText(/Confidence: 85% \(accepted\)/i)).toBeInTheDocument();
});

test('renders low-confidence badge when not accepted', () => {
  render(
    <MessageBubble
      message={{
        ...baseMessage,
        reflection: { confidence: 0.4, accepted: false, threshold: 0.7 },
      }}
      onCancel={() => {}}
      onRetry={() => {}}
    />,
  );
  expect(screen.getByText(/Unvalidated \/ low-confidence result/i)).toBeInTheDocument();
  expect(screen.getByText(/Confidence: 40% \(rejected\)/i)).toBeInTheDocument();
});

test('clamps confidence <0 to 0%', () => {
  render(
    <MessageBubble
      message={{
        ...baseMessage,
        reflection: { confidence: -0.5, accepted: false, threshold: 0.7 },
      }}
      onCancel={() => {}}
      onRetry={() => {}}
    />,
  );
  expect(screen.getByText(/Confidence: 0% \(rejected\)/i)).toBeInTheDocument();
});

test('clamps confidence >1 to 100%', () => {
  render(
    <MessageBubble
      message={{
        ...baseMessage,
        reflection: { confidence: 1.5, accepted: false, threshold: 0.7 },
      }}
      onCancel={() => {}}
      onRetry={() => {}}
    />,
  );
  expect(screen.getByText(/Confidence: 100% \(rejected\)/i)).toBeInTheDocument();
});

test('shows — for null/invalid confidence', () => {
  render(
    <MessageBubble
      message={{
        ...baseMessage,
        reflection: { confidence: null, accepted: false, threshold: 0.7 },
      }}
      onCancel={() => {}}
      onRetry={() => {}}
    />,
  );
  expect(screen.getByText(/Not evaluated/i)).toBeInTheDocument();
  expect(screen.getByText(/Confidence: —/i)).toBeInTheDocument();
});
