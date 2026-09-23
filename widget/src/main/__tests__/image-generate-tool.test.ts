jest.mock('../../shared/cloud-llm', () => ({ apiKeyForProvider: jest.fn(() => '') }));
jest.mock('../config-manager', () => ({ getSettings: jest.fn(() => ({})) }));
jest.mock('electron', () => ({ app: { getPath: () => '/tmp', getAppPath: () => '/tmp' } }));
jest.mock('../movie/gemini-image-adapter', () => ({
  generateGeminiImage: jest.fn(async () => { throw new Error('Gemini not configured in this test'); }),
  GEMINI_IMAGE_COST_MICRO_USD: 67000,
}));
/**
 * Image Generate Tool Tests
 *
 * Tests the definition shape and handler error paths.
 * Actual image generation requires running services (SD/n8n), so
 * network calls are mocked.
 */

// Mock http module used inside imageGenerateHandler
jest.mock('http', () => ({
  request: jest.fn(),
  Agent: class MockAgent { constructor() {} }
}));
jest.mock('https', () => ({
  request: jest.fn(),
  Agent: class MockAgent { constructor() {} }
}));
// trySDCpp shells out via child_process, not http — this file's own header
// says "network calls are mocked" but never mocked this, so it silently
// depended on no local sd.cpp binary ever existing on whatever machine ran
// the suite. True in CI, and false the moment a real local install exists:
// these tests then actually spawn sd-cli.exe and blow the 5s default jest
// timeout waiting on a real multi-second/minute generation. execFileSync is
// mocked too — trySDCpp's own GPU-device probe uses it.
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const { EventEmitter } = require('events');
    const proc = new EventEmitter() as any;
    proc.stderr = new EventEmitter();
    proc.stdout = new EventEmitter();
    queueMicrotask(() => proc.emit('close', 1));
    return proc;
  }),
  execFileSync: jest.fn(() => { throw new Error('no local backend in this test'); }),
}));

// The real, retired Imagen client runs underneath; the spy only records calls.
const mockGenerateImagen3 = jest.fn();
jest.mock('../tools/imagen', () => {
  const actual = jest.requireActual('../tools/imagen');
  return { ...actual, generateImagen3: (...args: any[]) => mockGenerateImagen3(...args) };
});
const { generateImagen3: realGenerateImagen3, IMAGEN3_RETIRED_MESSAGE } = jest.requireActual('../tools/imagen');

import { imageGenerateDef, imageGenerateHandler, setOpenaiApiKey } from '../tools/web';
import * as http from 'http';
import * as https from 'https';

const mockHttpRequest = http.request as jest.Mock;
const mockHttpsRequest = https.request as jest.Mock;

function mockN8nResponse(body: object, statusCode = 200) {
  const json = Buffer.from(JSON.stringify(body));
  const mockRes: any = {
    statusCode,
    on: jest.fn((event: string, handler: Function) => {
      if (event === 'data') handler(json);
      if (event === 'end') handler();
      return mockRes;
    })
  };
  const mockReq: any = {
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn()
  };
  mockHttpRequest.mockImplementation((_opts: any, callback: Function) => {
    callback(mockRes);
    return mockReq;
  });
}

/**
 * Record every HTTPS POST the tool makes, replying with `replies[hostname]`.
 * A host with no entry gets `{}` — which is what makes the free community
 * backend (Stable Horde) give up at once when it sees no job id, so the chain
 * reaches the paid OpenAI step. `write` is where httpPost sends the body.
 */
function recordHttpsPosts(replies: Record<string, object>) {
  const posts: Array<{ hostname: string; path: string; method: string; authorization?: string; body: any }> = [];
  mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
    const json = Buffer.from(JSON.stringify(replies[options.hostname] ?? {}));
    const mockRes: any = {
      statusCode: 200,
      on: jest.fn((event: string, handler: Function) => {
        if (event === 'data') handler(json);
        if (event === 'end') handler();
        return mockRes;
      })
    };
    const mockReq: any = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn((chunk: any) => {
        posts.push({
          hostname: options.hostname,
          path: options.path,
          method: options.method,
          authorization: options.headers?.Authorization,
          body: JSON.parse(String(chunk))
        });
        return true;
      }),
      end: jest.fn(),
      destroy: jest.fn()
    };
    callback(mockRes);
    return mockReq;
  });
  return posts;
}

/**
 * Set up a run in which only the paid OpenAI step can produce an image: n8n
 * answers with no images (so the local engines fail), every free cloud host
 * answers `{}`, and `api.openai.com` answers `openAiReply`. Takes the paid
 * host's reply directly — the caller never has to know it is keyed by
 * hostname, which is exactly the mistake that reads as "the tool is broken".
 */
function onlyOpenAICanAnswer(openAiReply: object) {
  const posts = recordHttpsPosts({ 'api.openai.com': openAiReply });
  mockN8nResponse({ images: [] });
  return posts;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerateImagen3.mockReset().mockImplementation(realGenerateImagen3);
});

