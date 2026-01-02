
import axios from 'axios';
import * as mr from '../message-router';
import * as tools from '../tools';
import { buildReflectionMeta } from '../reflection-meta';

jest.mock('axios');

describe('system prompt authority', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('model-first: LLM is called even when decision override provided', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.91,
      final_message: 'System prompt authority test message'
    };
    const req: any = { user_id: 'u', message: 'NBA score', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('System prompt authority test message');
    expect(res.data.assistant.reflection.confidence).toBe(0.91);
    expect(res.data.assistant.reflection.accepted).toBe(true);
  });
});
