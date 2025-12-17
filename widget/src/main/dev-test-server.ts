import http from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import { streamFromOllamaWithTools, processIncomingRequest } from './message-router';
import path from 'path';
const axios = require(path.resolve(__dirname, '..', 'node_modules', 'axios'));

function jsonResponse(res: ServerResponse, obj: any) {
  const b = Buffer.from(JSON.stringify(obj, null, 2));
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(b.length) });
  res.end(b);
}

function collectBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => buf += c.toString());
    req.on('end', () => {
      try { resolve(JSON.parse(buf || '{}')); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

export function startDevTestServer(port = 8765) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/dev-test') {
      const body = await collectBody(req);
      const action = body.action || 'ping';

      // Provide canned axios behaviors used during tests
      axios.post = async (url: string, payload: any) => {
        if (payload && payload.messages && payload.messages.some((m: any) => typeof m.content === 'string' && m.content.includes('Return ONLY a single JSON object'))) {
          // reflection accept
          return { data: { assistant: JSON.stringify({ outcome: 'accept', final_message: 'Test Final Message' }) } };
        }
        if (payload && payload.stream) {
          // Provide a simple stream for streaming tests
          const { Readable } = require('stream');
          const stream = new Readable({ read() {} });
          // emit a few chunks
          setTimeout(() => stream.push(JSON.stringify({ message: { content: 'Chunk 1 ' } }) + '\n'), 10);
          setTimeout(() => stream.push(JSON.stringify({ message: { content: 'Chunk 2 ' } }) + '\n'), 60);
          setTimeout(() => stream.push(JSON.stringify({ done: true }) + '\n'), 120);
          setTimeout(() => stream.push(null), 140);
          return { data: stream };
        }
        // default simple assistant reply
        return { data: { data: { assistant: { role: 'assistant', content: 'Default LLM reply' } } } };
      };

      try {
        if (action === 'sports') {
          const resObj = await processIncomingRequest({ user_id: 'dev', message: "What's the Lakers next game?", conversation_id: 'dev' } as any, 'http://unused');
          return jsonResponse(res, resObj);
        }
        if (action === 'chat') {
          const resObj = await processIncomingRequest({ user_id: 'dev', message: 'hello', conversation_id: 'dev' } as any, 'http://unused');
          return jsonResponse(res, resObj);
        }
        if (action === 'joke') {
          let acc = '';
          const onChunk = (t: string) => { acc += t; };
          const onToolCall = () => {};
          const onToolResult = () => {};
          const onEnd = () => {};
          const onError = (err: any) => { console.error('stream error', err); };
          const handler = await streamFromOllamaWithTools('tell me a short joke', undefined, 'dev', onChunk, onToolCall, onToolResult, onEnd, onError);
          // wait briefly for stream to finish
          await new Promise(r => setTimeout(r, 300));
          return jsonResponse(res, { success: true, final: acc });
        }
        if (action === 'cancel-story') {
          let acc = '';
          const onChunk = (t: string) => { acc += t; };
          const onEnd = () => {};
          const onError = (err: any) => { console.error('stream error', err); };
          const handler = await streamFromOllamaWithTools('write me a very long story', undefined, 'dev', onChunk, () => {}, () => {}, onEnd, onError);
          setTimeout(() => handler.cancel(), 200);
          await new Promise(r => setTimeout(r, 500));
          return jsonResponse(res, { success: true, final: acc, cancelled: true });
        }

        // ping
        return jsonResponse(res, { ok: true, msg: 'dev-test server alive' });
      } catch (err: any) {
        return jsonResponse(res, { ok: false, error: String(err?.message || err) });
      }
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => console.log(`[DEV-TEST] Listening on http://localhost:${port}/dev-test`));
  return server;
}

// Start automatically in dev mode
if (process.env.NODE_ENV !== 'production') {
  try { startDevTestServer(8765); } catch (e) { console.error('Failed to start dev test server', e); }
}
