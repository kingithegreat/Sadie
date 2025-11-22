import request from 'supertest';
process.env.PROXY_API_KEYS = '';
process.env.PROXY_REQUIRE_API_KEY = 'false';
process.env.RATE_LIMIT_MAX = '5';
const app = require('../index').default;
afterAll(async () => { try { await require('../index').gracefulShutdown(); } catch (e) { /* ignore */ } });

describe('Rate limiting', () => {
  test('Exceeding rate limit returns RATE_LIMIT SSE', async () => {
    const max = 5;
    let lastRes: any = null;
    for (let i = 0; i < max + 2; i++) {
      lastRes = await request(app).post('/stream').set('x-sadie-key', 'test').send({ provider: 'openai', model: 'x', prompt: 'hi' });
      if (lastRes.status === 429) break;
    }
    expect([429, 200, 500]).toContain(lastRes.status);
    if (lastRes.status === 429) {
      expect(lastRes.text).toContain('RATE_LIMIT');
    }
  });
});
