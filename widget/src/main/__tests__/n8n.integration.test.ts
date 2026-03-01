import http from 'http';
import { AddressInfo } from 'net';
import { processIncomingRequest } from '../message-router';

function startMockServer(handler: (req: http.IncomingMessage, body: any, res: http.ServerResponse) => void) {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    req.on('data', (c) => raw += c.toString('utf8'));
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = raw; }
      handler(req, body, res);
    });
  });

  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

describe('n8n integration (mock endpoints)', () => {
  jest.setTimeout(10000);

  test('processIncomingRequest - successful LLM response from n8n', async () => {
    const { server, port } = await startMockServer((req, _body, res) => {
      if (req.method === 'POST' && req.url === '/webhook/sadie/chat') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ assistant: { role: 'assistant', content: 'Hello from n8n' } }));
        return;
      }
      res.writeHead(404); res.end();
    });

    const n8nUrl = `http://127.0.0.1:${port}`;

    const resp = await processIncomingRequest({ user_id: 'u1', conversation_id: 'c1', message: 'Say hi' }, n8nUrl);
    expect(resp).toBeDefined();
    expect((resp as any).success).toBe(true);
    expect((resp as any).data).toBeDefined();
    expect((resp as any).data.assistant).toBeDefined();
    expect((resp as any).data.assistant.content).toContain('Hello from n8n');

    server.close();
  });

  test('processIncomingRequest - n8n offline returns NETWORK_ERROR', async () => {
    // Start and immediately close a server to obtain a free port, then close so connection is refused
    const { server, port } = await startMockServer((_req, _body, res) => { res.writeHead(200); res.end(); });
    server.close();

    const n8nUrl = `http://127.0.0.1:${port}`;

    const resp = await processIncomingRequest({ user_id: 'u2', conversation_id: 'c2', message: 'Are you there?' }, n8nUrl);
    expect(resp).toBeDefined();
    // mapErrorToSadieResponse maps ECONNREFUSED to NETWORK_ERROR
    expect((resp as any).response).toBe('NETWORK_ERROR');
  });

  test('processIncomingRequest - image payload forwarded to n8n', async () => {
    const { server, port } = await startMockServer((req, body, res) => {
      if (req.method === 'POST' && req.url === '/webhook/sadie/chat') {
        // Ensure the images array was forwarded
        const hasImages = Array.isArray(body.images) && body.images.length > 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ assistant: { role: 'assistant', content: hasImages ? 'Received images' : 'No images' }, received: { images: !!body.images } }));
        return;
      }
      res.writeHead(404); res.end();
    });

    const n8nUrl = `http://127.0.0.1:${port}`;

    const imageBase64 = Buffer.from('fake-image-bytes').toString('base64');
    const resp = await processIncomingRequest({ user_id: 'u3', conversation_id: 'c3', message: 'See image', images: [{ filename: 'pic.png', data: imageBase64 }] }, n8nUrl);

    expect(resp).toBeDefined();
    expect((resp as any).success).toBe(true);
    expect((resp as any).data).toBeDefined();
    expect((resp as any).data.assistant.content).toContain('Received images');

    server.close();
  });
});
