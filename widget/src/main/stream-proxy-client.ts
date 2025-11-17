import axios from 'axios';
import { Readable } from 'stream';

export interface StreamProxyOptions {
  proxyUrl?: string; // full proxy endpoint e.g. http://localhost:5050/stream
  apiKey?: string; // x-sadie-key
}

export function streamFromSadieProxy(body: any, onChunk: (chunk: string) => void, onEnd?: () => void, onError?: (err: any) => void, opts?: StreamProxyOptions) {
  const proxyUrl = opts?.proxyUrl || process.env.SADIE_PROXY_URL || 'http://localhost:5050/stream';
  const apiKey = opts?.apiKey || process.env.PROXY_API_KEYS || process.env.PROXY_API_KEY || '';

  // Setup abort controller for canceling the request
  const controller = new AbortController();
  const config: any = {
    responseType: 'stream',
    timeout: 0,
    signal: controller.signal as any,
    headers: {
      'Content-Type': 'application/json'
    }
  };
  if (apiKey) config.headers['x-sadie-key'] = Array.isArray(apiKey) ? apiKey[0] : String(apiKey).split(',')[0];

  let canceled = false;

  axios.post(proxyUrl, body, config).then((res) => {
    const stream = res.data as Readable;
    stream.on('data', (chunk: Buffer) => {
      if (canceled) return;
      try {
        const text = chunk.toString('utf8');
        // forward raw chunk text to onChunk - controller caller can parse SSE or raw lines
        onChunk(text);
      } catch (err) {
        // ignore parsing errors
      }
    });
    stream.on('end', () => {
      try { onEnd?.(); } catch (e) {}
    });
    stream.on('error', (err: any) => {
      onError?.(err);
    });
  }).catch((err) => {
    if (axios.isCancel(err)) return;
    onError?.(err);
  });

  return {
    cancel: () => {
      canceled = true;
      try { controller.abort(); } catch (e) {}
    }
  };
}

export default streamFromSadieProxy;
