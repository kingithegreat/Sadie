/**
 * Supervisor (Phase 0 — reliability)
 *
 * Continuous health supervision for HomeBot's external services. Per service:
 *
 *   healthy ──fail──▶ degraded ──threshold──▶ recovering ──▶ healthy
 *                                    │  (no recover() / breaker open)
 *                                    ▼
 *                                  down ──slow re-probe ok──▶ healthy
 *
 * - Probes run on an interval with a timeout race; rejections count as fails.
 * - Recovery attempts back off exponentially (with jitter) up to a cap.
 * - A rolling-window circuit breaker stops restart loops: past the limit the
 *   service is marked 'down' and only re-probed at a slow cadence, so a
 *   manually-fixed service is still re-detected.
 * - Every transition is appended to a capped in-process event log and pushed
 *   to listeners (the Electron adapter forwards these to logs/renderer).
 * - Fully clock-injectable: tests simulate hours in milliseconds.
 */

import {
  Clock,
  ServiceHealth,
  ServiceSpec,
  ServiceStatus,
  SupervisorEvent,
  SupervisorStatus,
} from './types';

const EVENT_LOG_CAP = 500;

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

interface ServiceRuntime {
  spec: Required<Pick<ServiceSpec, 'name' | 'probe'>> & ServiceSpec;
  health: ServiceHealth;
  consecutiveFailures: number;
  totalFailures: number;
  totalRecoveries: number;
  recoveryTimestamps: number[];
  currentBackoffMs: number;
  lastProbeAt: number | null;
  lastOkAt: number | null;
  timer: unknown | null;
}

export class Supervisor {
  private readonly clock: Clock;
  private readonly rng: () => number;
  private readonly services = new Map<string, ServiceRuntime>();
  private readonly events: SupervisorEvent[] = [];
  private readonly listeners: Array<(e: SupervisorEvent) => void> = [];
  private startedAt = 0;
  private stopped = true;

  constructor(specs: ServiceSpec[], clock: Clock = realClock, rng: () => number = Math.random) {
    this.clock = clock;
    this.rng = rng;
    for (const spec of specs) {
      if (this.services.has(spec.name)) {
        throw new Error(`Supervisor: duplicate service name "${spec.name}"`);
      }
      this.services.set(spec.name, {
        spec,
        health: 'healthy',
        consecutiveFailures: 0,
        totalFailures: 0,
        totalRecoveries: 0,
        recoveryTimestamps: [],
        currentBackoffMs: spec.recoveryBackoffMs ?? 5_000,
        lastProbeAt: null,
        lastOkAt: null,
        timer: null,
      });
    }
  }

