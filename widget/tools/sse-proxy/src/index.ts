import express, { Request, Response } from 'express';
import crypto from 'crypto';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fetch } from 'undici';
import Redis from 'ioredis';

// --- Config ---
dotenv.config();
const configPath = path.join(__dirname, '../proxy.config.json');
let config: any = {
  port: process.env.PORT || 5050,
  allowOrigins: ['*'],
  maxBodySize: '12mb',
  requestTimeoutMs: 120000
};
if (fs.existsSync(configPath)) {
  const cfgRaw = fs.readFileSync(configPath, 'utf-8');
  try { config = { ...config, ...JSON.parse(cfgRaw) }; } catch (err) { console.warn('Invalid proxy.config.json'); }
}

const app = express();
app.use(cors({ origin: config.allowOrigins }));
app.use(express.json({ limit: config.maxBodySize }));
app.use(morgan('combined'));

// Basic /health
app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));
app.get('/healthz', async (_req: Request, res: Response) => {
  const status: any = { ok: true };
  try {
    if (redisClient) {
      const pong = await redisClient.ping();
      status.redis = pong === 'PONG' ? 'ok' : pong;
    } else {
      status.redis = 'unconfigured';
    }
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// SSE helper
function sendSSE(res: Response, data: any) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`data: ${payload}\n\n`);
}

// Line buffer parser for SSE-style streams (data: ... lines)
async function streamModelResponseToClient(res: Response, upstreamResponse: any) {
  // upstreamResponse.body is a ReadableStream (Node fetch / undici)
  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue; // ignore blank
        // SSE: lines often start with 'data:'
        const dataPrefix = 'data:';
        if (line.startsWith(dataPrefix)) {
          const json = line.slice(dataPrefix.length).trim();
          if (json === '[DONE]') {
            sendSSE(res, '[DONE]');
            return;
          }
          try {
            const parsed = JSON.parse(json);
            sendSSE(res, { chunk: parsed });
          } catch (err) {
            // Not JSON — send as raw chunk
            sendSSE(res, { chunk: json });
          }
        } else {
          // Not SSE format — forward raw line
          sendSSE(res, { chunk: line });
        }
      }
    }
    done = !!streamDone;
  }
}

// Generalized sink-based stream handlers to forward upstream chunks to a sink
async function streamModelResponseToSink(upstreamResponse: any, sink: (data: any) => void) {
  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const dataPrefix = 'data:';
        if (line.startsWith(dataPrefix)) {
          const json = line.slice(dataPrefix.length).trim();
          if (json === '[DONE]') {
            sink({ done: true });
            return;
          }
          try {
            const parsed = JSON.parse(json);
            sink({ chunk: parsed });
          } catch (err) {
            sink({ chunk: json });
          }
        } else {
          sink({ chunk: line });
        }
      }
    }
    done = !!streamDone;
  }
}

async function streamRawLinesToSink(upstreamResponse: any, sink: (data: any) => void) {
  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        sink({ chunk: line });
      }
    }
    if (done) break;
  }
  if (buffer.trim()) sink({ chunk: buffer.trim() });
  sink({ done: true });
}

export { streamModelResponseToSink, streamRawLinesToSink };

// parse an upstream raw text stream too (non-SSE). Collect chunks and forward.
async function streamRawLinesToClient(res: Response, upstreamResponse: any) {
  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        sendSSE(res, { chunk: line });
      }
    }
    if (done) break;
  }
  // Flush remainder
  if (buffer.trim()) sendSSE(res, { chunk: buffer.trim() });
  sendSSE(res, '[DONE]');
}

function isValidRequestBody(body: any) {
  if (!body) return false;
  if (!body.provider) return false;
  if (!['openai', 'ollama'].includes(body.provider)) return false;
  if (!body.model) return false;
  if (!body.prompt && !body.messages && !body.images) return false;
  return true;
}

