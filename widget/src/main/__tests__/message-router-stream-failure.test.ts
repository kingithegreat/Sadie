import { jest } from '@jest/globals';

// Mock electron IPC so we can capture registered handlers
const handlers: Record<string, Function> = {};
jest.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, h: Function) => { handlers[channel] = h; },
    handle: jest.fn()
  },
  BrowserWindow: jest.fn(),
  app: { getPath: jest.fn(() => "/mock/userData") }
}));

// Mock logger so we can assert telemetry event was emitted
const mockLogTelemetryEvent = jest.fn();
jest.mock('../../main/utils/logger', () => ({
  logTelemetryEvent: (ev: string, details: any) => mockLogTelemetryEvent(ev, details),
  initLogging: jest.fn(),
  logStartup: jest.fn(),
  logError: jest.fn()
}));

// Mock axios probe to simulate n8n probe error
import axios from 'axios';
jest.spyOn(axios, 'get').mockImplementation(async (url: string) => {
  return { status: 502 } as any; // simulate probe returning 502
});

import { registerMessageRouter } from '../message-router';

describe('message-router telemetry on upstream failures', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    // clear captured handlers
    for (const k of Object.keys(handlers)) delete handlers[k];
    mockLogTelemetryEvent.mockClear();
  });

  it('records a telemetry event when probe detects n8n unavailable', async () => {
    // Register router which should attach the sadie:stream-message handler
    registerMessageRouter({} as any, 'http://localhost:5678');
    const h = handlers['sadie:stream-message'];
    expect(typeof h).toBe('function');

    // Fake IPC event with sender.send stub
    const sends: any[] = [];
    const fakeEvent = { sender: { send: (_ch: string, payload: any) => sends.push({ _ch, payload }) } } as any;

    // Call handler with a valid request that will hit the probe path
    await h(fakeEvent, { user_id: 'desktop_user', conversation_id: 'conv1', message: 'hello', streamId: 's-1' });

    // Expect that a telemetry event for stream_failure was emitted
    expect(mockLogTelemetryEvent).toHaveBeenCalled();
    const call = mockLogTelemetryEvent.mock.calls.find(c => c[0] === 'stream_failure');
    expect(call).toBeDefined();
    const details = call![1];
    expect(details).toHaveProperty('reason');
    expect(details.reason).toMatch(/n8n_probe_error|n8n_probe_failed/);
    expect(details).toHaveProperty('url');
    expect(details).toHaveProperty('streamId', 's-1');
  });
});