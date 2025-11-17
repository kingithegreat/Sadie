import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fetch } from 'undici';

// This is a small, manual integration runner that starts the mock upstream and the proxy
// Then it fires a request to the proxy and ensures SSE events are forwarded.

async function run() {
  const projectRoot = path.join(__dirname, '..', '..');
  const proxyPath = path.join(projectRoot, 'dist', 'index.js');
  const mockPath = path.join(__dirname, 'mock-upstream.js');

  // Start mock upstream
  const mock = spawn('node', [mockPath], { cwd: path.dirname(mockPath), stdio: 'inherit', env: {...process.env, MOCK_UPSTREAM_PORT: '7000'} });
  console.log('Started mock upstream');

  // Start proxy (we assume build already done)
  const proxy = spawn('node', [proxyPath], { cwd: projectRoot, stdio: 'inherit', env: {...process.env, OPENAI_ENDPOINT: 'http://localhost:7000/sse'}});
  console.log('Started proxy');

  // Wait a bit for both to be ready
  await new Promise(res => setTimeout(res, 1000));

  // Fire the request to the proxy
  const body = {
    provider: 'openai',
    model: 'test-model',
    prompt: 'Test',
    images: [],
    headers: {}
  };

  const resp = await fetch('http://localhost:5050/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sadie-key': 'changeme' }, body: JSON.stringify(body)
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    while (buf.indexOf('\n\n') !== -1) {
      const idx = buf.indexOf('\n\n');
      const chunkText = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (chunkText.startsWith('data: ')) {
        const data = chunkText.slice(6);
        console.log('CHUNK: ', data);
      }
    }
  }

  // Cleanup
  proxy.kill(); mock.kill();
}

run().catch(e => { console.error(e); process.exit(1); });
