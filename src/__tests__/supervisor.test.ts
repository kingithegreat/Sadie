import { Supervisor } from '../supervisor/supervisor';
import { ServiceSpec, SupervisorEvent } from '../supervisor/types';
import { TestClock } from './helpers/test-clock';

const fixedRng = () => 0.5; // jitter factor exactly 1.0 → deterministic backoff

function eventsOf(sup: Supervisor, type: SupervisorEvent['type']): SupervisorEvent[] {
  return sup.getEvents().filter((e) => e.type === type);
}

describe('Supervisor', () => {
  test('healthy service stays healthy and emits no events', async () => {
    const clock = new TestClock();
    const sup = new Supervisor(
      [{ name: 'ok', probe: async () => true, probeIntervalMs: 1000 }],
      clock,
      fixedRng
    );
    sup.start();
    await clock.advance(10_000);

    const st = sup.getStatus().services[0];
    expect(st.health).toBe('healthy');
    expect(st.totalFailures).toBe(0);
    expect(st.lastOkAt).not.toBeNull();
    expect(sup.getEvents()).toHaveLength(0);
    sup.stop();
  });

  test('threshold failures trigger recovery; recovered service returns to healthy and resets counters', async () => {
    const clock = new TestClock();
    let fixed = true;
    const spec: ServiceSpec = {
      name: 'svc',
      probe: async () => fixed,
      recover: async () => {
        fixed = true;
      },
      probeIntervalMs: 1000,
      failureThreshold: 3,
      recoveryBackoffMs: 500,
    };
    const sup = new Supervisor([spec], clock, fixedRng);
    sup.start();

    await clock.advance(2_500); // two healthy probes
    fixed = false; // outage begins
    await clock.advance(2_600); // probes at 3s,4s,5s fail → threshold at the 3rd; stop before the 5.5s backoff re-probe

    expect(sup.getStatus().services[0].health).toBe('recovering');
    expect(eventsOf(sup, 'recovery-attempt')).toHaveLength(1);
    // recover() already flipped `fixed`; after the 500ms backoff the re-probe succeeds
    await clock.advance(600);

    const st = sup.getStatus().services[0];
    expect(st.health).toBe('healthy');
    expect(st.consecutiveFailures).toBe(0);
    expect(st.totalRecoveries).toBe(1);
    expect(st.totalFailures).toBe(3);

    const transitions = eventsOf(sup, 'state-change').map((e) => `${e.from}->${e.to}`);
    expect(transitions).toEqual(['healthy->degraded', 'degraded->recovering', 'recovering->healthy']);
    sup.stop();
  });

  test('service without recover() goes down at threshold, re-probes slowly, and self-heals when the service returns', async () => {
    const clock = new TestClock();
    let up = false;
    const sup = new Supervisor(
      [
        {
          name: 'reportOnly',
          probe: async () => up,
          probeIntervalMs: 1000,
          failureThreshold: 2,
          downRetryIntervalMs: 5000,
        },
      ],
      clock,
      fixedRng
    );
    sup.start();
    await clock.advance(2_100); // two failing probes → down
    expect(sup.getStatus().services[0].health).toBe('down');
    const failsWhenDown = eventsOf(sup, 'probe-fail').length;

    // Down cadence is 5s, not 1s: within the next 4.9s no additional probe fires.
    await clock.advance(4_900);
    expect(eventsOf(sup, 'probe-fail').length).toBe(failsWhenDown + 1); // exactly one slow re-probe (at +5s)

    up = true; // manual fix outside the supervisor
    await clock.advance(5_100); // next slow re-probe detects it
    expect(sup.getStatus().services[0].health).toBe('healthy');
    sup.stop();
  });

  test('circuit breaker opens after max recoveries in the window, then the service can still come back', async () => {
    const clock = new TestClock();
    let up = false;
    let recoverCalls = 0;
    const sup = new Supervisor(
      [
        {
          name: 'looping',
          probe: async () => up,
          recover: async () => {
            recoverCalls += 1; // never actually fixes it
          },
          probeIntervalMs: 1000,
          failureThreshold: 2,
          recoveryBackoffMs: 100,
          recoveryBackoffCapMs: 400,
          maxRecoveries: 3,
          recoveryWindowMs: 60 * 60 * 1000,
          downRetryIntervalMs: 5000,
        },
      ],
      clock,
      fixedRng
    );
    sup.start();
    await clock.advance(30_000);

    expect(recoverCalls).toBe(3);
    expect(eventsOf(sup, 'recovery-attempt')).toHaveLength(3);
    expect(eventsOf(sup, 'breaker-open')).toHaveLength(1);
    expect(sup.getStatus().services[0].health).toBe('down');

    up = true;
    await clock.advance(5_100);
    expect(sup.getStatus().services[0].health).toBe('healthy');
    sup.stop();
  });

  test('hung probe counts as failure via the timeout race', async () => {
    const clock = new TestClock();
    const sup = new Supervisor(
      [
        {
          name: 'hung',
          probe: () => new Promise<boolean>(() => undefined), // never settles
          probeIntervalMs: 1000,
          probeTimeoutMs: 100,
          failureThreshold: 2,
        },
      ],
      clock,
      fixedRng
    );
    sup.start();
    await clock.advance(3_000);
    expect(sup.getStatus().services[0].health).toBe('down');
    expect(eventsOf(sup, 'probe-fail').length).toBeGreaterThanOrEqual(2);
    sup.stop();
  });

  test('hung recover() is timed out and logged, and recovery keeps retrying', async () => {
    const clock = new TestClock();
    const sup = new Supervisor(
      [
        {
          name: 'stuckRecover',
          probe: async () => false,
          recover: () => new Promise<void>(() => undefined), // hangs
          probeIntervalMs: 1000,
          failureThreshold: 1,
          recoveryBackoffMs: 200,
          recoveryTimeoutMs: 50,
          maxRecoveries: 10,
        },
      ],
      clock,
      fixedRng
    );
    sup.start();
    await clock.advance(5_000);
    expect(eventsOf(sup, 'recovery-error').length).toBeGreaterThanOrEqual(2);
    expect(eventsOf(sup, 'recovery-error')[0].detail).toContain('timed out');
    expect(eventsOf(sup, 'recovery-attempt').length).toBeGreaterThanOrEqual(2);
    sup.stop();
  });

  test('probes rejecting count as failures', async () => {
    const clock = new TestClock();
    const sup = new Supervisor(
      [
        {
          name: 'throws',
          probe: async () => {
            throw new Error('boom');
          },
          probeIntervalMs: 1000,
          failureThreshold: 2,
        },
      ],
      clock,
      fixedRng
    );
    sup.start();
    await clock.advance(2_100);
    expect(sup.getStatus().services[0].health).toBe('down');
    sup.stop();
  });

  test('stop() clears every timer and halts all activity', async () => {
    const clock = new TestClock();
    const sup = new Supervisor(
      [
        { name: 'a', probe: async () => true, probeIntervalMs: 1000 },
        { name: 'b', probe: async () => false, probeIntervalMs: 1000, failureThreshold: 5 },
      ],
      clock,
      fixedRng
    );
    sup.start();
    await clock.advance(2_500);
    sup.stop();

    expect(sup.pendingTimerCount()).toBe(0);
    expect(clock.pending()).toBe(0);
    const eventsAtStop = sup.getEvents().length;
    await clock.advance(60_000);
    expect(sup.getEvents().length).toBe(eventsAtStop);
  });

  test('event log is capped', async () => {
    const clock = new TestClock();
    const sup = new Supervisor(
      [
        {
          name: 'noisy',
          probe: async () => false,
          probeIntervalMs: 1,
          failureThreshold: 999_999, // stay degraded forever → probe-fail every tick
        },
      ],
      clock,
      fixedRng
    );
    sup.start();
    await clock.advance(700);
    expect(sup.getEvents().length).toBeLessThanOrEqual(500);
    sup.stop();
  });

  test('duplicate service names are rejected', () => {
    expect(
      () =>
        new Supervisor([
          { name: 'x', probe: async () => true },
          { name: 'x', probe: async () => true },
        ])
    ).toThrow(/duplicate/);
  });

  test('listeners that throw never break the supervisor', async () => {
    const clock = new TestClock();
    const sup = new Supervisor(
      [{ name: 'svc', probe: async () => false, probeIntervalMs: 1000, failureThreshold: 1 }],
      clock,
      fixedRng
    );
    sup.onEvent(() => {
      throw new Error('bad listener');
    });
    sup.start();
    await clock.advance(3_000);
    expect(sup.getEvents().length).toBeGreaterThan(0); // still running
    sup.stop();
  });
});
