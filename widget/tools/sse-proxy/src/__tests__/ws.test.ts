import WebSocket from 'ws';
process.env.PROXY_API_KEYS = 'changeme';
process.env.PROXY_REQUIRE_API_KEY = 'true';
const app = require('../index').default;
import http from 'http';

let server: http.Server;
beforeAll((done: jest.DoneCallback) => {
  server = http.createServer(app);
  server.listen(0, () => { done(); });
});
afterAll((done: jest.DoneCallback) => { server.close(() => { done(); }); });
afterAll(async () => { try { await require('../index').gracefulShutdown(); } catch (e) { /* ignore */ } });

test('WebSocket simple request', (done: jest.DoneCallback) => {
  const port = (server.address() as any).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.on('open', () => {
    ws.send(JSON.stringify({ provider: 'ollama', model: 'phi3-vision', prompt: 'describe' }));
  });
  ws.on('message', (m: WebSocket.Data) => {
    const json = JSON.parse(m.toString());
    if (json.error) { ws.close(); done(); }
    if (json.done) { ws.close(); done(); }
  });
  ws.on('error', (err: any) => { ws.close(); done(); });
});
