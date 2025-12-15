import axios from 'axios';
import * as mr from '../message-router';
import { processIncomingRequest } from '../message-router';

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
  });

  it('accepts valid tool output from reflection', async () => {
    // First LLM call: requests tool
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: { tool_calls: [{ name: 'dummy', arguments: {} }] } } });
    // executeToolBatch returns results
    (executeToolBatch as jest.Mock).mockResolvedValueOnce([{ success: true, result: { value: 42 } }]);
    // Reflection LLM returns strict JSON accept
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: JSON.stringify({ outcome: 'accept', final_message: 'The answer is 42.' }) } });

    const req = { user_id: 'u', conversation_id: 'conv', message: 'ask something' } as any;
    const res = await processIncomingRequest(req, 'http://unused');

    // Debug
    console.log('RES1', JSON.stringify(res, null, 2));

    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('The answer is 42.');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('invalid JSON reflection triggers controlled failure', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: { tool_calls: [{ name: 'dummy', arguments: {} }] } } });
    (executeToolBatch as jest.Mock).mockResolvedValueOnce([{ success: true, result: { value: 42 } }]);
    // Reflection returns prose (invalid JSON)
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: "I think the answer is 42" } });

    const req = { user_id: 'u', conversation_id: 'conv', message: 'ask something' } as any;
    const res = await processIncomingRequest(req, 'http://unused');

    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toMatch(/couldn't validate the tool output/i);
  });

  it('requests a second tool and then accepts', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: { tool_calls: [{ name: 't1', arguments: {} }] } } });
    (executeToolBatch as jest.Mock).mockResolvedValueOnce([{ success: true, result: { out: 1 } }]);

    // Reflection asks for second tool
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: JSON.stringify({ outcome: 'request_tool', tool_request: { name: 't2', args: {} } }) } });
    // execute second tool
    (executeToolBatch as jest.Mock).mockResolvedValueOnce([{ success: true, result: { out: 2 } }]);
    // second reflection accepts
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: JSON.stringify({ outcome: 'accept', final_message: 'Combined results: 1 and 2' }) } });

    const req = { user_id: 'u', conversation_id: 'conv', message: 'ask for t1 then t2' } as any;
    const res = await processIncomingRequest(req, 'http://unused');

    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('Combined results: 1 and 2');
    expect((executeToolBatch as jest.Mock).mock.calls.length).toBe(2);
  });

  it('terminates after max depth', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: { tool_calls: [{ name: 't1', arguments: {} }] } } });
    (executeToolBatch as jest.Mock).mockResolvedValue([{ success: true, result: { out: 1 } }]);

    // reflection will request tools repeatedly
    mockedAxios.post.mockResolvedValue({ data: { assistant: JSON.stringify({ outcome: 'request_tool', tool_request: { name: 't2', args: {} } }) } });

    const req = { user_id: 'u', conversation_id: 'conv', message: 'ask for t1 then loop' } as any;
    const res = await processIncomingRequest(req, 'http://unused');

    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toMatch(/could not validate tool results|Reflection failed/i);
  });
});
