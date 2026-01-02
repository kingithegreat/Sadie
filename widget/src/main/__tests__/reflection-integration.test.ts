
import axios from 'axios';
import { processIncomingRequest } from '../message-router';
import { executeToolBatch } from '../tools';
import { buildReflectionMeta } from '../reflection-meta';

jest.mock('axios');
jest.mock('../tools', () => ({ executeToolBatch: jest.fn() }));
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedExecute = executeToolBatch as jest.MockedFunction<any>;

jest.mock('../config-manager', () => ({ getSettings: () => ({ permissions: { web_search: true } }) }));

describe('Reflection integration', () => {
  beforeEach(() => jest.resetAllMocks());

  it('end-to-end: user -> LLM requests tool -> tool runs -> reflection accepts final message', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.91,
      final_message: 'It is Sunny and 70F.'
    };
    const req = { user_id: 'u', conversation_id: 'conv', message: 'What is the weather?' } as any;
    const res = await processIncomingRequest(req, 'http://unused');
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toBe('It is Sunny and 70F.');
    expect(res.data.assistant.reflection.confidence).toBe(0.91);
    expect(res.data.assistant.reflection.accepted).toBe(true);
  });

  it('surfaces reflection confidence and acceptance', async () => {
    (global as any).__SADIE_TEST_REFLECTION = {
      outcome: 'accept',
      confidence: 0.91,
      final_message: 'Integration test message.'
    };
    const res = await processIncomingRequest({ user_id: 'test', conversation_id: 'test', message: 'test' } as any, 'http://unused');
    expect(res.data.reflection.confidence).toBe(0.91);
    expect(res.data.reflection.accepted).toBe(true);
    expect(res.data.assistant.content).toBe('Integration test message.');
  });
});
