jest.mock('../env', () => ({ isE2E: false }));
jest.mock('../n8n-lifecycle', () => ({ ensureN8nRunning: jest.fn() }));
jest.mock('../../../../src/supervisor/supervisor', () => ({
  Supervisor: jest.fn().mockImplementation(() => ({
    onEvent: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    getStatus: jest.fn(),
  })),
}));

import { ensureN8nRunning } from '../n8n-lifecycle';
import { startSupervisorService } from '../supervisor-service';

test('supervisor recovery passes its configured n8n URL to the lifecycle', async () => {
  const supervisor = require('../../../../src/supervisor/supervisor').Supervisor as jest.Mock;
  const ensure = ensureN8nRunning as jest.Mock;
  ensure.mockResolvedValue('already_running');

  const handle = startSupervisorService({
    ollamaUrl: 'http://127.0.0.1:11434',
    n8nUrl: 'http://127.0.0.1:5680',
    getWindow: () => null,
  });
  const services = supervisor.mock.calls[0][0];
  const n8n = services.find((service: { name: string }) => service.name === 'n8n');
  await n8n.recover();

  expect(ensure).toHaveBeenCalledWith('http://127.0.0.1:5680');
  handle.stop();
});
