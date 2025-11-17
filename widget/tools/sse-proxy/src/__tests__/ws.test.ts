import WebSocket from 'ws';
process.env.PROXY_API_KEYS = 'changeme';
process.env.PROXY_REQUIRE_API_KEY = 'true';
const app = require('../index').default;
import http from 'http';

let server: http.Server;
beforeAll((done) => {
  server = http.createServer(app);
  server.listen(0, () => done());
});
afterAll((done) => server.close(() => done()));

test('WebSocket simple request', (done) => {
  const port = (server.address() as any).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.on('open', () => {
    ws.send(JSON.stringify({ provider: 'ollama', model: 'phi3-vision', prompt: 'describe' }));
  });
  ws.on('message', (m) => {
    const json = JSON.parse(m.toString());
    if (json.error) { ws.close(); done(); }
    if (json.done) { ws.close(); done(); }
  });
  ws.on('error', (err) => { ws.close(); done(); });
});
