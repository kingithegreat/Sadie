import axios from 'axios';
import * as mr from '../message-router';
import * as tools from '../tools';

jest.mock('axios');

describe('system prompt authority', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('model-first: LLM is called even when decision override provided', async () => {
    const decision = { type: 'tools', calls: [{ name: 'nba_query', arguments: {} }] } as any;

    // executeToolBatch returns a predictable summary
    (tools as any).executeToolBatch = jest.fn().mockResolvedValue([{ success: true, result: { summary: 'Lakers won' } }] as any);

    // Mock LLM/webhook to return a direct assistant reply
    const axiosPost = jest.spyOn(axios, 'post').mockResolvedValue({ data: { data: { assistant: { role: 'assistant', content: 'LLM answer' } } } } as any);

    const req: any = { user_id: 'u', message: 'NBA score', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused', decision);

    // Model-first means we still call the LLM first
    expect(axiosPost).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('LLM answer');
  });
});
