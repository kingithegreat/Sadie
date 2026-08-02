import { runSoak } from '../supervisor/soak';
import { TestClock } from './helpers/test-clock';

const fixedRng = () => 0.5;

describe('runSoak', () => {
  test('run shorter than the probe interval fails: required services were never observed', async () => {
    const clock = new TestClock();
    // Probe would fail if it ever ran — but the run ends before the first
    // probe fires. Without the never-probed guard this "passes" on the
    // optimistic initial 'healthy' state, which is exactly the placebo
    // verdict this test pins against.
    const reportPromise = runSoak({
      clock,
      rng: fixedRng,
      durationMs: 3_000,
      sampleIntervalMs: 1_000,
      services: [
        { name: 'absent', required: true, probe: async () => false, probeIntervalMs: 30_000 },
        { name: 'optional-absent', required: false, probe: async () => false, probeIntervalMs: 30_000 },
      ],
    });
    await clock.advance(4_000);
    const report = await reportPromise;

    expect(report.verdict).toBe('fail');
    expect(report.verdictReasons.join(' ')).toContain('absent was never successfully probed');
    // The guard applies to required services only.
    expect(report.verdictReasons.join(' ')).not.toContain('optional-absent was never');
  });

  test('flaky required service that recovers → pass, with recovery and uptime accounted', async () => {
    const clock = new TestClock();
    let fixedByRecover = false;
    const reportPromise = runSoak({
      clock,
      rng: fixedRng,
      durationMs: 60_000,
      sampleIntervalMs: 5_000,
      minUptimePct: 80,
      services: [
        {
          name: 'flaky',
          required: true,
          // Healthy for the first 10s, then broken until recover() runs.
          probe: async () => (clock.now() < 10_000 ? true : fixedByRecover),
          recover: async () => {
            fixedByRecover = true;
          },
          probeIntervalMs: 1_000,
          failureThreshold: 2,
          recoveryBackoffMs: 500,
        },
        {
          name: 'steady',
          required: true,
          probe: async () => true,
          probeIntervalMs: 1_000,
        },
      ],
    });
    await clock.advance(61_000);
    const report = await reportPromise;

    expect(report.verdict).toBe('pass');
    expect(report.verdictReasons).toEqual([]);
    expect(report.durationMs).toBe(60_000);
    expect(report.samples).toBeGreaterThanOrEqual(13); // baseline + 12 interval + final

    const flaky = report.services.flaky;
    expect(flaky.finalState).toBe('healthy');
    expect(flaky.recoveries).toBe(1);
    expect(flaky.failures).toBeGreaterThanOrEqual(2);
    expect(flaky.transitions).toBeGreaterThanOrEqual(3); // →degraded→recovering→healthy
    expect(flaky.uptimePct).toBeGreaterThanOrEqual(80);

    expect(report.services.steady.uptimePct).toBe(100);
    expect(report.services.steady.failures).toBe(0);

    expect(report.memory.firstRssBytes).toBeGreaterThan(0);
    expect(report.memory.peakRssBytes).toBeGreaterThanOrEqual(report.memory.firstRssBytes);
    expect(typeof report.memory.growthPct).toBe('number');
  });

  test('required service down all run → fail with named reasons', async () => {
    const clock = new TestClock();
    const reportPromise = runSoak({
      clock,
      rng: fixedRng,
      durationMs: 30_000,
      sampleIntervalMs: 5_000,
      services: [
        {
          name: 'dead',
          required: true,
          probe: async () => false,
          probeIntervalMs: 1_000,
          failureThreshold: 2,
        },
      ],
    });
    await clock.advance(31_000);
    const report = await reportPromise;

    expect(report.verdict).toBe('fail');
    expect(report.services.dead.finalState).toBe('down');
    expect(report.verdictReasons.join(' ')).toContain('dead ended down');
    expect(report.verdictReasons.join(' ')).toContain('uptime');
  });

  test('optional (report-only) service down does not fail the soak', async () => {
    const clock = new TestClock();
    const reportPromise = runSoak({
      clock,
      rng: fixedRng,
      durationMs: 30_000,
      sampleIntervalMs: 5_000,
      services: [
        { name: 'core', required: true, probe: async () => true, probeIntervalMs: 1_000 },
        {
          name: 'extra',
          required: false,
          probe: async () => false,
          probeIntervalMs: 1_000,
          failureThreshold: 2,
        },
      ],
    });
    await clock.advance(31_000);
    const report = await reportPromise;

    expect(report.verdict).toBe('pass');
    expect(report.services.extra.finalState).toBe('down');
    expect(report.services.core.uptimePct).toBe(100);
  });

  test('onSample fires and a throwing sample listener never breaks the soak', async () => {
    const clock = new TestClock();
    let sampleCount = 0;
    const reportPromise = runSoak({
      clock,
      rng: fixedRng,
      durationMs: 20_000,
      sampleIntervalMs: 5_000,
      services: [{ name: 'svc', required: true, probe: async () => true, probeIntervalMs: 1_000 }],
      onSample: () => {
        sampleCount += 1;
        throw new Error('listener boom');
      },
    });
    await clock.advance(21_000);
    const report = await reportPromise;
    expect(report.verdict).toBe('pass');
    expect(sampleCount).toBe(report.samples);
  });

  test('supervisor shuts down clean after the soak (no timers left)', async () => {
    const clock = new TestClock();
    const reportPromise = runSoak({
      clock,
      rng: fixedRng,
      durationMs: 15_000,
      sampleIntervalMs: 5_000,
      services: [
        { name: 'a', required: true, probe: async () => true, probeIntervalMs: 1_000 },
        { name: 'b', required: false, probe: async () => false, probeIntervalMs: 1_000, failureThreshold: 2 },
      ],
    });
    await clock.advance(16_000);
    const report = await reportPromise;
    expect(report.verdict).toBe('pass');
    expect(clock.pending()).toBe(0); // every probe/sample/backoff timer cleaned up
  });
});
