import http from 'http';
import { AddressInfo } from 'net';
import { processIncomingRequest } from '../message-router';
import { documentToolHandlers } from '../tools/documents';

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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('processIncomingRequest - successful LLM response from n8n', async () => {
    const { server, port } = await startMockServer((req, _body, res) => {
      if (req.method === 'POST' && req.url === '/webhook/homebot/chat') {
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
    // mapErrorToHomeBotResponse maps ECONNREFUSED to NETWORK_ERROR
    expect((resp as any).response).toBe('NETWORK_ERROR');
  });

  test('processIncomingRequest - image payload forwarded to n8n', async () => {
    const { server, port } = await startMockServer((req, body, res) => {
      if (req.method === 'POST' && req.url === '/webhook/homebot/chat') {
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

  test('processIncomingRequest - document payload is expanded before forwarding to n8n', async () => {
    const parseSpy = jest.spyOn(documentToolHandlers, 'parse_document').mockResolvedValue({
      success: true,
      result: { document_id: 'doc-1' }
    } as any);
    const contentSpy = jest.spyOn(documentToolHandlers, 'get_document_content').mockResolvedValue({
      success: true,
      result: { content: 'Midpoint review content here.' }
    } as any);

    let receivedBody: any = null;
    const { server, port } = await startMockServer((req, body, res) => {
      if (req.method === 'POST' && req.url === '/webhook/homebot/chat') {
        receivedBody = body;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ assistant: { role: 'assistant', content: 'Received document' } }));
        return;
      }
      res.writeHead(404); res.end();
    });

    const n8nUrl = `http://127.0.0.1:${port}`;

    const resp = await processIncomingRequest({
      user_id: 'u4',
      conversation_id: 'c4',
      message: '[Document attached: HOMEBOT_Midpoint_Review.docx]\n\nthis was you what do i think?',
      documents: [{
        id: 'doc-1',
        filename: 'HOMEBOT_Midpoint_Review.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 123,
        data: 'ZmFrZQ=='
      }]
    } as any, n8nUrl, { type: 'llm' } as any);

    expect(resp).toBeDefined();
    expect((resp as any).success).toBe(true);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(contentSpy).toHaveBeenCalledTimes(1);
    expect(receivedBody.message).toContain('=== Document: HOMEBOT_Midpoint_Review.docx ===');
    expect(receivedBody.message).toContain('Midpoint review content here.');
    expect(receivedBody.message).toContain('this was you what do i think?');

    server.close();
  });
});
