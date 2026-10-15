jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('http', () => ({ get: jest.fn() }));

import { execFile } from 'child_process';
import * as http from 'http';
import { ensureN8nRunning } from '../n8n-lifecycle';

const mockExecFile = execFile as unknown as jest.Mock;
const mockGet = http.get as unknown as jest.Mock;
const originalE2E = process.env.HOMEBOT_E2E;

function respondWith(...statuses: number[]) {
  mockGet.mockImplementation((_url: string, _options: object, callback: (response: any) => void) => {
    callback({ statusCode: statuses.shift(), resume: jest.fn() });
    return { on: jest.fn().mockReturnThis(), destroy: jest.fn() };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.HOMEBOT_E2E;
});

afterAll(() => {
  if (originalE2E === undefined) delete process.env.HOMEBOT_E2E;
  else process.env.HOMEBOT_E2E = originalE2E;
});

test('startup and post-start polling both probe the configured URL', async () => {
  respondWith(503, 200);
  mockExecFile.mockImplementation((_command: string, _args: string[], _options: object, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, '', '');
  });

  const status = await ensureN8nRunning('http://127.0.0.1:5680');

  expect(status).toBe('started');
  expect(mockGet.mock.calls.map(([url]) => url)).toEqual([
    'http://127.0.0.1:5680',
    'http://127.0.0.1:5680',
  ]);
  expect(mockExecFile).toHaveBeenCalledWith('docker', ['start', 'homebot-n8n'], expect.any(Object), expect.any(Function));
});

test('without a configured URL, health falls back to localhost:5678', async () => {
  respondWith(200);

  expect(await ensureN8nRunning()).toBe('already_running');
  expect(mockGet.mock.calls.map(([url]) => url)).toEqual(['http://localhost:5678']);
  expect(mockExecFile).not.toHaveBeenCalled();
});
