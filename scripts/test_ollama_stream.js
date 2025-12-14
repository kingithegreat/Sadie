const http = require('http');
const data = JSON.stringify({
  model: 'llama3.2:3b',
  messages: [
    { role: 'system', content: 'You are Sadie, be concise.' },
    { role: 'user', content: 'Write a long essay (200 words) about local LLM streaming.' }
  ],
  stream: true
});

const options = {
  hostname: 'localhost',
  port: 11434,
  path: '/api/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  console.log('statusCode', res.statusCode);
  res.on('data', (chunk) => {
    process.stdout.write('CHUNK: ' + chunk.toString());
  });
  res.on('end', () => {
    console.log('\nSTREAM END');
  });
});

req.on('error', (e) => {
  console.error('problem with request:', e.message);
});

req.write(data);
req.end();
