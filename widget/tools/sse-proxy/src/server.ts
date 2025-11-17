import app, { streamModelResponseToSink, streamRawLinesToSink } from './index';
import http from 'http';
import { WebSocketServer } from 'ws';
const configPath = require('path').join(__dirname, '../proxy.config.json');
let config = {} as any;
try { config = require(configPath); } catch (e) { /* ignore */ }
const port = process.env.PORT || config.port || 5050;

const server = http.createServer(app);

// WebSocket server for direct WebSocket streaming clients
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket: any) => {
	console.log('WS client connected');
	let upstreamController: AbortController | null = null;
	socket.on('message', async (data: any) => {
		try {
			const parsed = JSON.parse(data.toString());
			const { provider, model, prompt, messages, images, headers } = parsed;
			if (!provider || !model || (!prompt && !messages && !images)) {
				socket.send(JSON.stringify({ error: true, message: 'Invalid request body' }));
				return;
			}
			// Build fetch options
			const fetchHeaders: Record<string, string> = { 'Accept': 'text/event-stream', 'Content-Type': 'application/json' };
			if (headers && typeof headers === 'object') {
				for (const key of Object.keys(headers)) {
					const lower = key.toLowerCase();
					if (['host', 'connection'].includes(lower)) continue;
					fetchHeaders[key] = headers[key];
				}
			}
			// server-side auth enforcement
			if (config.enforceServerAuth || process.env.ENFORCE_SERVER_AUTH === 'true') {
				if (provider === 'openai' && process.env.OPENAI_API_KEY) fetchHeaders['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY}`;
				if (provider === 'ollama' && process.env.OLLAMA_API_KEY) fetchHeaders['Authorization'] = `Bearer ${process.env.OLLAMA_API_KEY}`;
			}
			const url = (provider === 'openai') ? (process.env.OPENAI_ENDPOINT || config.openai?.endpoint) : (process.env.OLLAMA_ENDPOINT || config.ollama?.endpoint);
			if (!url) { socket.send(JSON.stringify({ error: true, message: 'No upstream endpoint configured' })); return; }
			upstreamController = new AbortController();
			const upstreamResp = await fetch(url, {
				method: 'POST', headers: fetchHeaders, body: JSON.stringify({ model, input: prompt || messages || '', messages, images }), signal: upstreamController.signal as any
			});
			const contentType = upstreamResp.headers.get('content-type') || '';
			const sendSink = (d: any) => { try { socket.send(JSON.stringify(d)); } catch (e) { /* ignore */ } };
			if (contentType.includes('text/event-stream')) {
				await streamModelResponseToSink(upstreamResp, sendSink);
			} else {
				await streamRawLinesToSink(upstreamResp, sendSink);
			}
		} catch (err: any) {
			try { socket.send(JSON.stringify({ error: true, message: err?.message || String(err) })); } catch (e) { }
		}
	});
	socket.on('close', () => { if (upstreamController) upstreamController.abort(); console.log('WS client disconnected'); });
});

server.listen(port, () => console.log(`SADIE SSE Proxy listening on port ${port}`));
export default app;
