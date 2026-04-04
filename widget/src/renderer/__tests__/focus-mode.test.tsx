/** @jest-environment jsdom */

import { render, fireEvent } from '@testing-library/react';

// Minimal App wrapper to test focus mode behavior
// We test via the DOM class and keyboard event

describe('Focus mode', () => {
  test('F11 toggles focus-mode class on app-container', async () => {
    // Provide minimum mocks for App
    (window as any).electron = {
      getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: '', widgetHotkey: '' }),
      loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [] } }),
      createConversation: jest.fn().mockResolvedValue({ success: true, data: { id: 'c1', title: 'New', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }),
      setActiveConversation: jest.fn().mockResolvedValue(undefined),
      saveSettings: jest.fn().mockResolvedValue({}),
      subscribeToStream: jest.fn(),
      onConfirmationRequest: jest.fn(),
      onPermissionRequest: jest.fn(),
      onReminderFired: jest.fn(),
      onTitleUpdated: jest.fn(),
      getEnv: jest.fn().mockResolvedValue({}),
    };

    // Dynamic import to avoid hoisting issues
    const { default: App } = await import('../App');
    const { container } = render(<App />);

    // Wait for hydration
    await new Promise(r => setTimeout(r, 50));

    const appEl = container.querySelector('[data-testid="sadie-app-root"]')!;
    expect(appEl.className).not.toContain('focus-mode');

    // Press F11
    fireEvent.keyDown(window, { key: 'F11' });
    expect(appEl.className).toContain('focus-mode');

    // Press F11 again to exit
    fireEvent.keyDown(window, { key: 'F11' });
    expect(appEl.className).not.toContain('focus-mode');

    delete (window as any).electron;
  });

  test('focus-mode-toggle button toggles focus mode', async () => {
    (window as any).electron = {
      getSettings: jest.fn().mockResolvedValue({ alwaysOnTop: true, n8nUrl: '', widgetHotkey: '' }),
      loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [] } }),
      createConversation: jest.fn().mockResolvedValue({ success: true, data: { id: 'c2', title: 'New', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }),
      setActiveConversation: jest.fn().mockResolvedValue(undefined),
      saveSettings: jest.fn().mockResolvedValue({}),
      subscribeToStream: jest.fn(),
      onConfirmationRequest: jest.fn(),
      onPermissionRequest: jest.fn(),
      onReminderFired: jest.fn(),
      onTitleUpdated: jest.fn(),
      getEnv: jest.fn().mockResolvedValue({}),
    };

    const { default: App } = await import('../App');
    const { container } = render(<App />);
    await new Promise(r => setTimeout(r, 50));

    const btn = container.querySelector('.focus-mode-toggle')!;
    expect(btn).not.toBeNull();

    // Click to enable
    fireEvent.click(btn);
    const appEl = container.querySelector('[data-testid="sadie-app-root"]')!;
    expect(appEl.className).toContain('focus-mode');

    // Click to disable
    fireEvent.click(btn);
    expect(appEl.className).not.toContain('focus-mode');

    delete (window as any).electron;
  });
});
