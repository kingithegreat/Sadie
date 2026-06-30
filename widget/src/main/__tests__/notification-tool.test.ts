/**
 * Notification Tool Tests
 */

// Mock Electron Notification API
const mockShow = jest.fn();
const mockNotification = jest.fn().mockImplementation(() => ({ show: mockShow }));
(mockNotification as any).isSupported = jest.fn().mockReturnValue(true);

jest.mock('electron', () => ({
  Notification: mockNotification
}));

// Mock child_process for the PowerShell fallback path
jest.mock('child_process', () => ({ exec: jest.fn() }));

import { showNotificationHandler, showNotificationDef } from '../tools/notification';

beforeEach(() => {
  jest.clearAllMocks();
  (mockNotification as any).isSupported.mockReturnValue(true);
});

describe('showNotificationHandler', () => {
  test('shows notification via Electron when supported', async () => {
    const res = await showNotificationHandler({ title: 'Hello', body: 'World' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.method).toBe('electron');
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  test('truncates title to 64 chars', async () => {
    const longTitle = 'A'.repeat(100);
    const res = await showNotificationHandler({ title: longTitle, body: 'ok' }, {} as any);
    expect(res.success).toBe(true);
    const constructorCall = mockNotification.mock.calls[0][0];
    expect(constructorCall.title.length).toBeLessThanOrEqual(64);
  });

  test('requires title', async () => {
    const res = await showNotificationHandler({ body: 'no title' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('title');
  });

  test('requires body', async () => {
    const res = await showNotificationHandler({ title: 'no body' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('body');
  });

  test('sets silent=false for critical urgency', async () => {
    await showNotificationHandler({ title: 'Alert', body: 'Critical!', urgency: 'critical' }, {} as any);
    const constructorCall = mockNotification.mock.calls[0][0];
    expect(constructorCall.silent).toBe(false);
  });

  test('sets silent=true for normal urgency', async () => {
    await showNotificationHandler({ title: 'Info', body: 'Normal', urgency: 'normal' }, {} as any);
    const constructorCall = mockNotification.mock.calls[0][0];
    expect(constructorCall.silent).toBe(true);
  });
});

describe('showNotificationDef', () => {
  test('has correct name and category', () => {
    expect(showNotificationDef.name).toBe('show_notification');
    expect(showNotificationDef.category).toBe('system');
  });
});
