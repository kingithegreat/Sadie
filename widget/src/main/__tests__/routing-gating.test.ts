import axios from 'axios';
import * as mr from '../message-router';
import * as tools from '../tools';

jest.mock('axios');

describe('model-first routing loop', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('Direct response: LLM called once, no tools executed', async () => {
    const axiosPost = (axios.post as jest.MockedFunction<any>);
    axiosPost.mockResolvedValue({ data: { data: { assistant: { role: 'assistant', content: 'Hello world' } } } });

    const execSpy = jest.spyOn(tools as any, 'executeToolBatch').mockResolvedValue([] as any);

    const req: any = { user_id: 'u', message: 'Say hi', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');

    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(execSpy).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('Hello world');
  });

  test('Single tool request: LLM requests tool, tool runs, LLM finalizes', async () => {
    const axiosPost = (axios.post as jest.MockedFunction<any>);
    // First call: LLM requests a tool
    axiosPost.mockResolvedValueOnce({ data: { data: { assistant: { role: 'assistant', content: '', tool_calls: [{ name: 'nba_query', arguments: {} }] } } } });
    // Second call: final assistant reply
    axiosPost.mockResolvedValueOnce({ data: { data: { assistant: { role: 'assistant', content: 'Final answer' } } } });

    const execSpy = jest.spyOn(tools as any, 'executeToolBatch').mockResolvedValue([{ success: true, result: { summary: 'Lakers won' } }] as any);

    const req: any = { user_id: 'u', message: 'NBA score', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');

    expect(axiosPost).toHaveBeenCalledTimes(2);
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('Final answer');
  });

  test('Permission-gated tool: LLM requests restricted tool and router blocks', async () => {
    const axiosPost = (axios.post as jest.MockedFunction<any>);
    axiosPost.mockResolvedValue({ data: { data: { assistant: { role: 'assistant', content: '', tool_calls: [{ name: 'write_file', arguments: {} }] } } } });

    const execSpy = jest.spyOn(tools as any, 'executeToolBatch').mockResolvedValue([{ success: false, status: 'needs_confirmation', missingPermissions: ['write_file'] }] as any);

    const req: any = { user_id: 'u', message: 'Write file', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');

    // Router should return a needs_confirmation response without executing tool
    expect(execSpy).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.data.assistant.status).toBe('needs_confirmation');
    expect(res.data.assistant.missingPermissions).toEqual(['write_file']);
  });
});
