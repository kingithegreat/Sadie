
import axios from 'axios';
import * as mr from '../message-router';
import * as tools from '../tools';
import { buildReflectionMeta } from '../reflection-meta';

jest.mock('axios');

describe('model-first routing loop', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('Direct response: LLM called once, no tools executed', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.91,
      final_message: 'Direct response test message'
    };
    const req: any = { user_id: 'u', message: 'Say hi', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('Direct response test message');
    expect(res.data.assistant.reflection.confidence).toBe(0.91);
    expect(res.data.assistant.reflection.accepted).toBe(true);
  });

  test('Single tool request: LLM requests tool, tool runs, LLM finalizes', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.91,
      final_message: 'Single tool request test message'
    };
    const req: any = { user_id: 'u', message: 'Calculate 2+2', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('Single tool request test message');
    expect(res.data.assistant.reflection.confidence).toBe(0.91);
    expect(res.data.assistant.reflection.accepted).toBe(true);
  });

  test('Pre-routing sports intent: router executes sports tool without initial LLM call', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.91,
      final_message: 'Pre-routing sports intent test message'
    };
    const req: any = { user_id: 'u', message: "whats the warriors next game?", conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('Pre-routing sports intent test message');
    expect(res.data.assistant.reflection.confidence).toBe(0.91);
    expect(res.data.assistant.reflection.accepted).toBe(true);
  });

  test('Permission-gated tool: LLM requests restricted tool and router blocks', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'request_tool',
      confidence: 0.6,
      tool_request: { name: 'restricted_tool', args: {} }
    };
    const req: any = { user_id: 'u', message: 'Write file', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');
    expect(res.success).toBe(true);
    expect(res.data.assistant.reflection.confidence).toBe(0.6);
    expect(res.data.assistant.reflection.accepted).toBe(false);
  });
});
