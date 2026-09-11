/** @jest-environment jsdom */
/**
 * code-mode-reachability.test.tsx
 *
 * Track F — asserts reachability of the coding platform front door:
 * 1. StatusIndicator: Code button rendered in ModeSwitcher with dedicated 'code' icon.
 * 2. StatusIndicator: Code button click navigates to 'code' mode.
 * 3. DashboardPanel: 'Code Workspace' quick action rendered and navigates to 'code'.
 * 4. WorkspaceShell: Status-bar Home button invokes onHome instead of blindly closing to chat.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import StatusIndicator from '../components/StatusIndicator';
import DashboardPanel from '../components/DashboardPanel';
import WorkspaceShell from '../components/workspace/WorkspaceShell';
import type { ConnectionStatus } from '../../shared/types';

beforeAll(() => {
  (window as any).electron = {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    startOllama: jest.fn(),
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [] } }),
    loadQuizProgress: jest.fn().mockResolvedValue({ success: true, data: {} }),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    getSettings: jest.fn().mockResolvedValue({}),
    getAnalyticsSummary: jest.fn().mockResolvedValue({ success: true }),
    getCrmDashboard: jest.fn().mockResolvedValue(null),
    workspaceList: jest.fn().mockResolvedValue({ success: true, path: 'C:\\test', entries: [] }),
    workspaceRoot: jest.fn().mockResolvedValue({ success: true, path: 'C:\\test' }),
    workspaceRead: jest.fn().mockResolvedValue({ success: true, path: 'C:\\test\\index.ts', content: '' }),
    onAssistantToolActivity: () => () => undefined,
  };
});

afterAll(() => {
  delete (window as any).electron;
});

const onlineStatus: ConnectionStatus = { n8n: 'online', ollama: 'online' } as any;

describe('Track F — Code Mode Reachability', () => {
  describe('StatusIndicator Mode Switcher', () => {
    it('renders a Code mode button with dedicated code icon and triggers onModeChange', async () => {
      const onModeChange = jest.fn();
      await act(async () => {
        render(
          <StatusIndicator
            connectionStatus={onlineStatus}
            onRefresh={jest.fn()}
            onSettingsClick={jest.fn()}
            mode="chat"
            onModeChange={onModeChange}
          />
        );
      });

      const codeBtn = screen.getByRole('button', { name: /Code/i });
      expect(codeBtn).toBeInTheDocument();

      // Ensure the button renders the dedicated 'code' icon (angle brackets),
      // not the duplicated 'terminal' icon
      const svg = codeBtn.querySelector('svg');
      expect(svg).toBeInTheDocument();
      // 'code' icon SVG path has angle brackets (m16 18 6-6-6-6)
      const pathEl = svg?.querySelector('path');
      expect(pathEl?.getAttribute('d')).toContain('m16 18');

      fireEvent.click(codeBtn);
      expect(onModeChange).toHaveBeenCalledWith('code');
    });

    it('positions Code mode directly beside Chat in the primary mode bar', async () => {
      await act(async () => {
        render(
          <StatusIndicator
            connectionStatus={onlineStatus}
            onRefresh={jest.fn()}
            onSettingsClick={jest.fn()}
            mode="chat"
            onModeChange={jest.fn()}
          />
        );
      });

      const modeButtons = screen.getAllByRole('button').filter(b => b.classList.contains('mode-btn'));
      const labels = modeButtons.map(b => b.textContent?.trim());
      
      const chatIndex = labels.indexOf('Chat');
      const codeIndex = labels.indexOf('Code');
      expect(chatIndex).toBeGreaterThanOrEqual(0);
      expect(codeIndex).toBe(chatIndex + 1);
    });
  });

  describe('DashboardPanel Quick Actions', () => {
    it('renders a Code Workspace quick action button that navigates to code mode', async () => {
      const onModeChange = jest.fn();
      const onNewConversation = jest.fn();

      await act(async () => {
        render(
          <DashboardPanel
            onModeChange={onModeChange}
            onNewConversation={onNewConversation}
          />
        );
      });

      const codeWorkspaceBtn = screen.getByRole('button', { name: /Code Workspace/i });
      expect(codeWorkspaceBtn).toBeInTheDocument();

      fireEvent.click(codeWorkspaceBtn);
      expect(onModeChange).toHaveBeenCalledWith('code');
    });
  });

  describe('WorkspaceShell Status-Bar Navigation', () => {
    it('status-bar Home button invokes onHome when provided', async () => {
      const onClose = jest.fn();
      const onHome = jest.fn();

      await act(async () => {
        render(
          <WorkspaceShell
            open={true}
            onClose={onClose}
            onHome={onHome}
            navContext={null}
          />
        );
      });

      const homeBtn = screen.getByRole('button', { name: /Home/i });
      expect(homeBtn).toBeInTheDocument();

      fireEvent.click(homeBtn);
      expect(onHome).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('status-bar Home button falls back to onClose when onHome is not provided', async () => {
      const onClose = jest.fn();

      await act(async () => {
        render(
          <WorkspaceShell
            open={true}
            onClose={onClose}
            navContext={null}
          />
        );
      });

      const homeBtn = screen.getByRole('button', { name: /Home/i });
      fireEvent.click(homeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
