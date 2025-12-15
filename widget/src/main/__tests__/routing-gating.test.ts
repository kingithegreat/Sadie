import axios from 'axios';
import * as mr from '../message-router';
import * as tools from '../tools';

jest.mock('axios');

describe('routing gating', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('LLM/webhook is never called when decision is tools', async () => {
    // Arrange: force analyzer to return tools
    (mr as any).analyzeAndRouteMessage = jest.fn().mockResolvedValue({ type: 'tools', calls: [{ name: 'nba_query', arguments: {} }] } as any);

    // Spy on executeToolBatch to return a successful result
    (tools as any).executeToolBatch = jest.fn().mockResolvedValue([{ success: true, result: 'ok' }] as any);

    // Spy on axios.post so we can assert it was not called
    const axiosPost = (axios.post as jest.MockedFunction<any>);

    // Act
    const req: any = { user_id: 'u', message: 'NBA score', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');

    // Assert
    expect(axiosPost).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data.routed).toBe(true);
    expect(res.data.assistant).toBeDefined();
    expect(res.data.assistant.role).toBe('assistant');
    expect(typeof res.data.assistant.content).toBe('string');
  });

  test('Tool routing returns assistant text and toolResults', async () => {
    (mr as any).analyzeAndRouteMessage = jest.fn().mockResolvedValue({ type: 'tools', calls: [{ name: 'nba_query', arguments: {} }] } as any);
    (tools as any).executeToolBatch = jest.fn().mockResolvedValue([{ success: true, result: { summary: 'Lakers won' } }] as any);

    const req: any = { user_id: 'u', message: 'NBA score', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused');

    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toContain('Lakers');
    expect(Array.isArray(res.data.toolResults)).toBe(true);
  });

  test('Permission denial blocks LLM fallback and returns needs_confirmation', async () => {
    // Use decision override to avoid mocking internal analyzer
    const decision = { type: 'tools', calls: [{ name: 'write_file', arguments: {} }] } as any;
    (tools as any).executeToolBatch = jest.fn().mockResolvedValue([{ success: false, status: 'needs_confirmation', missingPermissions: ['write_file'] }] as any);

    const req: any = { user_id: 'u', message: 'Write file', conversation_id: 'c' };
    const res = await mr.processIncomingRequest(req, 'http://unused', decision);
    console.log('debug res', JSON.stringify(res));

    expect(res.success).toBe(true);
    expect(res.data.assistant.status).toBe('needs_confirmation');
    expect(res.data.assistant.missingPermissions).toEqual(['write_file']);
  });
});
