/**
 * Soak runner (Phase 0 — reliability)
 *
 * Runs the Supervisor against a set of services for a duration (24 h on
 * Aden's machine; milliseconds under a fake clock in tests), sampling
 * per-service health and process memory on an interval, and produces a
 * SoakReport with a pass/fail verdict.
 *
 * Verdict rules:
 *  - every `required` service must end healthy AND keep >= minUptimePct uptime
 *  - every `required` service must have at least one successful probe (a run
 *    shorter than the probe interval cannot pass — no observation, no verdict)
 *  - RSS growth over the run must stay <= maxRssGrowthPct (only enforced on
 *    runs >= 10 minutes; short runs are too noisy to judge)
 *  - the supervisor must shut down clean (zero pending timers after stop)
 */

import { Supervisor, realClock } from './supervisor';
import { Clock, ServiceHealth, SoakOptions, SoakReport, SoakSample } from './types';

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function runSoak(options: SoakOptions): Promise<SoakReport> {
  const clock: Clock = options.clock ?? realClock;
  const sampleIntervalMs = options.sampleIntervalMs ?? 60_000;
  const minUptimePct = options.minUptimePct ?? 95;
  const maxRssGrowthPct = options.maxRssGrowthPct ?? 35;

  const supervisor = new Supervisor(options.services, clock, options.rng ?? Math.random);
  const samples: SoakSample[] = [];
  const transitions: Record<string, number> = {};
  for (const s of options.services) transitions[s.name] = 0;

  const offEvent = supervisor.onEvent((e) => {
    if (e.type === 'state-change') transitions[e.service] = (transitions[e.service] ?? 0) + 1;
  });

  const startedAt = clock.now();
  supervisor.start();

  const takeSample = (): void => {
    const mem = process.memoryUsage();
    const states: Record<string, ServiceHealth> = {};
    for (const s of supervisor.getStatus().services) states[s.name] = s.health;
    const sample: SoakSample = {
      at: clock.now(),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      states,
    };
    samples.push(sample);
    if (options.onSample) {
      try {
        options.onSample(sample);
      } catch {
        /* sample listeners must never break the soak */
      }
    }
  };

  return new Promise<SoakReport>((resolve) => {
    let sampleTimer: unknown = null;
    const scheduleSample = (): void => {
      sampleTimer = clock.setTimeout(() => {
        takeSample();
        scheduleSample();
      }, sampleIntervalMs);
    };
    takeSample(); // baseline at t=0
    scheduleSample();

    clock.setTimeout(() => {
      if (sampleTimer !== null) clock.clearTimeout(sampleTimer);
      takeSample(); // final sample
      supervisor.stop();
      offEvent();

      const endedAt = clock.now();
      const durationMs = endedAt - startedAt;
      const verdictReasons: string[] = [];

      // Per-service report
      const finalStatus = supervisor.getStatus();
      const services: SoakReport['services'] = {};
      for (const st of finalStatus.services) {
        const healthySamples = samples.filter((s) => s.states[st.name] === 'healthy').length;
        const uptimePct = samples.length > 0 ? (healthySamples / samples.length) * 100 : 0;
        services[st.name] = {
          uptimePct: Math.round(uptimePct * 100) / 100,
          transitions: transitions[st.name] ?? 0,
          recoveries: st.totalRecoveries,
          failures: st.totalFailures,
          finalState: st.health,
          required: st.required,
        };
        if (st.required) {
          if (st.health !== 'healthy') {
            verdictReasons.push(`${st.name} ended ${st.health} (required service)`);
          }
          if (uptimePct < minUptimePct) {
            verdictReasons.push(
              `${st.name} uptime ${uptimePct.toFixed(1)}% < required ${minUptimePct}%`
            );
          }
          // Services start optimistically 'healthy' and the first probe fires
          // one interval in — so a run shorter than the probe interval would
          // otherwise "pass" without a single real observation. A required
          // service must be seen alive at least once for the soak to mean
          // anything.
          if (st.lastOkAt === null) {
            verdictReasons.push(
              `${st.name} was never successfully probed (run shorter than the probe interval?)`
            );
          }
        }
      }

      // Memory
      const firstRssBytes = samples[0]?.rssBytes ?? 0;
      const lastRssBytes = samples[samples.length - 1]?.rssBytes ?? 0;
      const peakRssBytes = samples.reduce((m, s) => Math.max(m, s.rssBytes), 0);
      const growthPct =
        firstRssBytes > 0 ? ((lastRssBytes - firstRssBytes) / firstRssBytes) * 100 : 0;
      if (durationMs >= TEN_MINUTES_MS && growthPct > maxRssGrowthPct) {
        verdictReasons.push(
          `RSS grew ${growthPct.toFixed(1)}% over the run (limit ${maxRssGrowthPct}%)`
        );
      }

      // Clean shutdown
      if (supervisor.pendingTimerCount() !== 0) {
        verdictReasons.push(`supervisor left ${supervisor.pendingTimerCount()} timer(s) pending after stop`);
      }

      resolve({
        startedAt,
        endedAt,
        durationMs,
        samples: samples.length,
        services,
        memory: {
          firstRssBytes,
          lastRssBytes,
          peakRssBytes,
          growthPct: Math.round(growthPct * 100) / 100,
        },
        eventCount: supervisor.getEvents().length,
        verdict: verdictReasons.length === 0 ? 'pass' : 'fail',
        verdictReasons,
      });
    }, options.durationMs);
  });
}
