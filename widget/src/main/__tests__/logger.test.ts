import os from 'os';
import { join } from 'path';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'fs';
import { logTelemetryEvent } from '../../main/utils/logger';

describe('logger telemetry events', () => {
  const tmp = join(os.tmpdir(), 'sadie-telemetry-test-' + Date.now());
  beforeAll(() => {
    process.env.TEST_USERDATA = tmp;
    if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
  });
  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  });

  test('logTelemetryEvent writes telemetry-events.log', () => {
    logTelemetryEvent('stream_failure', { streamId: 's1', reason: 'probe' });
    const p = join(tmp, 'logs', 'telemetry-events.log');
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf-8').trim();
    expect(content.length).toBeGreaterThan(0);
    const lines = content.split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.event).toBe('stream_failure');
    expect(last.details.streamId).toBe('s1');
  });
});