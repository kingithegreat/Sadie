import axios from 'axios';
import * as mr from '../message-router';
import * as tools from '../tools';

jest.mock('axios');

describe('system prompt authority', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('when routing decision is tools, model output is never surfaced', async () => {
    const decision = { type: 'tools', calls: [{ name: 'nba_query', arguments: {} }] } as any;

    // executeToolBatch returns a predictable summary
    (tools as any).executeToolBatch = jest.fn().mockResolvedValue([{ success: true, result: { summary: 'Lakers won' } }] as any);

    // If LLM/webhook were called they'd return text; ensure they are not used
    const axiosPost = jest.spyOn(axios, 'post').mockResolvedValue({ data: { assistant: { role: 'assistant', content: 'LLM answer' } } } as any);
    const streamSpy = jest.spyOn(mr as any, 'streamFromOllamaWithTools').mockImplementation(async () => {
      return { cancel: () => {} } as any;
    });

    const req: any = { user_id: 'u', message: 'NBA score', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused', decision);

    expect(axiosPost).not.toHaveBeenCalled();
    expect(streamSpy).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.data.routed).toBe(true);
    expect(res.data.assistant.content).toContain('Lakers');
    expect(res.data.assistant.content).not.toContain('LLM answer');
  });
});
