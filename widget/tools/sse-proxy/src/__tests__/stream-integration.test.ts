import request from 'supertest';
import http from 'http';
process.env.PROXY_API_KEYS = '';
process.env.PROXY_REQUIRE_API_KEY = 'false';
const app = require('../index').default;

describe('Stream integration tests', () => {
  afterAll(async () => {
    await require('../index').gracefulShutdown();
  });
  test('Stream request returns SSE response', async () => {
    const res = await request(app)
      .post('/stream')
      .set('x-sadie-key', 'test')
      .send({ provider: 'openai', model: 'gpt-4o', prompt: 'Say hello' })
      .expect(200);

    // Check for SSE headers
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toContain('no-cache');

    // Close the underlying socket so the test doesn't leave the streaming connection open
    try {
      const r: any = res as any;
      if (r && r.req && typeof r.req.abort === 'function') r.req.abort();
      else if (r && r.res && r.res.socket) r.res.socket.destroy();
    } catch (e) { /* ignore */ }
  });

  test('Stream cancellation via client disconnect', async () => {
    // Use a real HTTP connection against a running server to simulate a client disconnect
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;

    await new Promise<void>((resolve) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/stream', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        res.on('data', () => { /* drain */ });
        res.on('end', () => resolve());
        res.on('close', () => resolve());
      });

      req.on('error', () => resolve());

      req.write(JSON.stringify({ provider: 'openai', model: 'gpt-4o', prompt: 'Long response' }));

      // simulate immediate client disconnect
      setTimeout(() => req.destroy(), 50);
    });

    await new Promise<void>((r) => server.close(() => r()));
  }, 10000);
});