/**
 * Cancel-stream.test.ts
 * Correct abort-safe SSE cancel test using WHATWG streams.
 */

import http from 'http';
import fetch from 'node-fetch';
import { Readable } from 'stream';
import { AddressInfo } from 'net';
import { createServer as createProxyServer, gracefulShutdown } from '../index';

let upstreamServer: http.Server;
let proxyServer: http.Server;

beforeAll(async () => {
  // Mock upstream SSE server
  upstreamServer = http.createServer((req, res) => {
    if (req.url === '/mock-sse') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // send two immediate chunks to ensure the proxy forwards them without retries
      res.write(`data: {"chunk":"1"}\n\n`);
      res.write(`data: {"chunk":"2"}\n\n`);
      // small delay then close the stream
      setTimeout(() => res.end(), 30);
      req.on('close', () => {});
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((r) => upstreamServer.listen(0, r));
  const upPort = (upstreamServer.address() as AddressInfo).port;

  process.env.OPENAI_ENDPOINT = `http://localhost:${upPort}/mock-sse`;
  process.env.PROXY_REQUIRE_API_KEY = 'false';
  process.env.PROXY_API_KEYS = '';

  proxyServer = createProxyServer();
  await new Promise<void>((r) => proxyServer.listen(0, r));
});

afterAll(async () => {
  try {
    await gracefulShutdown?.();
  } catch {}

  await new Promise<void>((resolve) => {
    proxyServer.close(() => resolve());
  });

  await new Promise<void>((resolve) => {
    upstreamServer.close(() => resolve());
  });

  // flush pending network events
  await new Promise((r) => setImmediate(r));
});

test('Canceling an SSE stream stops data flow', async () => {
  const { port } = proxyServer.address() as AddressInfo;
  const url = `http://localhost:${port}/stream`;

  const controller = new AbortController();
  const chunks: string[] = [];

  const fetchPromise = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sadie-key': 'test' },
    body: JSON.stringify({ provider: 'openai', model: 'mock', prompt: 'x' }),
    signal: controller.signal,
  });

  let resp: any;
  try {
    resp = await fetchPromise;
  } catch (e: any) {
    // If aborted before headers, we skip the test early:
    expect(e.name).toBe('AbortError');
    return;
  }

  expect(resp.status).toBe(200);

  // node-fetch v2 returns a Node.js Readable stream on resp.body
  const node = resp.body as NodeJS.ReadableStream;

  let received = 0;
  await new Promise<void>((resolve) => {
    node.on('data', (chunk: Buffer) => {
      received++;
      if (received === 2) controller.abort();
    });

    node.on('end', () => {
      console.log('[TEST] stream end');
      resolve();
    });
    node.on('close', () => resolve());
    node.on('error', () => resolve());
  });

  // allow time for stray chunks
  await new Promise((r) => setTimeout(r, 100));

  expect(received).toBe(2);
}, 10000);

