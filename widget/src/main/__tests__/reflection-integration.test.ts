import axios from 'axios';
import { processIncomingRequest } from '../message-router';
import { executeToolBatch } from '../tools';

jest.mock('axios');
jest.mock('../tools', () => ({ executeToolBatch: jest.fn() }));
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedExecute = executeToolBatch as jest.MockedFunction<any>;

jest.mock('../config-manager', () => ({ getSettings: () => ({ permissions: { web_search: true } }) }));

describe('Reflection integration', () => {
  beforeEach(() => jest.resetAllMocks());

  it('end-to-end: user -> LLM requests tool -> tool runs -> reflection accepts final message', async () => {
    // LLM initially requests web_search
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: { tool_calls: [{ name: 'web_search', arguments: { query: 'weather' } }] } } });
    // Tool executes
    mockedExecute.mockResolvedValueOnce([{ success: true, result: { summary: 'Sunny 70F' } }]);
    // Reflection accepts with final_message
    mockedAxios.post.mockResolvedValueOnce({ data: { assistant: JSON.stringify({ outcome: 'accept', final_message: 'It is Sunny and 70F.' }) } });

    const req = { user_id: 'u', conversation_id: 'conv', message: 'What is the weather?' } as any;
    const res = await processIncomingRequest(req, 'http://unused');

    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('It is Sunny and 70F.');
    expect(mockedExecute).toHaveBeenCalledTimes(1);
  });

  it('surfaces reflection confidence and acceptance', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.85,
      final_message: 'Integration test message.'
    };
    const res = await processIncomingRequest({ message: 'test' }, 'http://unused');
    expect(res.data.reflection).toEqual({
      confidence: 0.85,
      accepted: true
    });
    expect(res.data.assistant.content).toBe('Integration test message.');
  });
});