describe('imageGenerateDef', () => {
  test('has correct name', () => {
    expect(imageGenerateDef.name).toBe('image_generate');
  });

  test('requires prompt', () => {
    expect(imageGenerateDef.parameters.required).toContain('prompt');
  });

  test('backend has valid enum', () => {
    const backendProp = imageGenerateDef.parameters.properties.backend;
    expect(backendProp.enum).toContain('local');
    expect(backendProp.enum).toContain('cloud');
    expect(backendProp.enum).toContain('hybrid');
    // Google retired Imagen 3 (Nov 2025): a model can no longer choose it.
    expect(backendProp.enum).not.toContain('imagen');
    expect(backendProp.enum).not.toContain('imagen-3');
    expect(backendProp.description).toMatch(/retired/);
  });

  test('advertises no retired image model id', () => {
    const surface = JSON.stringify(imageGenerateDef);
    // DALL·E was removed from the API on 2026-05-12 (OpenAI's deprecations
    // page): nothing a model can read may name it, or the agent will keep
    // asking a backend that cannot answer.
    expect(surface).not.toMatch(/dall-?e/i);
    // The paid model is named instead, so a caller knows what it is billed for.
    expect(surface).toMatch(/gpt-image-2\.5/);
  });
});

describe('imageGenerateHandler', () => {

  beforeEach(() => {
    const { apiKeyForProvider } = require('../../shared/cloud-llm');
    const { getSettings } = require('../config-manager');
    const { generateGeminiImage } = require('../movie/gemini-image-adapter');
    (apiKeyForProvider as jest.Mock).mockReset().mockReturnValue('');
    (getSettings as jest.Mock).mockReset().mockReturnValue({});
    (generateGeminiImage as jest.Mock).mockReset().mockImplementation(async () => {
      throw new Error('Gemini not configured in this test');
    });
  });

  test('rejects empty prompt', async () => {
    const res = await imageGenerateHandler({ prompt: '' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('prompt');
  });

  test('returns image on success', async () => {
    // Mock the AUTOMATIC1111 SD API response format
    mockN8nResponse({ images: ['base64encodedimage=='] });

    const res = await imageGenerateHandler({ prompt: 'a cat' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.image_base64).toBe('base64encodedimage==');
    expect(res.result.source).toBe('automatic1111');
  });

  test.each(['imagen', 'imagen-3'])('a legacy %s request gets the retirement message and no network request', async backend => {
    const res = await imageGenerateHandler({ prompt: 'a glowing nebula', backend }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toBe(IMAGEN3_RETIRED_MESSAGE);
    expect(mockGenerateImagen3).toHaveBeenCalledTimes(1);
    expect(mockHttpRequest).not.toHaveBeenCalled();
    expect((require('https').request as jest.Mock)).not.toHaveBeenCalled();
  });

  test('hybrid mode never produces an Imagen image; the retired client refuses instantly', async () => {
    mockN8nResponse({ images: [] }); // local engines have nothing
    const res = await imageGenerateHandler({ prompt: 'a futuristic city', backend: 'hybrid' }, {} as any);
    expect(mockGenerateImagen3).toHaveBeenCalledTimes(1);
    await expect(mockGenerateImagen3.mock.results[0].value).rejects.toMatchObject({ code: 'IMAGEN3_RETIRED' });
    expect(res.result?.source).not.toBe('imagen-3');
  });

  
  test('hybrid mode prefers Gemini over Pollinations when a Google key is saved', async () => {
    const { generateGeminiImage } = require('../movie/gemini-image-adapter');
    const { apiKeyForProvider } = require('../../shared/cloud-llm');
    (apiKeyForProvider as jest.Mock).mockImplementation((_s: any, p: string) => p === 'google-ai-studio' ? 'test-gemini-key' : '');
    (generateGeminiImage as jest.Mock).mockResolvedValue({ base64: 'Z2VtaW5pLWltYWdl', mimeType: 'image/png' });
    mockN8nResponse({ images: [] });
    const res = await imageGenerateHandler({ prompt: 'a harbour at dusk', backend: 'hybrid' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.source).toBe('gemini-3.1-flash-image');
    expect(generateGeminiImage).toHaveBeenCalled();
    expect(JSON.stringify(res)).not.toMatch(/pollinations/i);
  });

  test('a recorded OpenAI request uses the current GPT Image model, not a retired one', async () => {
    const OPENAI_B64 = 'ZmFrZS1ncHQtaW1hZ2U=';
    setOpenaiApiKey('sk-test-openai');
    try {
      const posts = recordHttpsPosts({ 'api.openai.com': { data: [{ b64_json: OPENAI_B64 }] } });
      mockN8nResponse({ images: [] }); // no local engine has anything to draw with

      const res = await imageGenerateHandler({ prompt: 'a lighthouse at dusk' }, {} as any);

      expect(res.success).toBe(true);
      expect(res.result.source).toBe('gpt-image');
      expect(res.result.image_base64).toBe(OPENAI_B64);
      expect(res.result.metadata.model).toBe('gpt-image-2.5-flare');
      expect(res.result.metadata.costMicroUsd).toBeGreaterThan(0);

      // The recorded request: exact endpoint, method, auth header and body.
      const paid = posts.filter(p => p.hostname === 'api.openai.com');
      expect(paid).toHaveLength(1);
      expect(paid[0].method).toBe('POST');
      expect(paid[0].path).toBe('/v1/images/generations');
      expect(paid[0].authorization).toBe('Bearer sk-test-openai');
      expect(paid[0].body).toEqual({
        model: 'gpt-image-2.5-flare',
        prompt: 'a lighthouse at dusk',
        n: 1,
        size: '1024x1024'
      });
      // The GPT Image models always return b64_json, so response_format is not
      // an accepted parameter — sending it would be a 400.
      expect(paid[0].body).not.toHaveProperty('response_format');
      expect(JSON.stringify(posts)).not.toMatch(/dall-?e/i);
    } finally {
      setOpenaiApiKey(null);
    }
  });

  test('bills the published token rates from the response usage', async () => {
    setOpenaiApiKey('sk-test-openai');
    try {
      // The guide's own worked example: a 1024x1024 image at medium quality is
      // 439 output tokens. At $30 per 1M output tokens that is $0.01317, plus
      // 100 micro-USD for 20 prompt tokens at $5 per 1M — never the old flat
      // $0.04, which matches no documented size/quality pair.
      onlyOpenAICanAnswer({ data: [{ b64_json: 'AAAA' }], usage: {
        input_tokens: 20,
        output_tokens: 439,
        input_tokens_details: { text_tokens: 20, image_tokens: 0 },
        output_tokens_details: { image_tokens: 439, text_tokens: 0 }
      } });

      const res = await imageGenerateHandler({ prompt: 'a lighthouse at dusk', width: 1024, height: 1024 }, {} as any);
      expect(res.result.metadata.costMicroUsd).toBe(20 * 5 + 439 * 30);
    } finally {
      setOpenaiApiKey(null);
    }
  });

  test('bills input image tokens at the image rate, not the text rate', async () => {
    setOpenaiApiKey('sk-test-openai');
    try {
      onlyOpenAICanAnswer({ data: [{ b64_json: 'AAAA' }], usage: {
        input_tokens_details: { text_tokens: 10, image_tokens: 1000 },
        output_tokens_details: { image_tokens: 100 }
      } });

      const res = await imageGenerateHandler({ prompt: 'a map of the coast' }, {} as any);
      // 10x$5 text + 1000x$8 image input + 100x$30 image output
      expect(res.result.metadata.costMicroUsd).toBe(50 + 8000 + 3000);
    } finally {
      setOpenaiApiKey(null);
    }
  });

  test.each([
    [1024, 1024, '1024x1024'],
    [1024, 512, '1536x1024'],
    [512, 1024, '1024x1536']
  ])('a %ix%i request asks OpenAI for its nearest allowed size (%s)', async (width, height, size) => {
    setOpenaiApiKey('sk-test-openai');
    try {
      const posts = recordHttpsPosts({ 'api.openai.com': { data: [{ b64_json: 'AAAA' }] } });
      mockN8nResponse({ images: [] });
      await imageGenerateHandler({ prompt: 'a map of the coast', width, height }, {} as any);
      const paid = posts.filter(p => p.hostname === 'api.openai.com');
      expect(paid).toHaveLength(1);
      expect(paid[0].body.size).toBe(size);
    } finally {
      setOpenaiApiKey(null);
    }
  });

  test('with no OpenAI key the paid step makes no request at all', async () => {
    setOpenaiApiKey(null);
    const posts = recordHttpsPosts({ 'api.openai.com': { data: [{ b64_json: 'AAAA' }] } });
    mockN8nResponse({ images: [] });

    const res = await imageGenerateHandler({ prompt: 'a lighthouse at dusk' }, {} as any);

    expect(res.success).toBe(false);
    expect(posts.filter(p => p.hostname === 'api.openai.com')).toHaveLength(0);
  });

  test('returns error when n8n reports failure', async () => {
    mockN8nResponse({
      status: 'failure',
      error: { message: 'No provider available', code: 'NO_PROVIDER_AVAILABLE' }
    });

    const res = await imageGenerateHandler({ prompt: 'a dog' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('All image backends failed');
  });

  test('clamps width and height to max 1024', async () => {
    // Mock SD API response (images[] not present → returns null, but clamping still runs)
    mockN8nResponse({ images: [] });
    await imageGenerateHandler({ prompt: 'big', width: 2000, height: 2000 }, {} as any);
    // Should not throw — clamped to 1024 internally
    // handler sends request; check write was called with clamped values
    const writeCall = (mockHttpRequest.mock.results[0]?.value as any)?.write?.mock?.calls?.[0]?.[0];
    if (writeCall) {
      const parsed = JSON.parse(writeCall);
      // SD API body has width/height directly, not nested under .payload
      expect(parsed.width).toBeLessThanOrEqual(1024);
      expect(parsed.height).toBeLessThanOrEqual(1024);
    }
  });
});
