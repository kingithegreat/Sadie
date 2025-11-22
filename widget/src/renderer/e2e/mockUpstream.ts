import http from 'http';
import { AddressInfo } from 'net';

export async function startMockUpstream(opts?: { chunkIntervalMs?: number; chunkCount?: number }) {
  // Active sessions keyed by streamId — used by tests to cancel specific streams
  const activeSessions: Map<string, { interval: NodeJS.Timer | null; res: http.ServerResponse }> = new Map();

  const server = http.createServer(async (req, res) => {
    // Accept both GET /mock-sse and POST /webhook/sadie/chat/stream (n8n-style) so tests
    // can run against either proxy or direct post paths.
    // Accept either the mock-sse path or the n8n-style POST path used by main
    // (note: SADIE_WEBHOOK_PATH is /webhook/sadie/chat so main posts to /webhook/sadie/chat/stream)
    // Use a permissive matcher so tests can exercise different routing options
    // Accept GET /mock-sse for direct SSE consumers and POST /webhook/sadie/chat/stream
    // (also accept /webhook/sadie/stream for backward compatibility). Allow either
    // GET or POST for the streaming endpoints so Playwright tests can use either
    // a simple GET or a POST-based streaming URL.
    if (
      req.url === '/mock-sse' ||
      (req.url === '/webhook/sadie/chat/stream' && (req.method === 'POST' || req.method === 'GET')) ||
      (req.url === '/webhook/sadie/stream' && (req.method === 'POST' || req.method === 'GET'))
    ) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      let count = 0;
      // Parse POST body (if POST) so we can register this stream under its streamId
      // (tests set streamId in the JSON request body when using the POST-style streaming endpoint)
      let parsedBody: any = undefined;
      if (req.method === 'POST') {
        try {
          let body = '';
          for await (const chunk of req) body += chunk.toString();
          parsedBody = body ? JSON.parse(body) : undefined;
        } catch (e) {
          // Ignore parse errors — we'll still stream default chunks
        }
      }
      // Allow tests to configure per-chunk delay & total chunks. Defaults provide
      // a reasonable balance between speed and cancellation determinism.
      // E2E tests need a bit more time to cancel cleanly—use a longer default
      const chunkInterval = opts?.chunkIntervalMs ?? 300;
      const chunkCount = opts?.chunkCount ?? 5;
      const interval = setInterval(() => {
        count++;
        res.write(`data: {"chunk":"chunk-${count}"}\n\n`);
        if (count >= chunkCount) {
          clearInterval(interval as any);
          res.end();
        }
      }, chunkInterval);

      // register session mapping if we have a streamId
      if (parsedBody && parsedBody.streamId) {
        activeSessions.set(parsedBody.streamId, { interval, res });
      }

      req.on('close', () => {
        clearInterval(interval as any);
        if (parsedBody && parsedBody.streamId) activeSessions.delete(parsedBody.streamId);
      });
      return;
    }

    // A test-only cancellation endpoint used by E2E harnesses. When main receives a
    // user-cancel it may POST to this path (only in tests) to instruct the mock
    // upstream to stop emitting for a specific streamId. This makes cancellation
    // deterministic in automated tests.
    if (req.url === '/__sadie_e2e_cancel' && req.method === 'POST') {
      try {
        let body = '';
        for await (const chunk of req) body += chunk.toString();
        const parsed = body ? JSON.parse(body) : undefined;
        if (parsed && parsed.streamId) {
          const session = activeSessions.get(parsed.streamId);
          if (session) {
            if (session.interval) clearInterval(session.interval as any);
            try { session.res.end(); } catch (e) {}
            activeSessions.delete(parsed.streamId);
          }
        }
      } catch (e) {
        // ignore
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    // default to the mock-sse endpoint for convenience
    url: `http://127.0.0.1:${port}/mock-sse`,
    // but since we don't know which path the caller wants, provide both bases
    baseUrl: `http://127.0.0.1:${port}`,
    mockSseUrl: `http://127.0.0.1:${port}/mock-sse`,
    n8nStreamUrl: `http://127.0.0.1:${port}/webhook/sadie/chat/stream`,
    legacyN8nStreamUrl: `http://127.0.0.1:${port}/webhook/sadie/stream`,
    // Provide a generic openai-style endpoint alias used by the proxy and tests
    openaiEndpoint: `http://127.0.0.1:${port}/mock-sse`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
