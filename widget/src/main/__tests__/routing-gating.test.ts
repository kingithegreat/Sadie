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
    // First call: LLM requests a tool (model-first path)
    axiosPost.mockResolvedValueOnce({ data: { data: { assistant: { role: 'assistant', content: '', tool_calls: [{ name: 'calculate', arguments: { expression: '2+2' } }] } } } });
    // Second call: reflection accepts and returns strict JSON with final message
    axiosPost.mockResolvedValueOnce({ data: { assistant: JSON.stringify({ outcome: 'accept', final_message: 'Final answer' }) } });

    const execSpy = jest.spyOn(tools as any, 'executeToolBatch').mockResolvedValue([{ success: true, result: { value: 4 } }] as any);

    // Ensure permissions allow calculate for this test
    const cfg = require('../config-manager');
    jest.spyOn(cfg, 'getSettings').mockReturnValue({ permissions: { calculate: true } });

    const req: any = { user_id: 'u', message: 'Calculate 2+2', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');

    expect(axiosPost).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('Final answer');
  });

  test('Pre-routing sports intent: router executes sports tool without initial LLM call', async () => {
    const axiosPost = (axios.post as jest.MockedFunction<any>);
    // Reflection call: accepts and returns final message
    axiosPost.mockResolvedValueOnce({ data: { assistant: JSON.stringify({ outcome: 'accept', final_message: 'Warriors play Lakers on 2024-03-12' }) } });

    const execSpy = jest.spyOn(tools as any, 'executeToolBatch').mockResolvedValue([{ success: true, result: { schedule: 'Warriors vs Lakers', date: '2024-03-12' } }] as any);

    const req: any = { user_id: 'u', message: "whats the warriors next game?", conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');

    // Should have executed tool directly (pre-routing) and then run reflection once
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('Warriors play Lakers on 2024-03-12');
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
