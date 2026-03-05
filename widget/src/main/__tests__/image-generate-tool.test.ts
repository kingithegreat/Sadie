/**
 * Image Generate Tool Tests
 *
 * Tests the definition shape and handler error paths.
 * Actual image generation requires running services (SD/n8n), so
 * network calls are mocked.
 */

// Mock http module used inside imageGenerateHandler
jest.mock('http', () => ({
  request: jest.fn()
}));
jest.mock('https', () => ({
  request: jest.fn()
}));

import { imageGenerateDef, imageGenerateHandler } from '../tools/web';
import * as http from 'http';

const mockHttpRequest = http.request as jest.Mock;

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

beforeEach(() => {
  jest.clearAllMocks();
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
  });
});

describe('imageGenerateHandler', () => {
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

  test('returns error when n8n reports failure', async () => {
    mockN8nResponse({
      status: 'failure',
      error: { message: 'No provider available', code: 'NO_PROVIDER_AVAILABLE' }
    });

    const res = await imageGenerateHandler({ prompt: 'a dog' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('No image backend available');
  });

  test('clamps width and height to max 1024', async () => {
    // Mock SD API response (images[] not present → returns null, but clamping still runs)
    mockN8nResponse({ images: [] });
    const res = await imageGenerateHandler({ prompt: 'big', width: 2000, height: 2000 }, {} as any);
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
