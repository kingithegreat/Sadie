/** @jest-environment jsdom */
/**
 * action-confirmation.test.tsx
 * Tests for src/renderer/components/ActionConfirmation.tsx
 */

import { render, screen, fireEvent } from '@testing-library/react';
import ActionConfirmation from '../components/ActionConfirmation';

const noop = () => {};

describe('ActionConfirmation', () => {
  test('renders action summary text', () => {
    render(
      <ActionConfirmation
        actionSummary="Delete file notes.txt"
        onConfirm={noop}
        onReject={noop}
      />
    );
    expect(screen.getByText('Delete file notes.txt')).toBeInTheDocument();
  });

  test('renders the modal header', () => {
    render(
      <ActionConfirmation
        actionSummary="Launch app"
        onConfirm={noop}
        onReject={noop}
      />
    );
    expect(screen.getByText('⚠️ Confirm Action')).toBeInTheDocument();
  });

  test('renders Confirm and Cancel buttons', () => {
    render(
      <ActionConfirmation
        actionSummary="Move file"
        onConfirm={noop}
        onReject={noop}
      />
    );
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  test('calls onConfirm when Confirm button is clicked', () => {
    const onConfirm = jest.fn();
    render(
      <ActionConfirmation
        actionSummary="Do something"
        onConfirm={onConfirm}
        onReject={noop}
      />
    );
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('calls onReject when Cancel button is clicked', () => {
    const onReject = jest.fn();
    render(
      <ActionConfirmation
        actionSummary="Do something"
        onConfirm={noop}
        onReject={onReject}
      />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  test('calls onReject when Escape key is pressed', () => {
    const onReject = jest.fn();
    render(
      <ActionConfirmation
        actionSummary="Press escape"
        onConfirm={noop}
        onReject={onReject}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  test('does NOT call onReject for non-Escape keys', () => {
    const onReject = jest.fn();
    render(
      <ActionConfirmation
        actionSummary="Key test"
        onConfirm={noop}
        onReject={onReject}
      />
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onReject).not.toHaveBeenCalled();
  });

  test('renders warnings list when warnings are provided', () => {
    const warnings = ['This action is irreversible', 'Will affect 5 files'];
    render(
      <ActionConfirmation
        actionSummary="Delete everything"
        warnings={warnings}
        onConfirm={noop}
        onReject={noop}
      />
    );
    expect(screen.getByText('This action is irreversible')).toBeInTheDocument();
    expect(screen.getByText('Will affect 5 files')).toBeInTheDocument();
    expect(screen.getByText('Warnings:')).toBeInTheDocument();
  });

  test('does not render warnings section when warnings is empty', () => {
    render(
      <ActionConfirmation
        actionSummary="Safe action"
        warnings={[]}
        onConfirm={noop}
        onReject={noop}
      />
    );
    expect(screen.queryByText('Warnings:')).not.toBeInTheDocument();
  });

  test('does not render warnings section when warnings is not provided', () => {
    render(
      <ActionConfirmation
        actionSummary="Safe action"
        onConfirm={noop}
        onReject={noop}
      />
    );
    expect(screen.queryByText('Warnings:')).not.toBeInTheDocument();
  });

  test('removes keydown listener on unmount', () => {
    const onReject = jest.fn();
    const { unmount } = render(
      <ActionConfirmation
        actionSummary="Unmount test"
        onConfirm={noop}
        onReject={onReject}
      />
    );
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onReject).not.toHaveBeenCalled();
  });
});
