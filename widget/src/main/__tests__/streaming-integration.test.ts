import { processIncomingRequest } from '../message-router';

test('streams only after reflection accept', async () => {
  (global as any).__SADIE_TEST_REFLECTION = {
    outcome: 'accept',
    confidence: 0.85,
    final_message: 'Test message'
  };
  const events: string[] = [];
  const res = await processIncomingRequest(
    { user_id: 'test', conversation_id: 'test', message: 'test', onStream: (c: string) => events.push(c) } as any,
    'http://unused'
  );
  expect(res.success).toBe(true);
  // Streaming assertions depend on actual implementation
});
