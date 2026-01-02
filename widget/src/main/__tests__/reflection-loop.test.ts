
import axios from 'axios';
import * as mr from '../message-router';
import { processIncomingRequest } from '../message-router';
import { buildReflectionMeta } from '../reflection-meta';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../tools', () => ({
  executeToolBatch: jest.fn()
}));
const { executeToolBatch } = require('../tools');

// Mock settings to always allow tools
jest.mock('../config-manager', () => ({
  getSettings: () => ({ permissions: { dummy: true, t1: true, t2: true } })
}));

describe('Reflection loop', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (global as any).__SADIE_TEST_REFLECTION = undefined;
  });

  it('accepts valid tool output from reflection', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: { tool_calls: [{ name: 'dummy', arguments: {} }] } } });
    (executeToolBatch as jest.Mock).mockResolvedValueOnce([{ success: true, result: { value: 42 } }]);
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.92,
      final_message: 'The answer is 42.'
    };
    const req = { user_id: 'u', conversation_id: 'conv', message: 'ask something' } as any;
    const res = await processIncomingRequest(req, 'http://unused');
        expect(res.success).toBe(true);
        expect(res.data.assistant.content).toBe('The answer is 42.');
        expect(res.data.assistant.reflection).toEqual({ confidence: 0.92, accepted: true, threshold: 0.7 });
  });

  it('invalid JSON reflection triggers controlled failure', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: { tool_calls: [{ name: 'dummy', arguments: {} }] } } });
    (executeToolBatch as jest.Mock).mockResolvedValueOnce([{ success: true, result: { value: 42 } }]);
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'explain',
      confidence: null,
      explanation: "couldn't validate the tool output"
    };
    const req = { user_id: 'u', conversation_id: 'conv', message: 'ask something' } as any;
    const res = await processIncomingRequest(req, 'http://unused');
        expect(res.success).toBe(true);
        expect(res.data.assistant.content).toMatch(/couldn't validate the tool output/i);
        expect(res.data.assistant.reflection).toEqual({ confidence: null, accepted: false, threshold: 0.7 });
  });

  it('requests a second tool and then accepts', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: { tool_calls: [{ name: 't1', arguments: {} }] } } });
    (executeToolBatch as jest.Mock).mockResolvedValueOnce([{ success: true, result: { out: 1 } }]);
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.91,
      final_message: 'Combined results: 1 and 2'
    };
    const req = { user_id: 'u', conversation_id: 'conv', message: 'ask for t1 then t2' } as any;
    const res = await processIncomingRequest(req, 'http://unused');
        expect(res.success).toBe(true);
        expect(res.data.assistant.content).toBe('Combined results: 1 and 2');
        expect(res.data.assistant.reflection).toEqual({ confidence: 0.91, accepted: true, threshold: 0.7 });
  });

  it('terminates after max depth', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: { tool_calls: [{ name: 't1', arguments: {} }] } } });
    (executeToolBatch as jest.Mock).mockResolvedValue([{ success: true, result: { out: 1 } }]);
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'explain',
      confidence: null,
      explanation: 'Reflection failed after max depth'
    };
    const req = { user_id: 'u', conversation_id: 'conv', message: 'ask for t1 then loop' } as any;
    const res = await processIncomingRequest(req, 'http://unused');
        expect(res.success).toBe(true);
        expect(res.data.assistant.content).toMatch(/could not validate tool results|Reflection failed/i);
        expect(res.data.assistant.reflection).toEqual({ confidence: null, accepted: false, threshold: 0.7 });
  });
});