// --- API key setup ---
const envKeysRaw = process.env.PROXY_API_KEYS || process.env.PROXY_API_KEY || '';
let configKeys: string[] = [];
if (Array.isArray(config.proxyApiKeys)) {
  if (config.encryptedKeys && process.env.KEY_ENCRYPTION_SECRET) {
    try { configKeys = (config.proxyApiKeys as string[]).map(k => decryptKey(k, process.env.KEY_ENCRYPTION_SECRET as string)); } catch (e) { configKeys = []; }
  } else {
    configKeys = config.proxyApiKeys as string[];
  }
}
const envKeys = envKeysRaw ? envKeysRaw.split(',').map((k: string) => k.trim()).filter(Boolean) : [];
const apiKeys: string[] = envKeys.length ? envKeys : configKeys;
const requireApiKey = (() => {
  if (process.env.PROXY_REQUIRE_API_KEY) return process.env.PROXY_REQUIRE_API_KEY === 'true';
  if (typeof config.requireApiKey !== 'undefined') return !!config.requireApiKey;
  return false;
})();

// Pre-hash keys into a fixed-length digest and a constant-time compare
function sha256(key: string): Buffer {
  return crypto.createHash('sha256').update(key).digest();
}
const hashedApiKeys = apiKeys.map(k => sha256(k));

function isValidApiKey(providedKey: string | undefined): boolean {
  if (!requireApiKey) return true; // not required by config
  if (!providedKey) return false;
  const keyHash = sha256(providedKey);
  for (const hk of hashedApiKeys) {
    try {
      if (hk.length === keyHash.length && crypto.timingSafeEqual(hk, keyHash)) return true;
    } catch (e) { /* ignore */ }
  }
  return false;
}

