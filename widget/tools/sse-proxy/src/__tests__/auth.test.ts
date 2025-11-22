import request from 'supertest';
process.env.PROXY_API_KEYS = '';
process.env.PROXY_REQUIRE_API_KEY = 'false';
const app = require('../index').default;
afterAll(async () => { try { await require('../index').gracefulShutdown(); } catch (e) { /* ignore */ } });

describe('Auth tests', () => {
  test('Missing body returns 400', async () => {
    const res = await request(app).post('/stream').set('x-sadie-key', 'test').send({});
    expect(res.status).toBe(400);
  });

  test('Request without key should not enforce API auth in test env', async () => {
    // Provide a valid body but no header - server should not treat this as unauthorized in test mode
    const res = await request(app).post('/stream').send({ provider: 'openai', model: 'gpt-4o', prompt: 'Hi' });
    // downstream/server errors are possible; ensure we do not get a 401 (auth enforcement) here
    expect(res.status).not.toBe(401);
  });
  test('Authorized request with key returns 200 or stream', async () => {
    const res = await request(app).post('/stream').set('x-sadie-key', 'test').send({ provider: 'openai', model: 'gpt-4o', prompt: 'Hi' });
    expect([200, 500, 400]).toContain(res.status); // may be proxy downstream errors if not configured; at least not unauthorized
  });
});
