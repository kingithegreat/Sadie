/**
 * Supervisor types (Phase 0 — reliability)
 *
 * The supervisor continuously watches SADIE's external services (Ollama, n8n,
 * Qdrant) *after* startup — the gap the one-shot diagnostics and the startup
 * n8n-lifecycle check leave open. It probes on an interval, escalates through
 * a small state machine, optionally runs a recovery action with exponential
 * backoff, and trips a circuit breaker instead of restart-looping forever.
 *
 * Everything here is dependency-free and clock-injectable so the whole state
 * machine is unit-testable in milliseconds and soak-testable for 24 hours.
 */

/** Health of one supervised service. */
export type ServiceHealth = 'healthy' | 'degraded' | 'recovering' | 'down';

/**
 * Injectable time source. Production uses the real clock; tests drive a fake
 * one so backoff/interval logic runs deterministically and instantly.
 */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Declarative spec for one service the supervisor watches. */
export interface ServiceSpec {
  /** Unique name, e.g. "ollama". */
  name: string;
  /** Health probe. Resolve true = healthy. Rejections count as failures. */
  probe: () => Promise<boolean>;
  /**
   * Optional recovery action (e.g. `docker start homebot-n8n`). When absent,
   * a service past its failure threshold goes straight to 'down' (report-only).
   */
  recover?: () => Promise<void>;
  /** True if the soak verdict should require this service to stay up. */
  required?: boolean;
  /** Ms between probes while healthy/degraded. Default 30_000. */
  probeIntervalMs?: number;
  /** Ms before a hung probe counts as failed. Default 3_000. */
  probeTimeoutMs?: number;
  /** Consecutive failures before recovery (or 'down'). Default 3. */
  failureThreshold?: number;
  /** First recovery backoff. Doubles per attempt (+/- jitter). Default 5_000. */
  recoveryBackoffMs?: number;
  /** Backoff ceiling. Default 300_000 (5 min). */
  recoveryBackoffCapMs?: number;
  /** Ms allowed for one recover() call before it counts as failed. Default 60_000. */
  recoveryTimeoutMs?: number;
  /** Circuit breaker: max recovery attempts inside the window. Default 5. */
  maxRecoveries?: number;
  /** Circuit breaker rolling window. Default 1_800_000 (30 min). */
  recoveryWindowMs?: number;
  /** Slow re-probe cadence once 'down', so a manual fix is re-detected. Default 120_000. */
  downRetryIntervalMs?: number;
}

export type SupervisorEventType =
  | 'probe-fail'
  | 'state-change'
  | 'recovery-attempt'
  | 'recovery-error'
  | 'breaker-open';

/** One entry in the supervisor's capped event log. Healthy probes are not logged. */
export interface SupervisorEvent {
  at: number;
  service: string;
  type: SupervisorEventType;
  from?: ServiceHealth;
  to?: ServiceHealth;
  detail?: string;
}

/** Live snapshot of one service, for status IPC / soak sampling. */
export interface ServiceStatus {
  name: string;
  health: ServiceHealth;
  required: boolean;
  consecutiveFailures: number;
  totalFailures: number;
  totalRecoveries: number;
  recoveriesInWindow: number;
  lastProbeAt: number | null;
  lastOkAt: number | null;
}

export interface SupervisorStatus {
  startedAt: number;
  stopped: boolean;
  services: ServiceStatus[];
}

// ── Soak ─────────────────────────────────────────────────────────────────────

export interface SoakSample {
  at: number;
  rssBytes: number;
  heapUsedBytes: number;
  states: Record<string, ServiceHealth>;
}

export interface SoakServiceReport {
  uptimePct: number;
  transitions: number;
  recoveries: number;
  failures: number;
  finalState: ServiceHealth;
  required: boolean;
}

export interface SoakReport {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  samples: number;
  services: Record<string, SoakServiceReport>;
  memory: {
    firstRssBytes: number;
    lastRssBytes: number;
    peakRssBytes: number;
    growthPct: number;
  };
  eventCount: number;
  verdict: 'pass' | 'fail';
  verdictReasons: string[];
}

export interface SoakOptions {
  services: ServiceSpec[];
  durationMs: number;
  /** Ms between status/memory samples. Default 60_000. */
  sampleIntervalMs?: number;
  /** Required services must keep at least this uptime. Default 95. */
  minUptimePct?: number;
  /** RSS growth beyond this fails the soak (runs >= 10 min only). Default 35. */
  maxRssGrowthPct?: number;
  clock?: Clock;
  rng?: () => number;
  onSample?: (sample: SoakSample) => void;
}
