import request from 'supertest';
process.env.PROXY_API_KEYS = 'changeme';
process.env.PROXY_REQUIRE_API_KEY = 'true';
const app = require('../index').default;
const adminHeader = { 'x-sadie-admin-key': 'adminchangeme' };

describe('Admin endpoints', () => {
  test('Get keys requires admin header', async () => {
    const res = await request(app).get('/admin/keys');
    expect(res.status).toBe(401);
  });

  test('Get keys with valid admin header', async () => {
    const res = await request(app).get('/admin/keys').set(adminHeader);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('keys');
  });
});