// --- Encryption helpers ---
function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptKey(text: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptKey(payload: string, secret: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Invalid payload');
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

// --- Rate limiting (use Redis if available) ---
const rateLimitWindow = (process.env.RATE_LIMIT_WINDOW_MS && parseInt(process.env.RATE_LIMIT_WINDOW_MS)) || (config.rateLimit && config.rateLimit.windowMs) || 60000;
const rateLimitMax = (process.env.RATE_LIMIT_MAX && parseInt(process.env.RATE_LIMIT_MAX)) || (config.rateLimit && config.rateLimit.maxRequests) || 30;
let redisClient: Redis | null = null;
if (process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL);
  console.log('Using Redis for rate limiting');
}

const keyRateMap: Map<string, { count: number; resetAt: number }> = new Map();

async function checkRateLimitForKey(key: string): Promise<boolean> {
  const now = Date.now();
  if (redisClient) {
    try {
      const keyName = `ratelimit:${key}`;
      const current = await redisClient.incr(keyName);
      if (current === 1) await redisClient.pexpire(keyName, rateLimitWindow);
      return current <= rateLimitMax;
    } catch (e) {
      // fallback to in-memory on Redis error
    }
  }
  const existing = keyRateMap.get(key);
  if (!existing || existing.resetAt < now) {
    keyRateMap.set(key, { count: 1, resetAt: now + rateLimitWindow });
    return true;
  }
  if (existing.count >= rateLimitMax) return false;
  existing.count += 1;
  return true;
}

// --- Admin key management ---
const adminApiKey = (process.env.ADMIN_API_KEY && process.env.ADMIN_API_KEY.trim()) || (config.admin && config.admin.adminApiKey) || 'adminchangeme';
const adminHashed = sha256(adminApiKey);
const adminEnabled = typeof process.env.ADMIN_ENDPOINT_ENABLED !== 'undefined' ? process.env.ADMIN_ENDPOINT_ENABLED === 'true' : (config.admin && !!config.admin.enabled);
const persistKeys = typeof process.env.PROXY_PERSIST_KEYS !== 'undefined' ? process.env.PROXY_PERSIST_KEYS === 'true' : !!config.persistKeys;

function persistKeysToConfigFile(keys: string[]) {
  if (!persistKeys) return;
  try {
    const cfgRaw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // encrypt keys if encryption secret is provided
    if (process.env.KEY_ENCRYPTION_SECRET) {
      cfgRaw.proxyApiKeys = keys.map(k => encryptKey(k, process.env.KEY_ENCRYPTION_SECRET as string));
      cfgRaw.encryptedKeys = true;
    } else {
      cfgRaw.proxyApiKeys = keys;
      cfgRaw.encryptedKeys = false;
    }
    fs.writeFileSync(configPath, JSON.stringify(cfgRaw, null, 2));
  } catch (e) { console.warn('Failed to persist proxyApiKeys to config'); }
}

function getPlainKeysFromHashed(): string[] {
  // We don't store plain keys; use config.proxyApiKeys or env for plain keys
  if (envKeys.length) return envKeys;
  if (Array.isArray(config.proxyApiKeys)) {
    const keysRaw = config.proxyApiKeys as string[];
    if (config.encryptedKeys && process.env.KEY_ENCRYPTION_SECRET) {
      try { return keysRaw.map(k => decryptKey(k, process.env.KEY_ENCRYPTION_SECRET as string)); } catch (e) { return []; }
    }
    return keysRaw as string[];
  }
  return [];
}

// Forward request with streaming
app.post('/stream', async (req: Request, res: Response) => {
  // Validate request body first
  if (!isValidRequestBody(req.body)) {
    return res.status(400).json({ error: 'Invalid request body: missing provider/model or content' });
  }

  // API key validation - use header `x-sadie-key` and do constant-time comparison
  const headerKeyRaw = ((req.headers['x-sadie-key'] || req.headers['X-Sadie-Key']) as string) || undefined;
  if (!isValidApiKey(headerKeyRaw)) {
    // Return SSE error frame + 401 status
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-transform, no-cache');
    res.setHeader('Connection', 'close');
    sendSSE(res, { error: true, code: 'AUTH_FAILED', message: 'Invalid or missing API key' });
    res.status(401).end();
    return;
  }

  // Rate limit check
  const rateKey = headerKeyRaw || req.ip;
  if (!(await checkRateLimitForKey(rateKey))) {
    res.setHeader('Content-Type', 'text/event-stream');
    sendSSE(res, { error: true, code: 'RATE_LIMIT', message: 'Rate limit exceeded' });
    res.status(429).end();
    return;
  }

  const { provider, model, prompt, messages, images, headers } = req.body;
  // choose endpoint from config
  const endpoint = (provider === 'openai') ? (process.env.OPENAI_ENDPOINT || config.openai?.endpoint) : (process.env.OLLAMA_ENDPOINT || config.ollama?.endpoint);
  if (!endpoint) return res.status(500).json({ error: 'No endpoint configured for provider' });

  // set up SSE response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-transform, no-cache');
  res.setHeader('Connection', 'keep-alive');
  // CORS handled by app

  // Abort controller / timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs || 120000);

  // Cancel upstream on client disconnect
  const onClose = () => {
    controller.abort();
    clearTimeout(timeoutId);
  };
  req.on('close', onClose);

  try {
    // Build fetch options depending on provider specifics
    const fetchHeaders: Record<string, string> = { 'Accept': 'text/event-stream', 'Content-Type': 'application/json' };
    if (headers && typeof headers === 'object') {
      for (const key of Object.keys(headers)) {
        // prevent overriding host/connection sensitive headers
        const lower = key.toLowerCase();
        if (['host', 'connection'].includes(lower)) continue;
        fetchHeaders[key] = headers[key];
      }
    }

    // A helper body builder
    const bodyObject: any = {
      model,
    };
    if (messages) bodyObject.messages = messages;
    if (prompt) bodyObject.input = prompt;
    if (images) bodyObject.images = images; // forwarding base64 images

    // Security: check whitelistHosts if provided
    if (config.whitelistHosts && Array.isArray(config.whitelistHosts) && config.whitelistHosts.length > 0) {
      try {
        const urlStr = (provider === 'openai') ? (process.env.OPENAI_ENDPOINT || config.openai?.endpoint) : (process.env.OLLAMA_ENDPOINT || config.ollama?.endpoint);
        const parsed = new URL(urlStr);
        const host = parsed.hostname;
        const ok = config.whitelistHosts.includes('*') || config.whitelistHosts.includes(host);
        if (!ok) {
          sendSSE(res, { error: true, message: 'Endpoint host not allowed by proxy configuration' });
          res.end();
          return;
        }
      } catch (e) { /* pass */ }
    }

    // For OpenAI prefer the new responses streaming format
    let upstreamResponse: any;
    if (provider === 'openai') {
      const url = process.env.OPENAI_ENDPOINT || (config.openai ? config.openai.endpoint : undefined);
      if (!url) throw new Error('OPENAI endpoint not configured');
      // If enforceServerAuth, reject if client tries to send Authorization header and replace it with server-side token
      if ((config.enforceServerAuth || process.env.ENFORCE_SERVER_AUTH === 'true') && headers && headers.Authorization) {
        sendSSE(res, { error: true, code: 'AUTH_OVERRIDE_FORBIDDEN', message: 'Client Authorization headers are not allowed for OpenAI requests' });
        res.status(403).end();
        return;
      }
      // If enforceServerAuth, override Authorization with server-side token
      if (config.enforceServerAuth || process.env.ENFORCE_SERVER_AUTH === 'true') {
        fetchHeaders['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY}`;
      }
      upstreamResponse = await fetch(url, {
        method: 'POST',
        headers: fetchHeaders,
        body: JSON.stringify({ model, input: prompt || messages || '', messages, images }),
        signal: controller.signal as any,
      });
    } else {
      // Ollama: send a POST to the configured endpoint
      const url = process.env.OLLAMA_ENDPOINT || (config.ollama ? config.ollama.endpoint : undefined);
      if (!url) throw new Error('OLLAMA endpoint not configured');
      // For Ollama, optionally override auth if set
      if (config.enforceServerAuth || process.env.ENFORCE_SERVER_AUTH === 'true') {
        if (process.env.OLLAMA_API_KEY) fetchHeaders['Authorization'] = `Bearer ${process.env.OLLAMA_API_KEY}`;
      }
      upstreamResponse = await fetch(url, {
        method: 'POST',
        headers: fetchHeaders,
        body: JSON.stringify({ model, prompt, messages, images }),
        signal: controller.signal as any,
      });
    }

    // await the status
    const statusCode = upstreamResponse.status;
    if (!statusCode || statusCode >= 400) {
      const text = await upstreamResponse.text();
      sendSSE(res, { error: true, message: `Upstream error: ${statusCode}`, raw: text });
      res.end();
      return;
    }

    // Stream the upstream response to SSE
    // Prefer SSE parsing if header contains text/event-stream
    const contentType = upstreamResponse.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      await streamModelResponseToClient(res, upstreamResponse);
    } else {
      await streamRawLinesToClient(res, upstreamResponse);
    }

  } catch (err: any) {
    // handle aborts
    if (err.name === 'AbortError' || err.code === 'ECONNRESET') {
      sendSSE(res, { error: true, message: 'Request aborted by client or timed out' });
    } else {
      sendSSE(res, { error: true, message: err.message || String(err) });
    }
  } finally {
    res.end();
  }
});

// --- Admin endpoints (key rotation) ---
if (adminEnabled) {
  const adminAuth = (req: Request): boolean => {
    const adminKey = (req.headers['x-sadie-admin-key'] || req.headers['X-Sadie-Admin-Key']) as string | undefined;
    if (!adminKey) return false;
    try {
      return crypto.timingSafeEqual(sha256(adminKey), adminHashed);
    } catch (e) { return false; }
  };

  app.get('/admin/keys', (req: Request, res: Response) => {
    if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const rawKeys = getPlainKeysFromHashed();
    const keys = rawKeys.map((k: string) => ({ masked: k ? k.slice(0, 4) + '...' : '' }));
    res.json({ keys });
  });

  app.post('/admin/keys', (req: Request, res: Response) => {
    if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { key } = req.body;
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'Missing key' });
    // Add to config (in-memory / persisted)
    const plainKeys = getPlainKeysFromHashed();
    if (plainKeys.includes(key)) return res.status(409).json({ error: 'Key already exists' });
    plainKeys.push(key);
    // Update hashed keys
    hashedApiKeys.push(sha256(key));
    persistKeysToConfigFile(plainKeys);
    res.json({ ok: true });
  });

  app.delete('/admin/keys', (req: Request, res: Response) => {
    if (!adminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { key } = req.body;
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'Missing key' });
    const plainKeys = getPlainKeysFromHashed();
    const idx = plainKeys.indexOf(key);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    plainKeys.splice(idx, 1);
    // rebuild hashedApiKeys
    while (hashedApiKeys.length) hashedApiKeys.pop();
    for (const k of plainKeys) hashedApiKeys.push(sha256(k));
    persistKeysToConfigFile(plainKeys);
    res.json({ ok: true });
  });

  // Admin UI - serve a simple admin page if admin header present
  app.get('/admin/ui', (req: Request, res: Response) => {
    if (!adminAuth(req)) return res.status(401).send('Unauthorized');
    const uiPath = path.join(__dirname, 'admin', 'index.html');
    res.sendFile(uiPath);
  });
}

// Basic ping health check already done
export { encryptKey, decryptKey, isValidApiKey };
export default app;
