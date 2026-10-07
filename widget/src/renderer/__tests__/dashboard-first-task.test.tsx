/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DashboardPanel from '../components/DashboardPanel';
import type { Capability } from '../../shared/capability-report';

function installBridge(destination = 'settings') {
  const capabilities: Capability[] = [{
    id: 'setup-needed',
    label: 'Feature needs setup',
    state: 'needs_setup',
    detail: 'Set this feature up before using it.',
    navMode: destination,
  }];
  (window as any).electron = {
    getSettings: jest.fn().mockResolvedValue({ chatModel: 'local-fallback', customLLM: { model: 'online-model' } }),
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [] } }),
    getCapabilityReport: jest.fn().mockResolvedValue({ success: true, capabilities, summary: { ready: 0, total: 1 } }),
  };
}

afterEach(() => { delete (window as any).electron; });

async function clickRemedy() {
  fireEvent.click(screen.getByText('Check setup and available features'));
  fireEvent.click(await screen.findByTestId('cap-nav-setup-needed'));
}

test('Home runs setup diagnostics only after opening the native setup disclosure', async () => {
  installBridge();
  const onStartChat = jest.fn();
  render(<DashboardPanel onModeChange={jest.fn()} onStartChat={onStartChat} onNewConversation={jest.fn()} />);
  const setupSummary = screen.getByText('Check setup and available features');
  const disclosure = setupSummary.closest('details')!;
  expect(disclosure).not.toHaveAttribute('open');
  expect((window as any).electron.getCapabilityReport).not.toHaveBeenCalled();
  expect(screen.queryByTestId('cap-nav-setup-needed')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Start with chat' }));
  expect(onStartChat).toHaveBeenCalledTimes(1);
  expect((window as any).electron.getCapabilityReport).not.toHaveBeenCalled();

  fireEvent.click(setupSummary);
  expect(await screen.findByTestId('cap-nav-setup-needed')).toBeVisible();
  expect(disclosure).toHaveAttribute('open');
  expect((window as any).electron.getCapabilityReport).toHaveBeenCalledTimes(1);
  fireEvent.click(setupSummary);
  await waitFor(() => expect(screen.queryByTestId('cap-nav-setup-needed')).not.toBeInTheDocument());
  expect(disclosure).not.toHaveAttribute('open');
  expect(screen.queryByTestId('cap-nav-setup-needed')).not.toBeInTheDocument();
  expect((window as any).electron.getCapabilityReport).toHaveBeenCalledTimes(1);
});

test('Home settings remedy opens Settings without navigating to a fake mode', async () => {
  installBridge('settings');
  const onOpenSettings = jest.fn();
  const onModeChange = jest.fn();
  render(<DashboardPanel onModeChange={onModeChange} onOpenSettings={onOpenSettings} onNewConversation={jest.fn()} />);
  await clickRemedy();
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
  expect(onModeChange).not.toHaveBeenCalled();
});

test('Home video remedy opens the canonical Media Studio mode', async () => {
  installBridge('studio');
  const onModeChange = jest.fn();
  render(<DashboardPanel onModeChange={onModeChange} onNewConversation={jest.fn()} />);
  await clickRemedy();
  expect(onModeChange).toHaveBeenCalledTimes(1);
  expect(onModeChange).toHaveBeenCalledWith('media');
  expect(onModeChange).not.toHaveBeenCalledWith('studio');
});

test.each(['image', 'code', 'automation'])('existing %s remedy keeps its real destination', async destination => {
  installBridge(destination);
  const onModeChange = jest.fn();
  render(<DashboardPanel onModeChange={onModeChange} onNewConversation={jest.fn()} />);
  await clickRemedy();
  expect(onModeChange).toHaveBeenCalledTimes(1);
  expect(onModeChange).toHaveBeenCalledWith(destination);
});

test('an unknown remedy leaves Home in place and explains how to continue', async () => {
  installBridge('unknown-workspace');
  const onModeChange = jest.fn();
  render(<DashboardPanel onModeChange={onModeChange} onNewConversation={jest.fn()} />);
  await clickRemedy();
  expect(onModeChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('That workspace is not available.');
  expect(screen.getByRole('button', { name: 'Start with chat' })).toBeInTheDocument();
});

test('a missing Settings callback reports recovery without a bogus mode change', async () => {
  installBridge('settings');
  const onModeChange = jest.fn();
  render(<DashboardPanel onModeChange={onModeChange} onNewConversation={jest.fn()} />);
  await clickRemedy();
  expect(onModeChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Settings could not be opened.');
});

test('start stays available during activity loading and preserves the existing conversation', async () => {
  installBridge();
  let resolveSettings!: (settings: object) => void;
  (window as any).electron.getSettings = jest.fn().mockReturnValue(new Promise(resolve => { resolveSettings = resolve; }));
  const onStartChat = jest.fn();
  const onNewConversation = jest.fn();
  const onModeChange = jest.fn();
  render(<DashboardPanel onModeChange={onModeChange} onStartChat={onStartChat} onNewConversation={onNewConversation} />);
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Start with chat' }));
    expect(onStartChat).toHaveBeenCalledTimes(1);
    expect(onNewConversation).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
  } finally {
    await act(async () => { resolveSettings({ chatModel: 'local' }); });
  }
});

test('start still reaches chat when no activity bridge is available', async () => {
  const onModeChange = jest.fn();
  const onNewConversation = jest.fn();
  await act(async () => {
    render(<DashboardPanel onModeChange={onModeChange} onNewConversation={onNewConversation} />);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start with chat' }));
  expect(onModeChange).toHaveBeenCalledWith('chat');
  expect(onNewConversation).not.toHaveBeenCalled();
});

test('optional details keep workspace actions reachable without claiming a cloud fallback is active', async () => {
  installBridge();
  const onModeChange = jest.fn();
  render(<DashboardPanel onModeChange={onModeChange} onNewConversation={jest.fn()} />);
  fireEvent.click(screen.getByText('Explore workspaces'));
  fireEvent.click(screen.getByRole('button', { name: /Code Workspace/ }));
  expect(onModeChange).toHaveBeenCalledWith('code');
  fireEvent.click(screen.getByText('Your activity'));
  expect(await screen.findByText('Local chat model')).toBeInTheDocument();
  expect(screen.getByText('local-fallback')).toBeInTheDocument();
  expect(screen.queryByText('Active Model')).not.toBeInTheDocument();
});