  /** Register a listener for supervisor events. Returns an unsubscribe fn. */
  onEvent(fn: (e: SupervisorEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Begin probing all services. First probe fires after one probe interval. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.startedAt = this.clock.now();
    for (const rt of this.services.values()) {
      this.scheduleProbe(rt, this.intervalFor(rt));
    }
  }

  /** Stop all timers. In-flight async work becomes a no-op. */
  stop(): void {
    this.stopped = true;
    for (const rt of this.services.values()) {
      if (rt.timer !== null) {
        this.clock.clearTimeout(rt.timer);
        rt.timer = null;
      }
    }
  }

  getStatus(): SupervisorStatus {
    const services: ServiceStatus[] = [];
    for (const rt of this.services.values()) {
      services.push({
        name: rt.spec.name,
        health: rt.health,
        required: rt.spec.required === true,
        consecutiveFailures: rt.consecutiveFailures,
        totalFailures: rt.totalFailures,
        totalRecoveries: rt.totalRecoveries,
        recoveriesInWindow: this.recoveriesInWindow(rt).length,
        lastProbeAt: rt.lastProbeAt,
        lastOkAt: rt.lastOkAt,
      });
    }
    return { startedAt: this.startedAt, stopped: this.stopped, services };
  }

  getEvents(): ReadonlyArray<SupervisorEvent> {
    return this.events;
  }

  /** Count of pending timers — used by tests/soak to prove clean shutdown. */
  pendingTimerCount(): number {
    let n = 0;
    for (const rt of this.services.values()) if (rt.timer !== null) n++;
    return n;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private intervalFor(rt: ServiceRuntime): number {
    if (rt.health === 'down') return rt.spec.downRetryIntervalMs ?? 120_000;
    return rt.spec.probeIntervalMs ?? 30_000;
  }

  private scheduleProbe(rt: ServiceRuntime, delayMs: number): void {
    if (this.stopped) return;
    rt.timer = this.clock.setTimeout(() => {
      rt.timer = null;
      void this.runProbe(rt);
    }, delayMs);
  }

  private async runProbe(rt: ServiceRuntime): Promise<void> {
    if (this.stopped) return;
    rt.lastProbeAt = this.clock.now();
    const ok = await this.probeWithTimeout(rt);
    if (this.stopped) return;

    if (ok) {
      rt.lastOkAt = this.clock.now();
      rt.consecutiveFailures = 0;
      rt.currentBackoffMs = rt.spec.recoveryBackoffMs ?? 5_000;
      if (rt.health !== 'healthy') this.transition(rt, 'healthy', 'probe succeeded');
      this.scheduleProbe(rt, this.intervalFor(rt));
      return;
    }

    rt.consecutiveFailures += 1;
    rt.totalFailures += 1;
    this.emit({
      at: this.clock.now(),
      service: rt.spec.name,
      type: 'probe-fail',
      detail: `consecutive=${rt.consecutiveFailures}`,
    });

    const threshold = rt.spec.failureThreshold ?? 3;
    if (rt.health === 'down') {
      // Already down: keep re-probing slowly.
      this.scheduleProbe(rt, this.intervalFor(rt));
      return;
    }

    if (rt.consecutiveFailures < threshold) {
      if (rt.health === 'healthy') this.transition(rt, 'degraded', 'probe failing');
      this.scheduleProbe(rt, this.intervalFor(rt));
      return;
    }

    // Threshold reached.
    if (!rt.spec.recover) {
      this.transition(rt, 'down', 'threshold reached, no recovery action');
      this.scheduleProbe(rt, this.intervalFor(rt));
      return;
    }
    if (this.breakerOpen(rt)) {
      this.emit({
        at: this.clock.now(),
        service: rt.spec.name,
        type: 'breaker-open',
        detail: `>${rt.spec.maxRecoveries ?? 5} recoveries in window`,
      });
      this.transition(rt, 'down', 'circuit breaker open');
      this.scheduleProbe(rt, this.intervalFor(rt));
      return;
    }
    if (rt.health !== 'recovering') this.transition(rt, 'recovering', 'threshold reached');
    void this.attemptRecovery(rt);
  }

  private async attemptRecovery(rt: ServiceRuntime): Promise<void> {
    if (this.stopped) return;
    rt.recoveryTimestamps.push(this.clock.now());
    rt.totalRecoveries += 1;
    this.emit({
      at: this.clock.now(),
      service: rt.spec.name,
      type: 'recovery-attempt',
      detail: `attempt=${rt.totalRecoveries} backoffMs=${rt.currentBackoffMs}`,
    });
    try {
      await this.withTimeout(rt.spec.recover!(), rt.spec.recoveryTimeoutMs ?? 60_000);
    } catch (e) {
      this.emit({
        at: this.clock.now(),
        service: rt.spec.name,
        type: 'recovery-error',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    if (this.stopped) return;
    // Wait one backoff, then re-probe. Success resets everything; failure
    // arrives back here with a doubled backoff (until the breaker opens).
    const jitter = 0.8 + this.rng() * 0.4; // ±20%
    const delay = Math.round(rt.currentBackoffMs * jitter);
    const cap = rt.spec.recoveryBackoffCapMs ?? 300_000;
    rt.currentBackoffMs = Math.min(rt.currentBackoffMs * 2, cap);
    this.scheduleProbe(rt, delay);
  }

  private breakerOpen(rt: ServiceRuntime): boolean {
    return this.recoveriesInWindow(rt).length >= (rt.spec.maxRecoveries ?? 5);
  }

  private recoveriesInWindow(rt: ServiceRuntime): number[] {
    const windowMs = rt.spec.recoveryWindowMs ?? 1_800_000;
    const cutoff = this.clock.now() - windowMs;
    rt.recoveryTimestamps = rt.recoveryTimestamps.filter((t) => t >= cutoff);
    return rt.recoveryTimestamps;
  }

  private probeWithTimeout(rt: ServiceRuntime): Promise<boolean> {
    const timeoutMs = rt.spec.probeTimeoutMs ?? 3_000;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = this.clock.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      rt.spec.probe().then(
        (ok) => {
          if (settled) return;
          settled = true;
          this.clock.clearTimeout(timer);
          resolve(ok === true);
        },
        () => {
          if (settled) return;
          settled = true;
          this.clock.clearTimeout(timer);
          resolve(false);
        }
      );
    });
  }

  private withTimeout(p: Promise<void>, ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = this.clock.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`recovery timed out after ${ms}ms`));
      }, ms);
      p.then(
        () => {
          if (settled) return;
          settled = true;
          this.clock.clearTimeout(timer);
          resolve();
        },
        (e) => {
          if (settled) return;
          settled = true;
          this.clock.clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  private transition(rt: ServiceRuntime, to: ServiceHealth, detail: string): void {
    const from = rt.health;
    if (from === to) return;
    rt.health = to;
    this.emit({ at: this.clock.now(), service: rt.spec.name, type: 'state-change', from, to, detail });
  }

  private emit(e: SupervisorEvent): void {
    this.events.push(e);
    if (this.events.length > EVENT_LOG_CAP) this.events.splice(0, this.events.length - EVENT_LOG_CAP);
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        /* listeners must never break the supervisor */
      }
    }
  }
}
