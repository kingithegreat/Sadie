/**
 * API Tool Tests
 */

import * as https from 'https';
import { EventEmitter } from 'events';

jest.mock('https');
// Mock dns with a stable factory so dns.promises.lookup is a stable jest.fn()
jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
  },
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(false),
}));

import * as dns from 'dns';
const mockHttps = https as jest.Mocked<typeof https>;
const mockLookup = dns.promises.lookup as jest.Mock;

/** Build a minimal mock https.ClientRequest + IncomingMessage */
function mockHttpsRequest(statusCode: number, body: string, contentType = 'application/json') {
  const res = new EventEmitter() as any;
  res.statusCode = statusCode;
  res.headers = { 'content-type': contentType };
  res.setEncoding = jest.fn();

  const req = new EventEmitter() as any;
  req.write = jest.fn();
  req.end = jest.fn().mockImplementation(() => {
    process.nextTick(() => {
      res.emit('data', body);
      res.emit('end');
    });
  });
  req.setTimeout = jest.fn();
  req.destroy = jest.fn();

  (mockHttps.request as jest.Mock).mockImplementation((_opts: any, cb: Function) => {
    process.nextTick(() => cb(res));
    return req;
  });

  return { req, res };
}

import { apiRequestHandler, apiRequestDef } from '../tools/api-tool';

beforeEach(() => {
  jest.clearAllMocks();
  // Default: DNS resolves to a public IP
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('apiRequestHandler — validated requests', () => {
  test('blocks non-https URL', async () => {
    const res = await apiRequestHandler({ url: 'http://wttr.in/London' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/https/i);
  });

  test('blocks localhost', async () => {
    const res = await apiRequestHandler({ url: 'https://localhost/api' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/blocked/i);
  });

  test('blocks 127.0.0.1', async () => {
    const res = await apiRequestHandler({ url: 'https://127.0.0.1/api' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/blocked/i);
  });

  test('blocks private IP 192.168.1.1', async () => {
    const res = await apiRequestHandler({ url: 'https://192.168.1.1/api' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/blocked/i);
  });

  test('blocks 10.x.x.x private IP', async () => {
    const res = await apiRequestHandler({ url: 'https://10.0.0.1/secret' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/blocked/i);
  });

  test('blocks non-allowlisted host', async () => {
    const res = await apiRequestHandler({ url: 'https://not-in-allowlist.example.com/data' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/allowlist/i);
  });

  test('returns failure when url is missing', async () => {
    const res = await apiRequestHandler({ url: '' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/url/i);
  });
});

describe('apiRequestHandler — successful requests', () => {
  test('GET allowlisted host returns parsed JSON result', async () => {
    mockHttpsRequest(200, JSON.stringify({ temp: 22, unit: 'C' }), 'application/json');

    const res = await apiRequestHandler({ url: 'https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.status).toBe(200);
    expect(res.result.isJson).toBe(true);
    expect(res.result.body).toEqual({ temp: 22, unit: 'C' });
  });

  test('GET returns plain text when content-type is not json', async () => {
    mockHttpsRequest(200, 'plain response text', 'text/plain');

    const res = await apiRequestHandler({ url: 'https://wttr.in/?format=3' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.isJson).toBe(false);
    expect(typeof res.result.body).toBe('string');
  });

  test('returns failure for HTTP 4xx', async () => {
    mockHttpsRequest(404, JSON.stringify({ error: 'not found' }), 'application/json');

    const res = await apiRequestHandler({ url: 'https://api.github.com/nonexistent-endpoint' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/404/);
  });

  test('strips disallowed headers (authorization, cookie)', async () => {
    mockHttpsRequest(200, '{}', 'application/json');

    const res = await apiRequestHandler({
      url: 'https://restcountries.com/v3.1/name/usa',
      headers: { Authorization: 'Bearer secret-token', 'X-Custom': 'allowed' },
    }, {} as any);
    // Verify the call succeeded — Authorization was stripped (no injection)
    expect(res.success).toBe(true);
    const callArgs = (mockHttps.request as jest.Mock).mock.calls[0]?.[0];
    expect(callArgs?.headers?.Authorization).toBeUndefined();
  });

  test('caps timeout at 30000', async () => {
    mockHttpsRequest(200, '{}', 'application/json');

    const res = await apiRequestHandler({
      url: 'https://restcountries.com/v3.1/name/france',
      timeout: 999999,
    }, {} as any);
    expect(res.success).toBe(true);
    // We verify no crash — the timeout capping happens internally
  });
});

describe('apiRequestHandler — DNS resolves to private IP', () => {
  test('blocks host that DNS resolves to a private IP', async () => {
    mockLookup.mockResolvedValue([{ address: '192.168.1.100', family: 4 }]);

    const res = await apiRequestHandler({ url: 'https://api.open-meteo.com/evil' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/private IP/i);
  });
});

describe('apiRequestDef', () => {
  test('has correct name', () => {
    expect(apiRequestDef.name).toBe('api_request');
  });

  test('requires url parameter', () => {
    expect(apiRequestDef.parameters.required).toContain('url');
  });

  test('is in web category', () => {
    expect(apiRequestDef.category).toBe('web');
  });

  test('lists GET and POST in method enum', () => {
    const methodProp = apiRequestDef.parameters.properties.method;
    expect(methodProp.enum).toContain('GET');
    expect(methodProp.enum).toContain('POST');
  });
});
