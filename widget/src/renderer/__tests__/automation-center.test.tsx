/** @jest-environment jsdom */
/**
 * automation-center.test.tsx
 * Tests for src/renderer/components/AutomationCenter.tsx
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import AutomationCenter from '../components/AutomationCenter';

const AUTO_A = { id: 'a1', name: 'Daily Backup', description: 'Backs up files', instructions: 'Backup my documents', trigger: 'schedule', enabled: true, createdAt: '2026-01-01T00:00:00Z' };
const AUTO_B = { id: 'b1', name: 'Git Push', description: 'Pushes changes', instructions: 'Run git push', trigger: 'manual', enabled: false, createdAt: '2026-01-01T00:00:00Z' };

function setupElectron(overrides: Record<string, () => Promise<any>> = {}) {
  (window as any).electron = {
    loadAutomations: jest.fn().mockResolvedValue({ automations: [] }),
    updateAutomation: jest.fn().mockResolvedValue({}),
    runAutomation: jest.fn().mockResolvedValue({}),
    deleteAutomation: jest.fn().mockResolvedValue({}),
    createAutomation: jest.fn().mockResolvedValue({ automation: { id: 'new1', name: 'New', description: '', instructions: 'do something', trigger: 'manual', enabled: true, createdAt: '2026-01-01T00:00:00Z' } }),
    ...overrides,
  };
}

afterEach(() => {
  delete (window as any).electron;
});

describe('AutomationCenter — initial render', () => {
  test('renders heading', async () => {
    setupElectron();
    await act(async () => { render(<AutomationCenter />); });
    expect(screen.getByText(/Automation Center/)).toBeInTheDocument();
  });

  test('renders + New Automation button', async () => {
    setupElectron();
    await act(async () => { render(<AutomationCenter />); });
    expect(screen.getByRole('button', { name: /New Automation/i })).toBeInTheDocument();
  });

  test('renders ↻ Refresh button', async () => {
    setupElectron();
    await act(async () => { render(<AutomationCenter />); });
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
  });

  test('shows "No automations yet." when list is empty', async () => {
    setupElectron();
    await act(async () => { render(<AutomationCenter />); });
    expect(screen.getByText('No automations yet.')).toBeInTheDocument();
  });
});

describe('AutomationCenter — loading automations', () => {
  test('renders automation names from API', async () => {
    setupElectron({
      loadAutomations: jest.fn().mockResolvedValue({ automations: [AUTO_A, AUTO_B] }),
    });
    await act(async () => { render(<AutomationCenter />); });
    expect(screen.getByText('Daily Backup')).toBeInTheDocument();
    expect(screen.getByText('Git Push')).toBeInTheDocument();
  });

  test('renders trigger badge for each automation', async () => {
    setupElectron({
      loadAutomations: jest.fn().mockResolvedValue({ automations: [AUTO_A] }),
    });
    await act(async () => { render(<AutomationCenter />); });
    expect(screen.getByText('schedule')).toBeInTheDocument();
  });

  test('shows error when loadAutomations throws', async () => {
    setupElectron({
      loadAutomations: jest.fn().mockRejectedValue(new Error('disk failure')),
    });
    await act(async () => { render(<AutomationCenter />); });
    expect(screen.getByText('Failed to load automations')).toBeInTheDocument();
  });

  test('dismissing error clears the error banner', async () => {
    setupElectron({
      loadAutomations: jest.fn().mockRejectedValue(new Error('boom')),
    });
    await act(async () => { render(<AutomationCenter />); });
    fireEvent.click(screen.getByRole('button', { name: /dismiss error/i }));
    expect(screen.queryByText('Failed to load automations')).toBeNull();
  });
});

describe('AutomationCenter — create automation form', () => {
  test('shows create form when + New Automation is clicked', async () => {
    setupElectron();
    await act(async () => { render(<AutomationCenter />); });
    fireEvent.click(screen.getByRole('button', { name: /New Automation/i }));
    expect(screen.getByText('Create New Automation')).toBeInTheDocument();
  });

  test('Cancel hides the create form', async () => {
    setupElectron();
    await act(async () => { render(<AutomationCenter />); });
    fireEvent.click(screen.getByRole('button', { name: /New Automation/i }));
    // Click the form's Cancel button (not the header toggle)
    const cancelButtons = screen.getAllByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(screen.queryByText('Create New Automation')).toBeNull();
  });

  test('Create button adds automation to list', async () => {
    setupElectron();
    await act(async () => { render(<AutomationCenter />); });
    fireEvent.click(screen.getByRole('button', { name: /New Automation/i }));
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'My Auto' } });
    fireEvent.change(screen.getByLabelText(/Instructions/i), { target: { value: 'do stuff' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Automation/i }));
    });
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  test('Create button does nothing when name is empty', async () => {
    const createAutomation = jest.fn();
    setupElectron({ createAutomation });
    await act(async () => { render(<AutomationCenter />); });
    fireEvent.click(screen.getByRole('button', { name: /New Automation/i }));
    // Leave name blank, but fill instructions
    fireEvent.change(screen.getByLabelText(/Instructions/i), { target: { value: 'do stuff' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Automation/i }));
    });
    expect(createAutomation).not.toHaveBeenCalled();
  });

  test('Create button does nothing when instructions are empty', async () => {
    const createAutomation = jest.fn();
    setupElectron({ createAutomation });
    await act(async () => { render(<AutomationCenter />); });
    fireEvent.click(screen.getByRole('button', { name: /New Automation/i }));
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'My Auto' } });
    // Leave instructions blank
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Automation/i }));
    });
    expect(createAutomation).not.toHaveBeenCalled();
  });

  test('shows error when createAutomation throws', async () => {
    setupElectron({
      createAutomation: jest.fn().mockRejectedValue(new Error('create fail')),
    });
    await act(async () => { render(<AutomationCenter />); });
    fireEvent.click(screen.getByRole('button', { name: /New Automation/i }));
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/Instructions/i), { target: { value: 'do stuff' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Automation/i }));
    });
    expect(screen.getByText('Failed to create automation')).toBeInTheDocument();
  });
});

describe('AutomationCenter — automation controls', () => {
  test('toggle checkbox calls updateAutomation with toggled enabled', async () => {
    const updateAutomation = jest.fn().mockResolvedValue({});
    setupElectron({
      loadAutomations: jest.fn().mockResolvedValue({ automations: [AUTO_A] }),
      updateAutomation,
    });
    await act(async () => { render(<AutomationCenter />); });
    const checkbox = screen.getByRole('checkbox', { name: /Enable Daily Backup/i });
    await act(async () => { fireEvent.click(checkbox); });
    expect(updateAutomation).toHaveBeenCalledWith({ id: 'a1', enabled: false });
  });

  test('toggle updates local enabled state', async () => {
    setupElectron({
      loadAutomations: jest.fn().mockResolvedValue({ automations: [AUTO_A] }),
    });
    await act(async () => { render(<AutomationCenter />); });
    const checkbox = screen.getByRole('checkbox', { name: /Enable Daily Backup/i });
    await act(async () => { fireEvent.click(checkbox); });
    expect(checkbox).not.toBeChecked();
  });

  test('▶ run button calls runAutomation', async () => {
    const runAutomation = jest.fn().mockResolvedValue({});
    setupElectron({
      loadAutomations: jest.fn().mockResolvedValue({ automations: [AUTO_A] }),
      runAutomation,
    });
    await act(async () => { render(<AutomationCenter />); });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Run now'));
    });
    expect(runAutomation).toHaveBeenCalledWith({ id: 'a1' });
  });

  test('🗑 delete button removes automation from list', async () => {
    setupElectron({
      loadAutomations: jest.fn().mockResolvedValue({ automations: [AUTO_A] }),
    });
    await act(async () => { render(<AutomationCenter />); });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Delete'));
    });
    expect(screen.queryByText('Daily Backup')).toBeNull();
  });

  test('shows error when toggleAutomation throws', async () => {
    setupElectron({
      loadAutomations: jest.fn().mockResolvedValue({ automations: [AUTO_A] }),
      updateAutomation: jest.fn().mockRejectedValue(new Error('toggle err')),
    });
    await act(async () => { render(<AutomationCenter />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Enable Daily Backup/i }));
    });
    expect(screen.getByText('Failed to update automation')).toBeInTheDocument();
  });

  test('shows error when deleteAutomation throws', async () => {
    setupElectron({
      loadAutomations: jest.fn().mockResolvedValue({ automations: [AUTO_A] }),
      deleteAutomation: jest.fn().mockRejectedValue(new Error('del err')),
    });
    await act(async () => { render(<AutomationCenter />); });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Delete'));
    });
    expect(screen.getByText('Failed to delete automation')).toBeInTheDocument();
  });
});
