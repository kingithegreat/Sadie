import http from 'http';

// Simple mock SSE server to stream a few messages and then [DONE]
const PORT = process.env.MOCK_UPSTREAM_PORT ? parseInt(process.env.MOCK_UPSTREAM_PORT) : 7000;

const server = http.createServer((req, res) => {
  if (req.url === '/sse' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    const msgs = ['Hello from mock upstream', 'Second chunk', 'Third chunk'];
    let i = 0;
    const interval = setInterval(() => {
      if (i < msgs.length) {
        res.write(`data: ${JSON.stringify({ message: msgs[i] })}\n\n`);
        i += 1;
      } else {
        res.write('data: [DONE]\n\n');
        clearInterval(interval);
        res.end();
      }
    }, 200);
  } else if (req.url === '/raw' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('First line\n');
    setTimeout(() => res.write('Second line\n'), 150);
    setTimeout(() => { res.write('Third line\n'); res.end(); }, 300);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Mock upstream listening on ${PORT}`);
});

process.on('SIGINT', () => { server.close(); process.exit(0); });
