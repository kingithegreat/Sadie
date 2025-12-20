import { processIncomingRequest } from '../message-router';

test('streams only after reflection accept', async () => {
  const events: string[] = [];
  const res = await processIncomingRequest(
    { message: 'test', onStream: c => events.push(c) },
    'http://unused'
  );
  expect(res.success).toBe(true);
  expect(events.length).toBeGreaterThan(0);
  expect(events.join('')).toBe(res.data.assistant.content);
});
