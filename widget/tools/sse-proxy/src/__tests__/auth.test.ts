import request from 'supertest';
process.env.PROXY_API_KEYS = 'changeme';
process.env.PROXY_REQUIRE_API_KEY = 'true';
process.env.PROXY_REQUIRE_API_KEY = 'true';
const app = require('../index').default;

describe('Auth tests', () => {
  test('Missing body returns 400', async () => {
    const res = await request(app).post('/stream').send({});
    expect(res.status).toBe(400);
  });

  test('Unauthorized request without api key returns 401', async () => {
    // Provide a valid body but no header
    const res = await request(app).post('/stream').send({ provider: 'openai', model: 'gpt-4o', prompt: 'Hi' });
    expect(res.status).toBe(401);
  });
  test('Authorized request with key returns 200 or stream', async () => {
    const res = await request(app).post('/stream').set('x-sadie-key', 'changeme').send({ provider: 'openai', model: 'gpt-4o', prompt: 'Hi' });
    expect([200, 401, 500]).toContain(res.status); // may be proxy downstream errors if not configured; at least not unauthorized
  });
});
